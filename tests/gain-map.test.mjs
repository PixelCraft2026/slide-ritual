import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readGainMapJPEG } from '../gain-map.js';
import { gainMapPixels, pixelWorkerSource } from '../pixels.js';
import { srgbToLinear, toHalf } from '../hdr.js';

const concat=(...parts)=>Uint8Array.from(parts.flatMap(p=>Array.from(p)));
const app=(marker,data)=>concat([255,marker,(data.length+2)>>8,(data.length+2)&255],data);
function fixture(attributes='hdrgm:GainMapMax="2"',extra=[],entropy=[]){
  const xml=new TextEncoder().encode(`http://ns.adobe.com/hdr-gain-map/1.0/ hdrgm:Version="1.0" ${attributes}`);
  const gain=concat([255,216],app(225,xml),[255,218,0,2,255,217]);
  const mpf=new Uint8Array(62),view=new DataView(mpf.buffer);mpf.set([77,80,70,0,73,73,42,0]);
  view.setUint32(8,8,true);view.setUint16(12,1,true);view.setUint16(14,0xb002,true);view.setUint16(16,7,true);view.setUint32(18,32,true);view.setUint32(22,26,true);
  const primary=concat([255,216],app(226,mpf),...extra,[255,218,0,2],entropy,[255,217]);
  view.setUint32(34,primary.length,true);view.setUint32(50,gain.length,true);view.setUint32(54,primary.length-10,true);
  return concat([255,216],app(226,mpf),...extra,[255,218,0,2],entropy,[255,217],gain);
}
function exif(value=1,type=3,little=true){
  const bytes=new Uint8Array(32),view=new DataView(bytes.buffer);bytes.set([69,120,105,102,0,0,little?73:77,little?73:77]);
  view.setUint16(8,42,little);view.setUint32(10,8,little);view.setUint16(14,1,little);
  view.setUint16(16,274,little);view.setUint16(18,type,little);view.setUint32(20,1,little);
  if(type===4)view.setUint32(24,value,little);else view.setUint16(24,value,little);
  return app(225,bytes);
}
test('JPEG MPF extracts only the auxiliary gain image and strips its link from the temporary SDR base',()=>{
  const bytes=fixture(),before=bytes.slice(),parsed=readGainMapJPEG(bytes);
  assert.ok(parsed);assert.equal(parsed.colorSpace,'srgb');assert.equal(parsed.orientation,1);
  assert.equal(parsed.preferCanvasHDR,false);
  assert.deepEqual(parsed.metadata.maximum,[2,2,2]);assert.deepEqual(parsed.metadata.offsetSDR,[1/64,1/64,1/64]);
  assert.ok(new TextDecoder().decode(parsed.gain).includes('hdrgm:GainMapMax'));
  assert.ok(!new TextDecoder().decode(concat(...parsed.base)).includes('MPF'));
  assert.deepEqual(bytes,before);
});
test('phone Motion Photos recover the primary EOI without entering their gain map or appended video',()=>{
  const bytes=fixture('hdrgm:GainMapMax="1.58496"',[exif(0,4,false),app(225,[255,216,9,255,217])],[21,255,0,217,255,208,18]);
  const view=new DataView(bytes.buffer),primaryLength=view.getUint32(40,true),gainLength=view.getUint32(56,true);
  view.setUint32(40,primaryLength-9,true);
  const motion=concat(bytes,[0,0,0,20,102,116,121,112,109,112,52,50,255,217]),before=motion.slice(),parsed=readGainMapJPEG(motion);
  assert.ok(parsed);assert.equal(parsed.preferCanvasHDR,true);assert.equal(parsed.orientation,1);
  assert.equal(parsed.gain.length,gainLength);assert.deepEqual(parsed.gain,bytes.subarray(primaryLength));
  const base=concat(...parsed.base);assert.deepEqual(base.subarray(-13),Uint8Array.from([255,218,0,2,21,255,0,217,255,208,18,255,217]));
  assert.ok(!new TextDecoder().decode(base).includes('ftyp'));assert.deepEqual(motion,before);
  // The normalized EXIF is in a new temporary segment, never the source bytes.
  const at=base.findIndex((v,i)=>v===69&&base[i+1]===120&&base[i+2]===105&&base[i+3]===102),out=new DataView(base.buffer);
  assert.equal(out.getUint16(at+18,false),3);assert.equal(out.getUint16(at+24,false),1);
});
test('a stale MPF length pointing at a thumbnail EOI cannot truncate the primary photograph',()=>{
  const bytes=fixture(undefined,[app(225,[255,216,1,255,217])]),view=new DataView(bytes.buffer);
  const thumbnailEnd=bytes.findIndex((v,i)=>i>68&&v===255&&bytes[i+1]===217)+2;view.setUint32(40,thumbnailEnd,true);
  const parsed=readGainMapJPEG(bytes);assert.ok(parsed);assert.equal(parsed.preferCanvasHDR,true);
  assert.deepEqual(concat(...parsed.base).subarray(-6),Uint8Array.from([255,218,0,2,255,217]));
});
test('SHORT orientations preserve the camera path while LONG/zero orientation is normalized in a private copy',()=>{
  for(const little of [true,false])for(let value=1;value<=8;value++){
    const normal=readGainMapJPEG(fixture(undefined,[exif(value,3,little)]));assert.equal(normal.orientation,value);assert.equal(normal.preferCanvasHDR,false);
    const bytes=fixture(undefined,[exif(value,4,little)]),before=bytes.slice(),long=readGainMapJPEG(bytes);
    assert.equal(long.orientation,value);assert.equal(long.preferCanvasHDR,true);assert.deepEqual(bytes,before);
  }
  assert.equal(readGainMapJPEG(fixture(undefined,[exif(0)])).orientation,1);
  for(const type of [3,4])assert.equal(readGainMapJPEG(fixture(undefined,[exif(9,type)])),null);
});
test('normalization never mutates a Buffer or an input view with a nonzero byte offset',()=>{
  const jpeg=fixture(undefined,[exif(0,4,false)]),padded=concat([11,12,13,14,15],jpeg,[16,17]);
  for(const bytes of [Buffer.from(jpeg),padded.subarray(5,padded.length-2)]){
    const before=Uint8Array.from(bytes),parsed=readGainMapJPEG(bytes);assert.ok(parsed);assert.equal(parsed.orientation,1);assert.equal(parsed.preferCanvasHDR,true);
    assert.deepEqual(Uint8Array.from(bytes),before);
  }
});
test('primary boundary recovery rejects truncated entropy, invalid marker sizes and gain offsets inside the primary',()=>{
  for(const entropy of [[21,255,196,0,1],[21,255,196,0,32]]){
    const bytes=fixture(undefined,[],entropy),view=new DataView(bytes.buffer);view.setUint32(40,view.getUint32(40,true)-3,true);
    assert.equal(readGainMapJPEG(bytes),null);
  }
  const truncated=fixture(),metadata=new DataView(truncated.buffer),end=metadata.getUint32(40,true);truncated[end-1]=0;metadata.setUint32(40,end-3,true);
  assert.equal(readGainMapJPEG(truncated),null);
  const bytes=fixture(),view=new DataView(bytes.buffer);view.setUint32(60,10,true);assert.equal(readGainMapJPEG(bytes),null);
});
test('per-channel Adobe XMP sequences preserve independent gains and gamma',()=>{
  const parsed=readGainMapJPEG(fixture('hdrgm:GainMapMax="2" <hdrgm:Gamma><rdf:Seq><rdf:li>0.5</rdf:li><rdf:li>1</rdf:li><rdf:li>2</rdf:li></rdf:Seq></hdrgm:Gamma>'));
  assert.deepEqual(parsed.metadata.gamma,[.5,1,2]);
});
test('truncated, unsupported and invalid gain-map metadata preserve the native fallback',()=>{
  const bytes=fixture();assert.equal(readGainMapJPEG(bytes.subarray(0,bytes.length-1)),null);
  for(const attributes of ['hdrgm:Gamma="0"','hdrgm:GainMapMin="3" hdrgm:GainMapMax="2"','hdrgm:BaseRenditionIsHDR="True"','hdrgm:Gamma="NaN"'])assert.equal(readGainMapJPEG(fixture(attributes)),null);
  assert.equal(readGainMapJPEG(fixture('hdrgm:GainMapMax="2"',[app(226,new TextEncoder().encode('ICC_PROFILE\0\x01\x01broken'))])),null);
});
test('gain reconstruction applies inverse gamma and offsets in linear light and retains values above white',async()=>{
  const metadata={minimum:[0,0,0],maximum:[2,2,2],gamma:[.5,1,2],offsetSDR:[.1,.2,.3],offsetHDR:[.01,.02,.03]};
  const base=Uint8ClampedArray.from([128,128,128,255,255,255,255,255]),gains=Uint8ClampedArray.from([128,128,128,255,255,255,255,255]);
  const source=await gainMapPixels(base,gains,2,1,'srgb',metadata);
  for(let c=0;c<3;c++)assert.ok(Math.abs(source.data[c]-((srgbToLinear(128/255)+metadata.offsetSDR[c])*2**(2*(128/255)**(1/metadata.gamma[c]))-metadata.offsetHDR[c]))<1e-6);
  assert.equal(source.hdr,true);assert.ok(source.peak>4);assert.equal(source.data[3],1);
  await assert.rejects(gainMapPixels(base,gains.subarray(0,4),2,1,'srgb',metadata));
});
test('the offline Blob worker reconstructs and filters actual HDR energy before GPU upload',async()=>{
  const worker=new Worker(`const {parentPort}=require('node:worker_threads');let onmessage;const postMessage=(data,buffers)=>parentPort.postMessage(data,buffers);${pixelWorkerSource};parentPort.on('message',data=>onmessage({data}));`,{eval:true});
  try{
    const pixels=new Uint8ClampedArray(32*4).fill(255),gains=pixels.slice(),metadata={minimum:[0,0,0],maximum:[2,2,2],gamma:[1,1,1],offsetSDR:[0,0,0],offsetHDR:[0,0,0]};
    const reply=await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.postMessage({id:1,job:{type:'gainmap',pixels,gains,width:32,height:1,colorSpace:'srgb',metadata,viewport:{width:4,height:1}}});});
    assert.equal(reply.error,undefined);assert.equal(reply.result.source.peak,4);assert.equal(reply.result.projection.width,4);
    for(let i=0;i<16;i+=4)assert.equal(reply.result.projection.data[i],toHalf(4));
  }finally{await worker.terminate();}
});
