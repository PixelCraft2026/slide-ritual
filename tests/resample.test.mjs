import test from 'node:test';
import assert from 'node:assert/strict';
import { AreaResampler, resampleArea } from '../resample.js';
import { decodeRadiance, srgbToLinear, linearToSrgb, toHalf } from '../hdr.js';
import { decodeImage, ProjectionRenderer } from '../renderer.js';

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

test('ordinary image decoding reads bounded 1:1 tiles and then filters in linear light',async()=>{
  const oldDocument=globalThis.document;let crop,largestCanvas=0,floatAttempts=0,reads=0;
  const context={clearRect(){},drawImage(image,sx,sy,sw,sh,dx,dy,dw,dh){assert.equal(sw,dw);assert.equal(sh,dh);crop={sx,sy,sw,sh};},getImageData(x,y,w,h,options){
    if(options){floatAttempts++;throw new Error('Float16 readback unavailable');}
    reads++;const data=new Uint8ClampedArray(w*h*4);
    for(let i=0;i<w*h;i++){const value=(crop.sx+i%w)%2?0:255;data.set([value,value,value,255],i*4);}
    return{data,colorSpace:'srgb'};
  }};
  globalThis.document={createElement(){return{width:0,height:0,getContext(){largestCanvas=Math.max(largestCanvas,this.width*this.height);return context;}};}};
  try{
    const source=await decodeImage({naturalWidth:5120,naturalHeight:1});
    assert.equal(source.width,2560);assert.equal(source.hdr,false);assert.equal(source.float,false);
    assert.ok(largestCanvas<=512*512);assert.equal(floatAttempts,1);assert.equal(reads,10);
    for(let i=0;i<source.data.length;i+=4)close(source.data[i],.5);
  }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});

test('float16 decode preserves high values and color space before area filtering', {skip:typeof Float16Array==='undefined'},async()=>{
  const oldDocument=globalThis.document;
  globalThis.document={createElement(){return{getContext(){return{clearRect(){},drawImage(){},getImageData(){return{data:new Float16Array([2,2,2,1,4,4,4,1]),colorSpace:'display-p3'};}};}};}};
  try{
    const source=await decodeImage({naturalWidth:2,naturalHeight:1});
    assert.equal(source.float,true);assert.equal(source.hdr,true);assert.equal(source.colorSpace,'display-p3');
    close(source.data[0],srgbToLinear(2),1e-6);close(source.data[4],srgbToLinear(4),2e-6);
  }finally{if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;}
});

test('both GPU upload paths receive a complete HDR-preserving mip chain',()=>{
  const source={data:rgba(5,3,()=>[4,2,.5,1]),width:5,height:3,hdr:true,colorSpace:'srgb'};
  const renderer=new ProjectionRenderer({},()=>{});renderer.draw=()=>{};
  const levels=renderer.prepare(source);assert.deepEqual(levels.map(x=>[x.width,x.height]),[[5,3],[2,1],[1,1]]);assert.equal(renderer.prepare(source),levels);
  for(const level of levels)for(let i=0;i<level.data.length;i+=4)assert.equal(level.data[i],toHalf(4));
  const oldUsage=globalThis.GPUTextureUsage;globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};
  try{
    const writes=[];let descriptor;
    renderer.mode='webgpu';renderer.pipeline={getBindGroupLayout(){return{};}};renderer.device={createTexture(d){descriptor=d;return{createView(){return{};},destroy(){}};},createBindGroup(){return{};},queue:{writeTexture(...args){writes.push(args);}}};
    renderer.upload(source);assert.equal(descriptor.mipLevelCount,3);assert.equal(descriptor.format,'rgba16float');
    assert.deepEqual(writes.map(x=>[x[0].mipLevel,x[2].bytesPerRow,x[3]]),[[0,40,[5,3]],[1,16,[2,1]],[2,8,[1,1]]]);
    const uploads=[],parameters=[];
    renderer.mode='webgl';renderer.gl={TEXTURE_2D:1,TEXTURE_MAX_LEVEL:2,RGBA16F:3,RGBA:4,HALF_FLOAT:5,bindTexture(){},texParameteri(...args){parameters.push(args);},texImage2D(...args){uploads.push(args);}};
    renderer.upload(source);assert.deepEqual(uploads.map(x=>[x[1],x[3],x[4]]),[[0,5,3],[1,2,1],[2,1,1]]);
    renderer.upload({data:new Float32Array([1,1,1,1]),width:1,height:1});assert.equal(parameters.at(-1)[2],0);
  }finally{if(oldUsage===undefined)delete globalThis.GPUTextureUsage;else globalThis.GPUTextureUsage=oldUsage;}
});
