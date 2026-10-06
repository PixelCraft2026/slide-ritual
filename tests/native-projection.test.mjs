import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeProjection, nativeKeyframes, nativeWipe } from '../native-projection.js';
import { transitionAt, startupAt } from '../transition.js';
import { transportHarness } from './helpers/transport-harness.mjs';

const shift=transform=>Number(transform.match(/translate3d\(([^%]+)%/)[1])/100;
function element(){return{style:{setProperty(name,value){this[name]=value;}},animations:[],animate(keyframes,options){const animation={keyframes,options,currentTime:0,cancel(){this.cancelled=true;}};this.animations.push(animation);return animation;}};}

test('fixed-clip countertranslations preserve the visible image and source coordinates at every phase',()=>{
  for(const [at,duration]of [[transitionAt,1500],[startupAt,1850]])for(let ms=0;ms<=duration;ms++){
    const f=at(ms),wipe=nativeWipe(f),g=shift(wipe.gate),c=shift(wipe.contents);
    assert.ok(Math.abs(g+c-f.shift)<1e-12);
    const left=Math.max(g,g+c),right=Math.min(g+1,g+c+1);
    assert.ok(Math.abs(left-f.shift)<1e-12);assert.ok(Math.abs(right-(f.shift+1-f.clipRight))<1e-12);
    assert.ok(!/scale/.test(wipe.gate+wipe.contents));
  }
});

test('native timelines animate translation only and retain opening and closing landmarks',()=>{
  for(const opening of [false,true]){
    const frames=nativeKeyframes(opening);assert.equal(frames.gate[0].offset,0);assert.equal(frames.gate.at(-1).offset,1);
    assert.equal(frames.gate.length,frames.contents.length);
    for(const keyframe of [...frames.gate,...frames.contents])assert.deepEqual(Object.keys(keyframe).sort(),['offset','transform']);
    for(const ms of opening?[200,1000,1300]:[133,600,967,1167])assert.ok(frames.gate.some(frame=>Math.abs(frame.offset-ms/frames.duration)<1e-12));
  }
});

test('reduced motion keeps the native photo stationary while its light gate opens',()=>{
  const frames=nativeKeyframes(false,true);
  for(let i=0;i<frames.gate.length;i++)assert.ok(Math.abs(shift(frames.gate[i].transform)+shift(frames.contents[i].transform))<1e-12);
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
  assert.equal(gate.style.transform,'translate3d(0%,0,0)');assert.equal(motion.style.transform,'translate3d(0%,0,0)');
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
