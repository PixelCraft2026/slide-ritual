import test from 'node:test';
import assert from 'node:assert/strict';
import { wallSamples,wallField,wallPixels } from '../wall-diffusion.js';
const layout={w:960,h:540,sw:340,sh:220,centerY:184};
const source=(fn,size=64)=>({width:size,height:size,colorSpace:'srgb',data:Float32Array.from({length:size*size*4},(_,i)=>i%4===3?1:fn(Math.floor(i/4)%size,Math.floor(i/4/size),i%4))});
test('black projects no diffuse light, without a lifted pedestal',()=>{
  const sample=wallSamples(source(()=>0)),field=wallField(sample,layout);
  assert.deepEqual(sample.color,[0,0,0]);assert.ok(field.data.every(v=>v===0));assert.ok(wallPixels(field).every(v=>v===0));
});
test('diffuse irradiance rejects checker detail and smoothly decays away from the image',()=>{
  const flat=wallField(wallSamples(source(()=>.5)),layout),checker=wallField(wallSamples(source((x,y)=>(x+y)%2)),layout);
  for(let i=0;i<flat.data.length;i++)assert.ok(Math.abs(flat.data[i]-checker.data[i])<1e-6);
  const y=Math.round((layout.h+layout.centerY)/layout.w*flat.width/3),center=Math.floor(flat.width/2),at=x=>flat.data[(y*flat.width+x)*3];
  assert.ok(at(center)>at(0)*100);
  for(let x=center+1;x<flat.width;x++)assert.ok(at(x)<=at(x-1)+1e-6,'no secondary copied-image edges');
});
test('linear-light integration retains spatial color variation and bounds the cache size',()=>{
  const field=wallField(wallSamples(source((x,y,k)=>k===(x<32?0:2)?1:0)),layout);
  assert.ok(Math.max(field.width,field.height)<=480);
  const y=Math.round((layout.h+layout.centerY)/layout.w*field.width/3),left=(y*field.width+Math.floor(field.width*.45))*3,right=(y*field.width+Math.floor(field.width*.55))*3;
  assert.ok(field.data[left]>field.data[left+2]);assert.ok(field.data[right]<field.data[right+2]);
  assert.ok([...wallPixels(field)].every(Number.isFinite));
});
