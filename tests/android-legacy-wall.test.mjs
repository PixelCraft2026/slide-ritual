import test from 'node:test';
import assert from 'node:assert/strict';
import {WallLight} from '../scene.js';

async function withPlatform(userAgent,run){
  const saved=new Map(['navigator','document'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)])),canvases=[];
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent}});
  globalThis.document={createElement(){
    const c={width:1,height:1};let context;
    c.getContext=(type,options={})=>context??=(c.options=options,{
      getContextAttributes:()=>options,createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),
      putImageData(image){c.image=image;},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),drawImage(){},
      clearRect(){},save(){},restore(){},translate(){},scale(){}
    });canvases.push(c);return c;
  }};
  try{return await run(canvases);}finally{for(const[k,v]of saved){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}}
}
const input={width:1,height:1,data:new Float32Array([.25,.5,3,1]),colorSpace:'srgb'};

test('Android wall uses the previous 48px encoded source instead of the new irradiance grid',()=>withPlatform('Android 16; Xiaomi 15',()=>{
  const wall=new WallLight(document.createElement('canvas')),sample=wall.sampleSource(input);
  assert.equal(wall.legacy,true);assert.equal(wall.amount,1);assert.equal(sample.source.width,48);assert.equal(sample.source.height,48);
  assert.deepEqual(Array.from(sample.source.image.data.slice(0,4)),[136,186,212,255]);
  assert.ok(sample.color.every(v=>Number.isFinite(v)&&v>0&&v<=1));
}));

test('Android prepares bounded byte caches once and reuses them during transport, viewing and export',()=>withPlatform('Android 16; Xiaomi 15',async canvases=>{
  for(const presentation of [true,false]){
    const wall=new WallLight(document.createElement('canvas'),{presentation}),layout={w:3840,h:2160,sw:1500,sh:1800,centerY:670};
    const first=await wall.prepare(input,layout),count=canvases.length,again=await wall.prepare(input,layout);
    assert.equal(first,again);assert.equal(canvases.length,count);assert.ok(first.buffer.width<=512&&first.buffer.height<=512);
    wall.activate(first);for(let i=0;i<3;i++)wall.draw(.5,{phase:'out',shift:i/10,clipRight:.2});
    assert.equal(canvases.length,count);assert.ok(canvases.every(c=>c.options?.colorType!=='float16'));
  }
}));

test('Windows and Apple keep their current linear irradiance samples',async()=>{for(const userAgent of ['Windows NT 10.0','iPad; CPU OS 26_0','Macintosh; Intel Mac OS X'])await withPlatform(userAgent,()=>{
  const wall=new WallLight(document.createElement('canvas')),sample=wall.sampleSource(input);
  assert.equal(wall.legacy,false);assert.equal(wall.amount,2);assert.equal(sample.source.size,16);assert.ok(sample.source.data instanceof Float32Array);
});});
