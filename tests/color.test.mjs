import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeRadiance, srgbToLinear, linearToSrgb, expandSDR, toHalf, hasHDRMetadata } from '../hdr.js';
const file=(w,h,pixels,orientation='-Y +X')=>{
  const [y,x]=orientation.split(' '),head=new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n${y} ${h} ${x} ${w}\n`);
  const data=new Uint8Array(head.length+pixels.length);data.set(head);data.set(pixels,head.length);return data.buffer;
};
test('sRGB round trip preserves shadow, middle gray and superwhite',()=>{
  for(const v of [-.05,0,.003,.04,.18,.5,1,2,4])assert.ok(Math.abs(linearToSrgb(srgbToLinear(v))-v)<1e-7);
  assert.ok(Math.abs(srgbToLinear(.5)-.21404114)<1e-7);
});
test('SDR expansion preserves middle tones and limits diffuse white to chosen gain',()=>{
  for(const v of [0,.01,.18,.4,.58])assert.equal(expandSDR(v,3),v);
  assert.equal(expandSDR(1,2),2);
  let prior=-1;for(let i=0;i<=1000;i++){const v=expandSDR(i/1000,4);assert.ok(v>=prior);prior=v;}
});
test('half upload retains values above SDR white, signs, and small values',()=>{
  assert.equal(toHalf(0),0);assert.equal(toHalf(1),0x3c00);assert.equal(toHalf(2),0x4000);assert.equal(toHalf(4),0x4400);assert.equal(toHalf(-1),0xbc00);
  assert.equal(toHalf(2**-14),0x400);assert.equal(toHalf(2**-24),1);assert.equal(toHalf(65504),0x7bff);
});
test('Radiance decoding preserves over-range highlights and black',()=>{
  const r=decodeRadiance(file(2,1,[128,64,32,131,0,0,0,0]));
  assert.equal(r.hdr,true);assert.ok(r.data[0]>4&&r.data[0]<4.04);assert.ok(r.data[1]>2);assert.equal(r.data[4],0);assert.equal(r.data[7],1);
});
test('Radiance orientation mirrors X and Y correctly',()=>{
  const r=decodeRadiance(file(1,2,[128,0,0,129,0,128,0,129],'+Y -X'));
  assert.ok(r.data[1]>.9);assert.ok(r.data[4]>.9);
});
test('modern Radiance RLE retains every channel',()=>{
  const r=decodeRadiance(file(8,1,[2,2,0,8,136,128,136,64,136,32,136,130]));
  assert.equal(r.data[0],2.0078125);assert.equal(r.data[28],r.data[0]);assert.equal(r.width,8);
});
test('malformed scanlines and truncated RGBE cannot silently create an image',()=>{
  assert.throws(()=>decodeRadiance(file(8,1,[2,2,0,8,137,128])),/RLE/);
  assert.throws(()=>decodeRadiance(file(1,1,[128,128])),/不完整/);
  assert.throws(()=>decodeRadiance(file(1,1,[1,1,1,4])),/RLE/);
});
test('legacy Radiance repeat packets are decoded',()=>{
  const r=decodeRadiance(file(3,1,[128,64,32,130,1,1,1,2]));assert.equal(r.data[0],r.data[8]);
});
test('HDR candidate detection uses metadata rather than filename',()=>{
  assert.equal(hasHDRMetadata(new TextEncoder().encode('ordinary jpeg')),false);
  assert.equal(hasHDRMetadata(new TextEncoder().encode('<rdf hdrgm:Version="1.0">')),true);
  assert.equal(hasHDRMetadata(new Uint8Array([0,0,0,0,110,99,108,120,0,9,0,16,0,9,0])),true);
});
