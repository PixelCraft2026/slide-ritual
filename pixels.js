import { decodeRadiance, srgbToLinear, toHalf } from './hdr.js';
import { AreaResampler, lanczos2, lanczosAxis, filterLanczosRows } from './resample.js';

// Keep expensive pixel work out of the animation thread. The worker source is
// self-contained so the same path also works in the single-file offline build.
export function yieldPixelWork(){
  if(globalThis.scheduler?.yield)return globalThis.scheduler.yield();
  return new Promise(resolve=>{
    if(typeof MessageChannel==='undefined'){setTimeout(resolve,0);return;}
    const channel=new MessageChannel();channel.port1.onmessage=()=>{channel.port1.close();channel.port2.close();resolve();};channel.port2.postMessage(0);
  });
}

export async function linearPixels(pixels,width,height,colorSpace,cooperative=false){
  const float=pixels.BYTES_PER_ELEMENT===2,data=new Float32Array(width*height*4);
  const table=float?new Float32Array(65536):Float32Array.from({length:256},(_,v)=>srgbToLinear(v/255));
  const ready=float?new Uint8Array(65536):null,bits=float?new Uint16Array(pixels.buffer,pixels.byteOffset,pixels.length):null;
  let peak=0,peakLuminance=0;
  for(let start=0;start<data.length;start+=262144){
    const end=Math.min(data.length,start+262144);
    for(let i=start;i<end;i+=4){
      const alpha=Number(pixels[i+3])/(float?1:255);
      for(let c=0;c<3;c++){
        if(float){const code=bits[i+c];if(!ready[code]){table[code]=srgbToLinear(Number(pixels[i+c]));ready[code]=1;}data[i+c]=table[code]*alpha;}
        else data[i+c]=table[pixels[i+c]]*alpha;
        peak=Math.max(peak,data[i+c]);
      }
      peakLuminance=Math.max(peakLuminance,.22897456*data[i]+.69173852*data[i+1]+.07928691*data[i+2]);data[i+3]=1;
    }
    if(cooperative&&end<data.length)await yieldPixelWork();
  }
  return{data,width,height,colorSpace,hdr:float&&peakLuminance>1.015,peak,float};
}

export async function halfPixels(data,cooperative=false){
  const half=new Uint16Array(data.length);
  for(let start=0;start<data.length;start+=262144){
    const end=Math.min(data.length,start+262144);for(let i=start;i<end;i++)half[i]=toHalf(data[i]);
    if(cooperative&&end<data.length)await yieldPixelWork();
  }
  return half;
}

export async function gainMapPixels(pixels,gains,width,height,colorSpace,metadata,cooperative=false){
  if(pixels.length!==width*height*4||gains.length!==pixels.length)throw new Error('Invalid gain map dimensions');
  const source=await linearPixels(pixels,width,height,colorSpace,cooperative),tables=metadata.minimum.map((min,c)=>Float32Array.from({length:256},(_,v)=>2**(min+(metadata.maximum[c]-min)*(v/255)**(1/metadata.gamma[c]))));
  let peak=0;
  for(let start=0;start<source.data.length;start+=262144){
    const end=Math.min(source.data.length,start+262144);
    for(let i=start;i<end;i+=4)for(let c=0;c<3;c++){
      const value=Math.max(0,(source.data[i+c]+metadata.offsetSDR[c])*tables[c][gains[i+c]]-metadata.offsetHDR[c]);source.data[i+c]=value;peak=Math.max(peak,value);
    }
    if(cooperative&&end<source.data.length)await yieldPixelWork();
  }
  source.hdr=true;source.peak=peak;return source;
}

export async function lanczosPixels(data,sourceWidth,sourceHeight,width,height,cooperative=false){
  let horizontal=data;
  if(width!==sourceWidth){
    horizontal=new Float32Array(width*sourceHeight*4);const axis=lanczosAxis(sourceWidth,width);
    for(let y=0;y<sourceHeight;y+=16){filterLanczosRows(data,sourceWidth,horizontal,width,sourceHeight,axis,false,y,Math.min(sourceHeight,y+16));if(cooperative)await yieldPixelWork();}
  }
  if(height===sourceHeight)return horizontal;
  const output=new Float32Array(width*height*4),axis=lanczosAxis(sourceHeight,height);
  for(let y=0;y<height;y+=16){filterLanczosRows(horizontal,width,output,width,height,axis,true,y,Math.min(height,y+16));if(cooperative)await yieldPixelWork();}
  return output;
}

export function projectionPixelsSize(source,viewport){
  const scale=Math.min(1,Math.max(1,viewport.width)/source.width,Math.max(1,viewport.height)/source.height);
  return{width:Math.max(1,Math.round(source.width*scale)),height:Math.max(1,Math.round(source.height*scale))};
}

export async function projectionPixels(source,viewport,cooperative=false){
  const {width,height}=projectionPixelsSize(source,viewport);
  const filtered=await lanczosPixels(source.data,source.width,source.height,width,height,cooperative);
  return{data:await halfPixels(filtered,cooperative),width,height};
}

export async function pixelJob(job,cooperative=false){
  const source=job.type==='gainmap'?await gainMapPixels(job.pixels,job.gains,job.width,job.height,job.colorSpace,job.metadata,cooperative):job.type==='decode'?await linearPixels(job.pixels,job.width,job.height,job.colorSpace,cooperative):job.type==='radiance'?decodeRadiance(job.buffer):job.source;
  const projection=job.viewport?await projectionPixels(source,job.viewport,cooperative):undefined;
  return job.type==='resize'?{projection}:{source,projection};
}

export const pixelWorkerSource=`
const f32=new Float32Array(1),u32=new Uint32Array(f32.buffer);
${[AreaResampler,decodeRadiance,srgbToLinear,toHalf,lanczos2,lanczosAxis,filterLanczosRows,linearPixels,gainMapPixels,halfPixels,lanczosPixels,projectionPixelsSize,projectionPixels,pixelJob].map(fn=>`const ${fn.name}=${fn.toString()};`).join('\n')}
onmessage=async({data:{id,job}})=>{
  try{const result=await pixelJob(job),buffers=[];if(result.source)buffers.push(result.source.data.buffer);if(result.projection)buffers.push(result.projection.data.buffer);postMessage({id,result},buffers);}
  catch(error){postMessage({id,error:error.message});}
};`;

let pixelWorker,workerUnavailable=false,nextPixelJob=0;
const pixelJobs=new Map();
function getPixelWorker(){
  if(workerUnavailable||typeof Worker==='undefined')return null;
  if(pixelWorker)return pixelWorker;
  let url;
  try{
    url=URL.createObjectURL(new Blob([pixelWorkerSource],{type:'text/javascript'}));pixelWorker=new Worker(url);
    pixelWorker.onmessage=({data:{id,result,error}})=>{const pending=pixelJobs.get(id);if(!pending)return;pixelJobs.delete(id);error?pending.reject(new Error(error)):pending.resolve(result);};
    pixelWorker.onerror=pixelWorker.onmessageerror=()=>{pixelWorker?.terminate();pixelWorker=null;workerUnavailable=true;for(const pending of pixelJobs.values())pending.reject(new Error('Pixel worker unavailable'));pixelJobs.clear();};
    return pixelWorker;
  }catch{workerUnavailable=true;pixelWorker?.terminate();pixelWorker=null;return null;}
  finally{if(url)URL.revokeObjectURL(url);}
}

async function runPixelJob(job){
  const worker=getPixelWorker();
  if(worker){
    try{
      const id=++nextPixelJob;
      return await new Promise((resolve,reject)=>{
        pixelJobs.set(id,{resolve,reject});
        // Retain the bounded input until success, so a worker failure can fall
        // back without trying to use a detached buffer or decoding again.
        try{worker.postMessage({id,job});}catch(error){pixelJobs.delete(id);reject(error);}
      });
    }catch{/* Older browsers use the same filter in short, yielding batches. */}
  }
  return pixelJob(job,true);
}

export async function processImagePixels(pixels,width,height,colorSpace,viewport){
  const {source,projection}=await runPixelJob({type:'decode',pixels,width,height,colorSpace,viewport});source.preparedProjection=projection;return source;
}

export async function processRadiancePixels(buffer,viewport){
  const {source,projection}=await runPixelJob({type:'radiance',buffer,viewport});source.preparedProjection=projection;return source;
}

export async function processGainMapPixels(pixels,gains,width,height,colorSpace,metadata,viewport){
  const {source,projection}=await runPixelJob({type:'gainmap',pixels,gains,width,height,colorSpace,metadata,viewport});
  source.preparedProjection=projection;return source;
}

export async function prepareImageProjection(source,viewport){
  const result=await runPixelJob({type:'resize',source:{data:source.data,width:source.width,height:source.height},viewport});return result.projection;
}
