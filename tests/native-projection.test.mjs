import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeProjection, nativeKeyframes, nativeWipe, nativeExposureOpacity, nativePhotoBoost } from '../native-projection.js';
import { transitionAt, startupAt, EXIT_MS, EXPOSURE_PEAK } from '../transition.js';
import { transportHarness } from './helpers/transport-harness.mjs';

const shift=transform=>Number(transform.match(/translate3d\(([-\d.e]+)px/)[1]);
function element(){return{style:{setProperty(name,value){this[name]=value;}},animations:[],animate(keyframes,options){const animation={keyframes,options,currentTime:0,pause(){this.paused=true;},play(){this.paused=false;},cancel(){this.cancelled=true;}};this.animations.push(animation);return animation;}};}

test('the optical gate remains fixed and every source pixel follows the photo translation',()=>{
  for(const [at,duration]of [[transitionAt,1500],[startupAt,1850]])for(let ms=0;ms<=duration;ms++){
    const f=at(ms),wipe=nativeWipe(f),g=shift(wipe.gate),c=shift(wipe.contents);
    assert.equal(g,0);assert.ok(Math.abs(c-f.shift)<1e-12);
    for(const sourceX of [0,.25,.5,.75,1])assert.equal(sourceX+c,sourceX+f.shift);
    assert.ok(!/scale/.test(wipe.gate+wipe.contents));
  }
});

test('native timelines animate translation only and retain opening and closing landmarks',()=>{
  for(const opening of [false,true]){
    const frames=nativeKeyframes(opening);assert.equal(frames.gate[0].offset,0);assert.equal(frames.gate.at(-1).offset,1);
    assert.equal(frames.gate.length,frames.contents.length);
    for(const keyframe of [...frames.gate,...frames.contents])assert.deepEqual(Object.keys(keyframe).sort(),['offset','transform']);
    for(const ms of opening?[200,1000,1300]:[EXIT_MS,600,967,1167])assert.ok(frames.gate.some(frame=>Math.abs(frame.offset-ms/frames.duration)<1e-12));
  }
});
test('HDR motion blur is neutral on exit and retains incoming exposure in stops',()=>{
  for(const ev of [.5,1,2])for(const opening of [false,true]){
    const at=opening?startupAt:transitionAt;
    for(let ms=0;ms<(opening?1000:967);ms++){const f=at(ms);assert.equal(nativeExposureOpacity(f,false,ev),f.phase==='out'?Math.min(1,Math.abs(f.velocity)*EXIT_MS/1.5):0);if(f.phase==='out')assert.equal(nativePhotoBoost(f,ev),1);}
    const timeline=nativeKeyframes(opening,false,ev);
    assert.ok(timeline.exposure.every(frame=>frame.opacity>=0&&frame.opacity<=1));
    assert.equal(nativeExposureOpacity(at(opening?1100:1050),false,ev),1);
  }
});
test('outgoing native animations paint their paused initial pose before the transport clock starts',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'requestAnimationFrame');let paints=0;
  globalThis.requestAnimationFrame=callback=>queueMicrotask(()=>{paints++;callback(performance.now());});
  try{
    const gate=element(),projection=new NativeProjection(gate,element());projection.exposure=element();projection.activate(true);
    await projection.prepareExit();const primed=[...projection.animations];assert.equal(paints,4);assert.equal(primed.length,3);
    assert.ok(primed.every(animation=>animation.paused&&animation.currentTime===0));
    projection.start(performance.now());assert.deepEqual(projection.animations,primed);assert.equal(gate.animations.length,1);assert.ok(primed.every(animation=>!animation.paused&&!animation.cancelled));
    projection.reset();assert.ok(primed.every(animation=>animation.cancelled));
    await projection.prepareExit();projection.reset();projection.start(performance.now());assert.ok(projection.animations.every(animation=>!animation.paused&&!animation.cancelled));
    projection.reset();await projection.prepareExit(true);assert.equal(projection.animations.length,0);
    let repaint;globalThis.requestAnimationFrame=callback=>{repaint=callback;};
    const pending=projection.prepareExit();const interrupted=[...projection.animations];projection.reset();repaint(performance.now());await pending;
    assert.equal(projection.transport,null);assert.equal(projection.animations.length,0);assert.ok(interrupted.every(animation=>animation.cancelled));
  }finally{if(original)Object.defineProperty(globalThis,'requestAnimationFrame',original);else delete globalThis.requestAnimationFrame;}
});

test('reduced motion keeps the native photo stationary while its light gate opens',()=>{
  const frames=nativeKeyframes(false,true);
  for(let i=0;i<frames.gate.length;i++)assert.ok(Math.abs(shift(frames.gate[i].transform)+shift(frames.contents[i].transform))<1e-12);
  assert.ok(frames.exposure.every(frame=>frame.opacity===0));
});

test('native HDR exposure peaks during entry and returns continuously to the unchanged original',()=>{
  for(const [at,duration,start,end]of [[transitionAt,1500,967,1167],[startupAt,1850,1000,1300]]){
    assert.equal(nativeExposureOpacity(at(0)),0);assert.equal(nativePhotoBoost(at(0)),1);assert.equal(nativeExposureOpacity(at(duration)),0);
    for(let ms=start;ms<end;ms++)assert.equal(nativeExposureOpacity(at(ms)),1);
    let previous=1;
    for(let ms=end;ms<=duration;ms++){
      const opacity=nativeExposureOpacity(at(ms));assert.ok(opacity<=previous);previous=opacity;
      const envelope=(at(ms).boost-1)/(EXPOSURE_PEAK-1);
      assert.ok(Math.abs(1+opacity-2**envelope)<1e-12);
    }
  }
});

test('HDR entry exposure uses stops independently of the SDR peak and recovers monotonically',()=>{
  const halfway={boost:1+(EXPOSURE_PEAK-1)*.5};
  for(const ev of [.5,1,1.5,2]){
    const opacity=nativeExposureOpacity(halfway,false,ev);
    assert.ok(Math.abs(1+opacity*(2**ev-1)-2**(ev*.5))<1e-12);
    assert.equal(nativeExposureOpacity({boost:EXPOSURE_PEAK},false,ev),1);
    assert.equal(nativeExposureOpacity({boost:1},false,ev),0);
  }
  assert.equal(nativeExposureOpacity(halfway,false,0),0);
});

test('HDR exposure preparation requires a supported floating HDR device',async()=>{
  const projection=new NativeProjection(element(),element());
  await projection.initExposure({mode:'webgl',hdrSupported:false});
  assert.equal(await projection.prepareExposure({hdr:true},{width:720,height:480}),null);
  const renderer={mode:'webgpu',hdrSupported:true};await projection.initExposure(renderer);
  assert.equal(projection.exposureRenderer,renderer);assert.equal(await projection.prepareExposure(null,{}),null);
});

test('HDR photo exposure is uploaded before transport, keeps current/staged textures and releases bounded resources',async()=>{
  const descriptors=new Map(['document','GPUBufferUsage','GPUTextureUsage','devicePixelRatio'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  let uploads=0,destroyedTextures=0,destroyedBuffers=0,submits=0,lastUniform;
  const device={createBuffer(){return{destroy(){destroyedBuffers++;}};},createTexture(){return{createView(){return{};},destroy(){destroyedTextures++;}};},createBindGroup(){return{};},queue:{writeTexture(){uploads++;},writeBuffer(buffer,offset,data){lastUniform=data;},submit(){submits++;},async onSubmittedWorkDone(){}},createCommandEncoder(){return{beginRenderPass(){return{setPipeline(){},setBindGroup(){},draw(){},end(){}};},finish(){return{};}};}};
  globalThis.document={createElement(){const canvas=element();Object.assign(canvas,{dataset:{},width:1,height:1,setAttribute(){},remove(){},getContext(){return{configure(config){assert.equal(config.toneMapping.mode,'extended');},unconfigure(){},getCurrentTexture(){return{createView(){return{};}};}};}});return canvas;}};
  globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};globalThis.devicePixelRatio=2;
  try{
    const motion=element();motion.append=()=>{};const projection=new NativeProjection(element(),motion);
    await projection.initExposure({mode:'webgpu',hdrSupported:true,device,pipeline:{getBindGroupLayout(){return{};}},sampler:{}});
    const source=()=>({data:new Float32Array([4,2,1,1]),width:1,height:1,hdr:true,colorSpace:'srgb'});
    const current=await projection.prepareExposure(source(),{width:720,height:480});projection.activate(true,current);
    assert.equal(current.canvas.width,1440);assert.equal(current.renderer.params.boost,2);assert.equal(current.canvas.style.mixBlendMode,undefined);
    for(let i=0;i<8;i++){await projection.prepareExposure(source(),{width:720,height:480});assert.ok(projection.exposureLayers.size<=3);assert.ok([...projection.exposureLayers.values()].includes(current));}
    const before={uploads,submits};projection.start(performance.now());projection.frame(transitionAt(1000));projection.reset();assert.equal(uploads,before.uploads);assert.equal(submits,before.submits+1,'one bounded GPU blur pass, no texture upload');
    projection.setExposureEV(.5);assert.ok(Math.abs(lastUniform[0]-Math.sqrt(2))<1e-6);
    projection.clearExposures();assert.equal(projection.exposureLayers.size,0);assert.equal(destroyedTextures,9);assert.equal(destroyedBuffers,9);
  }finally{for(const [key,value]of descriptors){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
});

test('native exposure shares the transport clock and is neutral on reset, SDR selection and deactivation',()=>{
  const projection=new NativeProjection(element(),element());projection.exposure=element();
  projection.activate(true);projection.start(performance.now()-1000);
  assert.equal(projection.animations.length,3);const exposure=projection.animations.at(-1);
  assert.ok(exposure.currentTime>=1000);assert.ok(exposure.keyframes.some(frame=>frame.opacity===1));assert.equal(exposure.keyframes.at(-1).opacity,0);
  projection.setHDR(false);assert.equal(projection.exposure.hidden,true);assert.equal(projection.exposure.style.opacity,'0');assert.equal(exposure.cancelled,true);
  projection.setHDR(true);assert.equal(projection.exposure.hidden,false);projection.reset();assert.equal(projection.animations.length,0);assert.equal(projection.exposure.style.opacity,'0');
  projection.deactivate();assert.equal(projection.exposure.hidden,true);
});

test('native exposure uses the same recovery without WAAPI and never substitutes SDR for unavailable HDR compositing',async()=>{
  const gate=element(),motion=element(),projection=new NativeProjection(gate,motion);gate.animate=undefined;projection.exposure=element();
  projection.activate(true);projection.start(performance.now());projection.frame(transitionAt(1000));assert.equal(projection.exposure.style.opacity,'1');
  projection.frame(transitionAt(1500));assert.equal(projection.exposure.style.opacity,'0');
  const unsupported=new NativeProjection(element(),element());await unsupported.initExposure({mode:'webgl',hdrSupported:false});assert.equal(unsupported.exposure,undefined);
});

test('preparation keeps the original decoded HDR image and URL without resampling or CSS filtering',async()=>{
  const image=element();let decodes=0,writes=0;image.naturalWidth=7008;image.naturalHeight=4672;
  Object.defineProperty(image,'src',{get(){return'blob:original-with-gain-map';},set(){writes++;}});image.decode=async()=>{decodes++;};
  const renderer=new NativeProjection(element(),element(),element()),prepared=await renderer.prepare(image,{width:720,height:480},{hdr:true});
  assert.equal(prepared,image);assert.equal(prepared.src,'blob:original-with-gain-map');assert.equal(writes,0);assert.equal(decodes,1);
  assert.equal(image.naturalWidth,7008);assert.equal(image.naturalHeight,4672);assert.equal(image.style.filter,'none');assert.equal(image.style['dynamic-range-limit'],'no-limit');
});

test('an interrupted native decode cannot leave a late HDR staging surface on screen',async()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  const node=()=>({style:{},hidden:false,children:[],setAttribute(){},append(child){this.children.push(child);},replaceChildren(...children){this.children=children;}});
  globalThis.document={body:node(),createElement:node};
  try{
    const renderer=new NativeProjection(element(),element()),image=element();let complete;
    image.decode=()=>new Promise(resolve=>{complete=resolve;});
    const pending=renderer.prepare(image,{width:720,height:480},{hdr:true});renderer.reset();complete();await pending;
    assert.equal(renderer.staging.hidden,true);assert.equal(renderer.staging.children.length,0);assert.ok(Number(renderer.cover.style.opacity)<1);
  }finally{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;}
});

test('native compositor animations seek the shared transport clock and cancel cleanly on interruption',()=>{
  const gate=element(),motion=element(),texture=element(),renderer=new NativeProjection(gate,motion,texture);
  renderer.activate();renderer.start(performance.now()-610);
  assert.equal(renderer.animations.length,3);assert.ok(renderer.animations.every(animation=>animation.currentTime>=610&&animation.currentTime<650));
  const transform=gate.style.transform;renderer.frame(transitionAt(1000));assert.equal(gate.style.transform,transform);
  const animations=[...renderer.animations];renderer.reset();assert.ok(animations.every(animation=>animation.cancelled));assert.equal(renderer.animations.length,0);
  assert.equal(gate.style.transform,'translate3d(0px,0,0)');assert.equal(motion.style.transform,'translate3d(0px,0,0)');
});

test('unsupported or partially failing WAAPI uses the same fixed-clip geometry without leaking an animation',()=>{
  const gate=element(),motion=element(),renderer=new NativeProjection(gate,motion);motion.animate=()=>{throw new Error('Animation unavailable');};
  renderer.activate();renderer.start(performance.now());assert.equal(renderer.animations.length,0);assert.ok(gate.animations[0].cancelled);
  const f=transitionAt(1030);renderer.frame(f);assert.deepEqual({gate:gate.style.transform,contents:motion.style.transform},nativeWipe(f));
});

test('continuous native HDR landscape/portrait navigation reuses decoded nodes and avoids per-frame masks and range/filter writes',async()=>{
  const harness=await transportHarness({nativePhotos:true});
  try{
    for(const index of [1,2,1]){
      const frames=await harness.goTo(index);assert.ok(frames.length>=80);assert.ok(frames.every(frame=>frame.sceneRenders===1&&frame.projectionRenders===0));
      assert.equal(harness.env.native,harness.env.cache.get(harness.env.state.slides[index]).image);
      assert.equal(harness.env.state.nativeHDR,true);assert.equal(harness.env.native.style.filter,'none');
    }
    const result=harness.summary();assert.equal(result.nativeSrcDuringTransport,0);assert.equal(result.nativeStyleDuringTransport,0);assert.equal(result.clipMasksDuringTransport,0);
    assert.equal(result.textureUploads,0);assert.ok(result.animationStarts>=9);assert.equal(harness.metrics.animations.size,0);
  }finally{await harness.close();}
});

test('120 Hz transport caps room draws at 60 Hz while compositor motion runs independently',async()=>{
  const harness=await transportHarness({nativePhotos:true,frameStep:1000/120});
  try{
    const frames=await harness.goTo(1),drawn=frames.filter(frame=>frame.sceneRenders>0);
    assert.ok(frames.length>=175);assert.ok(drawn.length>=85&&drawn.length<=92);
    assert.ok(drawn.slice(1,-1).every((frame,i)=>frame.time-drawn[i].time>=1000/60-.1));
    assert.ok(harness.summary().animationStarts>=3);assert.equal(harness.summary().uploadsDuringTransport,0);
    assert.equal(harness.env.state.index,1);assert.equal(harness.metrics.animations.size,0);
  }finally{await harness.close();}
});

test('cancelling native HDR insertion retires compositor animations and preserves the currently selected original',async()=>{
  const harness=await transportHarness({nativePhotos:true});
  try{
    const image=harness.env.native;await harness.goTo(1,{interruptAt:300});assert.equal(harness.env.native,image);assert.equal(harness.env.state.index,0);assert.equal(harness.metrics.animations.size,0);
    harness.env.state.on=true;await harness.goTo(1);assert.equal(harness.env.state.index,1);assert.equal(harness.metrics.animations.size,0);
  }finally{await harness.close();}
});

test('native HDR and GPU SDR can alternate without retaining the previous clipping animation',async()=>{
  const slides=[{width:6000,height:4000,url:'generated-0',hdrCandidate:true},{width:6000,height:4000,url:'generated-1'},{width:4000,height:6000,url:'generated-2',hdrCandidate:true}];
  const harness=await transportHarness({nativePhotos:true,slides});
  try{
    await harness.goTo(1);assert.equal(harness.env.state.native,false);assert.equal(harness.metrics.animations.size,0);
    await harness.goTo(2);assert.equal(harness.env.state.nativeHDR,true);assert.equal(harness.env.native.src,'generated-2');assert.equal(harness.metrics.animations.size,0);
  }finally{await harness.close();}
});
