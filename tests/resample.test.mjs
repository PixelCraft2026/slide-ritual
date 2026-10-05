import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker as NodeWorker } from 'node:worker_threads';
import { AreaResampler, resampleArea, resampleLanczos2 } from '../resample.js';
import { decodeRadiance, srgbToLinear, linearToSrgb, toHalf } from '../hdr.js';
import { decodeImage, ProjectionRenderer } from '../renderer.js';
import { pixelWorkerSource, processImagePixels } from '../pixels.js';

const rgba=(width,height,pixel)=>{
  const data=new Float32Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set(pixel(x,y),(y*width+x)*4);
  return data;
};
const close=(a,b,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('a strongly minified checkerboard becomes its uniform average',()=>{
  const source=rgba(256,256,(x,y)=>{const v=(x+y)%2;return[v,v,v,1];});
  const result=resampleArea(source,256,256,16,16);
  for(let i=0;i<result.length;i+=4){close(result[i],.5);close(result[i+1],.5);close(result[i+2],.5);close(result[i+3],1);}
});

test('fractional footprints include the last row and column of odd-sized images',()=>{
  const edge=resampleArea(rgba(3,1,x=>[x===2?1:0,0,0,1]),3,1,2,1);
  close(edge[0],0);close(edge[4],2/3);
  const source=rgba(7,5,(x,y)=>[y*7+x,0,0,1]),result=resampleArea(source,7,5,3,2);
  let mean=0;for(let i=0;i<result.length;i+=4)mean+=result[i]/6;
  close(mean,17,2e-6);
});

test('area filtering averages linear energy and retains HDR and signed color values',()=>{
  const result=resampleArea(new Float32Array([0,4,-.25,1,1,8,-.75,1]),2,1,1,1);
  close(result[0],.5);close(linearToSrgb(result[0]),.735356983,1e-7);
  close(result[1],6);close(result[2],-.5);close(result[3],1);
});

test('tile boundaries and input order do not introduce seams',()=>{
  const width=13,height=9,source=rgba(width,height,(x,y)=>[x/13,y/9,(x+y)%2,1]);
  const reference=resampleArea(source,width,height,5,4),filter=new AreaResampler(width,height,5,4),tiles=[];
  for(let top=0;top<height;top+=4)for(let left=0;left<width;left+=5){
    const w=Math.min(5,width-left),h=Math.min(4,height-top),data=new Float32Array(w*h*4);
    for(let y=0;y<h;y++)data.set(source.subarray(((top+y)*width+left)*4,((top+y)*width+left+w)*4),y*w*4);
    tiles.push([data,left,top,w,h]);
  }
  for(const tile of tiles.reverse())filter.addTile(...tile);
  for(let i=0;i<reference.length;i++)close(filter.data[i],reference[i]);
});

test('Radiance preview reduction suppresses one-pixel stripes before sampling',()=>{
  const width=5120,header=new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X ${width}\n`),bytes=new Uint8Array(header.length+width*4);bytes.set(header);
  for(let x=0;x<width;x++)bytes.set(x%2?[0,0,0,0]:[128,128,128,129],header.length+x*4);
  const source=decodeRadiance(bytes.buffer);
  assert.equal(source.width,2560);assert.equal(source.hdr,true);
  for(let i=0;i<source.data.length;i+=4)close(source.data[i],.501953125);
});

test('large ordinary photos use one bounded high-quality canvas readback',async()=>{
  const oldDocument=globalThis.document;let canvas,floatAttempts=0,reads=0,draws=0;
  const context={drawImage(image,x,y,w,h){draws++;assert.equal(w,2560);assert.equal(h,1);assert.equal(this.imageSmoothingQuality,'high');assert.equal(this.imageSmoothingEnabled,true);},getImageData(x,y,w,h,options){
    if(options){floatAttempts++;throw new Error('Float16 readback unavailable');}
    reads++;const data=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++)data.set([128,128,128,255],i*4);
    return{data,colorSpace:'srgb'};
  }};
  globalThis.document={createElement(){canvas={width:0,height:0,getContext(){return context;}};return canvas;}};
  try{
    const source=await decodeImage({naturalWidth:5120,naturalHeight:1});
    assert.equal(source.width,2560);assert.equal(source.hdr,false);assert.equal(source.float,false);
    assert.equal(floatAttempts,1);assert.equal(reads,1);assert.equal(draws,1);assert.equal(canvas.width*canvas.height,1);
    for(let i=0;i<source.data.length;i+=4)close(source.data[i],srgbToLinear(128/255));
  }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});

test('float16 decode preserves high values and color space', {skip:typeof Float16Array==='undefined'},async()=>{
  const oldDocument=globalThis.document;
  globalThis.document={createElement(){return{getContext(){return{clearRect(){},drawImage(){},getImageData(){return{data:new Float16Array([2,2,2,1,4,4,4,1]),colorSpace:'display-p3'};}};}};}};
  try{
    const source=await decodeImage({naturalWidth:2,naturalHeight:1});
    assert.equal(source.float,true);assert.equal(source.hdr,true);assert.equal(source.colorSpace,'display-p3');
    close(source.data[0],srgbToLinear(2),1e-6);close(source.data[4],srgbToLinear(4),2e-6);
  }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});

test('both GPU paths upload only the prepared display-size HDR texture',async()=>{
  const source={data:rgba(5,3,()=>[4,2,.5,1]),width:5,height:3,hdr:true,colorSpace:'srgb'};
  const renderer=new ProjectionRenderer({width:2,height:1},()=>{});renderer.draw=()=>{};
  const projection=await renderer.prepare(source);assert.deepEqual([projection.width,projection.height],[2,1]);assert.equal(renderer.prepare(source),projection);
  for(let i=0;i<projection.data.length;i+=4)assert.equal(projection.data[i],toHalf(4));
  const oldUsage=globalThis.GPUTextureUsage;globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};
  try{
    const writes=[];let descriptor;
    renderer.mode='webgpu';renderer.pipeline={getBindGroupLayout(){return{};}};renderer.device={createTexture(d){descriptor=d;return{createView(){return{};},destroy(){}};},createBindGroup(){return{};},queue:{writeTexture(...args){writes.push(args);}}};
    renderer.upload(source);assert.equal(descriptor.mipLevelCount,undefined);assert.equal(descriptor.format,'rgba16float');assert.deepEqual(descriptor.size,[2,1]);
    assert.deepEqual(writes.map(x=>[x[2].bytesPerRow,x[3]]),[[16,[2,1]]]);
    const uploads=[],parameters=[];
    const glRenderer=new ProjectionRenderer({width:2,height:1},()=>{});glRenderer.draw=()=>{};glRenderer.halfSources=renderer.halfSources;
    glRenderer.mode='webgl';glRenderer.gl={TEXTURE_2D:1,TEXTURE_MAX_LEVEL:2,RGBA16F:3,RGBA:4,HALF_FLOAT:5,createTexture(){return{};},bindTexture(){},texParameteri(...args){parameters.push(args);},texImage2D(...args){uploads.push(args);}};
    glRenderer.upload(source);assert.deepEqual(uploads.map(x=>[x[1],x[3],x[4]]),[[0,2,1]]);
    glRenderer.upload({data:new Float32Array([1,1,1,1]),width:1,height:1});assert.equal(parameters.at(-1)[2],0);
  }finally{if(oldUsage===undefined)delete globalThis.GPUTextureUsage;else globalThis.GPUTextureUsage=oldUsage;}
});

test('scale-aware Lanczos2 suppresses fine stripes and retains representable detail',()=>{
  const stripes=resampleLanczos2(rgba(1024,1,x=>{const v=x%2;return[v,v,v,1];}),1024,1,128,1);
  for(let x=4;x<124;x++)close(stripes[x*4],.5,1e-5);
  const n=2048,w=512,f=.25,source=rgba(n,1,x=>{const v=.5+.4*Math.cos(2*Math.PI*f*x/4);return[v,v,v,1];});
  const amplitude=data=>{
    let a=0,b=0;for(let x=8;x<w-8;x++){a+=(data[x*4]-.5)*Math.cos(2*Math.PI*f*(x+.5));b+=(data[x*4]-.5)*Math.sin(2*Math.PI*f*(x+.5));}
    return 2*Math.hypot(a,b)/(w-16);
  };
  const area=amplitude(resampleArea(source,n,1,w,1)),lanczos=amplitude(resampleLanczos2(source,n,1,w,1));
  assert.ok(lanczos>area*1.03);assert.ok(lanczos>.4*.93&&lanczos<.4*1.01);
});

test('Lanczos2 preserves odd-sized constant HDR images and bounds edge ringing',()=>{
  const constant=resampleLanczos2(rgba(13,9,()=>[4,-.25,.5,1]),13,9,5,4);
  for(let i=0;i<constant.length;i+=4){close(constant[i],4,1e-6);close(constant[i+1],-.25);close(constant[i+3],1);}
  const edge=resampleLanczos2(rgba(128,1,x=>[x<64?0:1,0,0,1]),128,1,32,1);
  for(let i=0;i<edge.length;i+=4)assert.ok(edge[i]>=-.1&&edge[i]<=1.1);
  assert.ok(edge[31*4]>.99);
});

test('Lanczos2 rejects frequencies above the destination Nyquist limit at fractional scales',()=>{
  const n=2048,w=630,source=rgba(n,1,x=>{const v=.5+.4*Math.cos(2*Math.PI*.85*x*w/n);return[v,v,v,1];});
  const filtered=resampleLanczos2(source,n,1,w,1);let square=0,count=0;
  for(let x=8;x<w-8;x++){square+=(filtered[x*4]-.5)**2;count++;}
  assert.ok(Math.sqrt(square/count)<.015);
});

test('the generated offline-compatible worker executes real transferable pixel jobs', {skip:typeof Float16Array==='undefined'},async()=>{
  const worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');let onmessage;const postMessage=(data,buffers)=>parentPort.postMessage(data,buffers);${pixelWorkerSource};parentPort.on('message',data=>onmessage({data}));`,{eval:true});
  try{
    const pixels=new Float16Array(16*4);for(let x=0;x<16;x++)pixels.set([2,2,2,1],x*4);
    const result=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({id:1,job:{type:'decode',pixels,width:16,height:1,colorSpace:'display-p3',viewport:{width:4,height:1}}});});
    assert.equal(result.error,undefined);assert.equal(result.result.source.hdr,true);assert.equal(result.result.source.colorSpace,'display-p3');
    assert.equal(result.result.projection.width,4);assert.equal(result.result.projection.data.length,16);
    for(let i=0;i<16;i+=4)assert.equal(result.result.projection.data[i],toHalf(srgbToLinear(2)));
    const source=result.result.source;
    const resized=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({id:2,job:{type:'resize',source,viewport:{width:8,height:1}}});});
    assert.equal(resized.result.projection.width,8);assert.equal(resized.result.source,undefined);
    assert.ok(source.data.byteLength>0);
    const header=new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 1 +X 2\n'),bytes=new Uint8Array(header.length+8);bytes.set(header);bytes.set([128,128,128,131,128,128,128,131],header.length);
    const radiance=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({id:3,job:{type:'radiance',buffer:bytes.buffer,viewport:{width:1,height:1}}});});
    assert.equal(radiance.error,undefined);assert.equal(radiance.result.source.hdr,true);assert.equal(radiance.result.projection.width,1);assert.ok(radiance.result.projection.data[0]>toHalf(4));
  }finally{await worker.terminate();}
});

test('the public pixel pipeline dispatches through its Blob worker and retains source data',async()=>{
  const oldWorker=globalThis.Worker,workers=[];
  globalThis.Worker=class{
    constructor(url){
      this.ready=fetch(url).then(response=>response.text()).then(code=>{
        const worker=new NodeWorker(`const {parentPort}=require('node:worker_threads');let onmessage;const postMessage=(data,buffers)=>parentPort.postMessage(data,buffers);${code};parentPort.on('message',data=>onmessage({data}));`,{eval:true});
        workers.push(worker);worker.on('message',data=>this.onmessage?.({data}));worker.on('error',error=>this.onerror?.(error));return worker;
      });
    }
    postMessage(data){this.ready.then(worker=>worker.postMessage(data)).catch(error=>this.onerror?.(error));}
    terminate(){this.ready.then(worker=>worker.terminate());}
  };
  try{
    const pipeline=await import('../pixels.js?blob-worker-test');
    const pixels=new Uint8ClampedArray([255,255,255,255,0,0,0,255]);
    const source=await pipeline.processImagePixels(pixels,2,1,'srgb',{width:1,height:1});
    assert.equal(workers.length,1);assert.equal(pixels.byteLength,8);assert.equal(source.data.byteLength,32);assert.equal(source.preparedProjection.data[0],toHalf(.5));
    const larger=await pipeline.prepareImageProjection(source,{width:2,height:1});assert.equal(larger.width,2);assert.equal(source.data[0],1);assert.equal(workers.length,1);
  }finally{await Promise.all(workers.map(worker=>worker.terminate()));if(oldWorker===undefined)delete globalThis.Worker;else globalThis.Worker=oldWorker;}
});

test('unsupported workers fall back without detaching the input',async()=>{
  const oldWorker=globalThis.Worker;globalThis.Worker=class{constructor(){throw new Error('Workers unavailable');}};
  try{
    const pixels=new Uint8ClampedArray([255,255,255,255,0,0,0,255]);
    const source=await processImagePixels(pixels,2,1,'srgb',{width:1,height:1});
    assert.equal(pixels.byteLength,8);assert.equal(source.preparedProjection.width,1);assert.equal(source.preparedProjection.data[0],toHalf(.5));
  }finally{if(oldWorker===undefined)delete globalThis.Worker;else globalThis.Worker=oldWorker;}
});

test('resizing coalesces pending filters and does not upload obsolete dimensions',async()=>{
  const canvas={width:32,height:16},renderer=new ProjectionRenderer(canvas,()=>{}),source={width:64,height:32};renderer.source=source;
  const pending=[],uploaded=[];renderer.prepare=(s,viewport)=>new Promise(resolve=>pending.push({viewport,resolve}));renderer.uploadProjection=p=>uploaded.push(p);
  renderer.refreshProjection();assert.equal(pending.length,1);
  canvas.width=16;canvas.height=8;renderer.refreshProjection();canvas.width=8;canvas.height=4;renderer.refreshProjection();
  pending[0].resolve({width:32,height:16});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(uploaded.length,0);assert.equal(pending.length,2);assert.equal(pending[1].viewport.width,8);
  pending[1].resolve({width:8,height:4});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(uploaded.length,1);assert.equal(uploaded[0].width,8);assert.equal(renderer.preparingProjection,false);
});

test('display-size caching is bounded and magnification returns to source detail',async()=>{
  const source={data:rgba(16,8,(x,y)=>[x/16,y/8,0,1]),width:16,height:8},renderer=new ProjectionRenderer({width:8,height:4},()=>{});renderer.draw=()=>{};
  const small=await renderer.prepare(source);assert.equal(small.width,8);
  assert.equal(await renderer.prepare(source),small);
  await renderer.prepare(source,{width:4,height:2});
  const full=await renderer.prepare(source,{width:32,height:16});assert.equal(full.width,16);assert.equal(full.height,8);
  for(let i=0;i<source.data.length;i++)assert.equal(full.data[i],toHalf(source.data[i]));
  assert.ok(renderer.halfSources.get(source).size<=2);
});

test('a cached slide starts with the upcoming projection size before the canvas is resized',async()=>{
  const source={data:rgba(16,8,()=>[1,1,1,1]),width:16,height:8},renderer=new ProjectionRenderer({width:4,height:2},()=>{});renderer.draw=()=>{};
  await renderer.prepare(source);const upcoming=await renderer.prepare(source,{width:8,height:4});
  renderer.upload(source,{width:8,height:4});assert.equal(renderer.uploadedProjection,upcoming);
  renderer.canvas.hidden=true;renderer.refreshProjection();assert.equal(renderer.preparingProjection,undefined);
});

test('unchanged canvas sizes avoid reallocations and the glow avoids photo filtering',()=>{
  const oldDpr=globalThis.devicePixelRatio;globalThis.devicePixelRatio=2;let allocations=0,w=8,h=4;
  const canvas={get width(){return w;},set width(v){w=v;allocations++;},get height(){return h;},set height(v){h=v;allocations++;}};
  const renderer=new ProjectionRenderer(canvas,()=>{},{transparent:true});renderer.draw=()=>{};
  try{
    renderer.resize(4,2);renderer.resize(4,2);assert.equal(allocations,0);
    renderer.resize(5,3);assert.equal(allocations,2);
    const source={data:rgba(16,8,()=>[4,2,.5,.3]),width:16,height:8};
    const glow=renderer.prepare(source);assert.ok(!(glow instanceof Promise));assert.equal(glow.width,16);assert.equal(glow.data[0],toHalf(4));
  }finally{if(oldDpr===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=oldDpr;}
});
