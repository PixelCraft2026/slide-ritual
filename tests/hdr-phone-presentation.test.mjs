import test from 'node:test';
import assert from 'node:assert/strict';
import { transportHarness } from './helpers/transport-harness.mjs';

const source=preferCanvasHDR=>({width:24,height:16,hdr:true,colorSpace:'display-p3',preferCanvasHDR,peak:2.4,data:new Float32Array(24*16*4).fill(1.2)});
test('affected phone HDR uses the canvas for hold and transport while a camera gain map retains native HDR',async()=>{
  const harness=await transportHarness({nativePhotos:true,decodeImage:async()=>{throw new Error('Unexpected native HDR readback');}});
  try{
    const {env}=harness,calls=[];env.renderer.hdrSupported=true;env.nativeProjection.exposureRenderer=env.renderer;
    env.nativeProjection.prepareExposure=async()=>null;
    env.decodeGainMapTransition=async(file,image,viewport,options)=>{calls.push({viewport,options});return source(image.url==='generated-1');};
    await harness.goTo(1);assert.equal(env.state.native,false);assert.equal(env.state.nativeHDR,false);assert.equal(env.renderer.hdr,true);
    assert.equal(env.cache.get(env.state.slides[1]).source.preferCanvasHDR,true);
    harness.api.fitScreen();assert.equal(env.state.native,false);assert.equal(calls.length,1);
    await harness.goTo(2);assert.equal(env.state.native,true);assert.equal(env.state.nativeHDR,true);
    assert.equal(env.cache.get(env.state.slides[2]).source.preferCanvasHDR,false);
    assert.deepEqual(calls[0].options,{compatibilityOnly:false});
    const metrics=harness.summary();assert.equal(metrics.readbacksDuringTransport,0);assert.equal(metrics.uploadsDuringTransport,0);
  }finally{await harness.close();}
});
test('phone compatibility is prepared in SDR too so enabling HDR never resurrects the native image seam',async()=>{
  const harness=await transportHarness({nativePhotos:true});
  try{
    const {env}=harness,optionsSeen=[];env.renderer.hdrSupported=true;env.nativeProjection.exposureRenderer=env.renderer;env.state.displayMode='sdr';
    env.decodeGainMapTransition=async(file,image,viewport,options)=>{optionsSeen.push(options.compatibilityOnly);return source(true);};
    await harness.goTo(1);assert.equal(env.state.native,false);assert.equal(env.renderer.hdr,false);
    env.state.displayMode='auto';await harness.goTo(2);assert.equal(env.state.native,false);assert.equal(env.renderer.hdr,true);
    assert.deepEqual(optionsSeen,[true,false]);
  }finally{await harness.close();}
});
test('unavailable gain-map decoding preserves the browser native fallback instead of claiming reconstructed HDR',async()=>{
  const harness=await transportHarness({nativePhotos:true});
  try{
    const {env}=harness;env.renderer.hdrSupported=true;env.nativeProjection.exposureRenderer=env.renderer;
    env.decodeGainMapTransition=async()=>null;env.nativeProjection.prepareExposure=async()=>null;
    await harness.goTo(1);assert.equal(env.state.native,true);assert.equal(env.state.nativeHDR,true);assert.equal(env.cache.get(env.state.slides[1]).source.hdr,false);
  }finally{await harness.close();}
});
