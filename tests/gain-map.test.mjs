import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { readGainMapJPEG } from '../gain-map.js';
import { gainMapPixels, pixelWorkerSource } from '../pixels.js';
import { srgbToLinear, toHalf } from '../hdr.js';

const concat=(...parts)=>Uint8Array.from(parts.flatMap(p=>Array.from(p)));
const app=(marker,data)=>concat([255,marker,(data.length+2)>>8,(data.length+2)&255],data);
function fixture(attributes='hdrgm:GainMapMax="2"',extra=[]){
  const xml=new TextEncoder().encode(`http://ns.adobe.com/hdr-gain-map/1.0/ hdrgm:Version="1.0" ${attributes}`);
  const gain=concat([255,216],app(225,xml),[255,218,0,2,255,217]);
  const mpf=new Uint8Array(62),view=new DataView(mpf.buffer);mpf.set([77,80,70,0,73,73,42,0]);
  view.setUint32(8,8,true);view.setUint16(12,1,true);view.setUint16(14,0xb002,true);view.setUint16(16,7,true);view.setUint32(18,32,true);view.setUint32(22,26,true);
  const primary=concat([255,216],app(226,mpf),...extra,[255,218,0,2,255,217]);
  view.setUint32(34,primary.length,true);view.setUint32(50,gain.length,true);view.setUint32(54,primary.length-10,true);
  return concat([255,216],app(226,mpf),...extra,[255,218,0,2,255,217],gain);
}
test('JPEG MPF extracts only the auxiliary gain image and strips its link from the temporary SDR base',()=>{
  const bytes=fixture(),before=bytes.slice(),parsed=readGainMapJPEG(bytes);
  assert.ok(parsed);assert.equal(parsed.colorSpace,'srgb');assert.equal(parsed.orientation,1);
  assert.deepEqual(parsed.metadata.maximum,[2,2,2]);assert.deepEqual(parsed.metadata.offsetSDR,[1/64,1/64,1/64]);
  assert.ok(new TextDecoder().decode(parsed.gain).includes('hdrgm:GainMapMax'));
  assert.ok(!new TextDecoder().decode(concat(...parsed.base)).includes('MPF'));
  assert.deepEqual(bytes,before);
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
