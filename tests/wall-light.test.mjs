import test from 'node:test';
import assert from 'node:assert/strict';
import { supportsCanvasBlur, blurLightPixels } from '../atmosphere.js';

const patch=(size,start,end,color)=>{
  const data=new Uint8ClampedArray(size*size*4);
  for(let y=start;y<end;y++)for(let x=start;x<end;x++)data.set(color,(y*size+x)*4);
  return data;
};

test('a Canvas filter that accepts blur but draws unchanged is rejected',()=>{
  const previous=globalThis.document,pixels=patch(16,7,9,[255,255,255,255]);
  globalThis.document={createElement:()=>({getContext:()=>({filter:'none',fillRect(){},getImageData:()=>({data:pixels})})})};
  try{assert.equal(supportsCanvasBlur(),false);}finally{globalThis.document=previous;}
});

test('fallback light blur spreads a hard boundary and preserves translucent color without black fringes',()=>{
  const size=96,data=patch(size,32,64,[220,90,35,255]);blurLightPixels(data,size,size,5);
  const alpha=(x,y)=>data[(y*size+x)*4+3];
  assert.ok(alpha(29,48)>0,'light spreads beyond the sharp photo boundary');
  assert.ok(alpha(32,48)>0&&alpha(32,48)<200,'the old photo edge is soft');
  for(let i=0;i<data.length;i+=4)if(data[i+3]>0){assert.equal(data[i],220);assert.equal(data[i+1],90);assert.equal(data[i+2],35);}
  const energy=data.reduce((sum,v,i)=>sum+(i%4===3?v:0),0);
  assert.ok(Math.abs(energy/(32*32*255)-1)<.01,'blur preserves light energy within byte rounding');
});

test('fallback suppresses repeated photo detail rather than leaving a dim sharp copy',()=>{
  const size=96,data=new Uint8ClampedArray(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const v=(x+y)%2?255:0;data.set([v,v,v,255],(y*size+x)*4);}
  blurLightPixels(data,size,size,4);
  for(let y=24;y<72;y++)for(let x=24;x<72;x++){const i=(y*size+x)*4;assert.ok(Math.abs(data[i]-127.5)<2);assert.equal(data[i+3],255);}
});

test('zero blur preserves pixels and wider blur spreads light farther',()=>{
  const size=96,source=patch(size,40,56,[255,255,255,255]),unchanged=source.slice();
  assert.equal(blurLightPixels(unchanged,size,size,0),unchanged);assert.deepEqual(unchanged,source);
  const narrow=blurLightPixels(source.slice(),size,size,2),wide=blurLightPixels(source.slice(),size,size,8);
  const alpha=data=>data[(48*size+34)*4+3];assert.ok(alpha(wide)>alpha(narrow));
});
