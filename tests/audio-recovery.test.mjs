import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectorAudio} from '../audio.js';

function audioHarness(plans=[],loaders={}){
  const previous={window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch},contexts=[];let fetches=0;
  const param=()=>({value:0,cancelScheduledValues(){},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;}});
  class Context{
    constructor(){this.plan=plans[contexts.length]||{};this.state='suspended';this.born=Date.now();this.sampleRate=100;this.destination={};this.sources=[];contexts.push(this);}
    get currentTime(){return this.state==='running'&&!this.plan.frozen?(Date.now()-this.born)/1000:0;}
    createGain(){return{gain:param(),connect(){},disconnect(){}};}
    createBufferSource(){const source={playbackRate:param(),connect(){},disconnect(){this.disconnected=true;},start(){this.started=true;},stop(){this.stopped=true;this.onended?.();}};this.sources.push(source);return source;}
    createBuffer(channels,length){return{duration:8,getChannelData:()=>new Float32Array(length)};}
    decodeAudioData(){return Promise.resolve({duration:8});}
    resume(){this.resumes=(this.resumes||0)+1;if(this.plan.pending)return new Promise(()=>{});if(this.plan.reject)return Promise.reject(new Error('Interrupted'));this.state=this.plan.interrupted?'interrupted':'running';return Promise.resolve();}
    suspend(){this.state='suspended';return this.plan.pendingSuspend?new Promise(()=>{}):Promise.resolve();}
    close(){this.state='closed';this.closed=true;return Promise.resolve();}
  }
  globalThis.window={AudioContext:Context};globalThis.document={hidden:false};globalThis.fetch=async url=>{fetches++;const name=url.match(/assets\/(\w+)\./)[1];return loaders[name]?loaders[name]():{ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};
  const audio=new ProjectorAudio();audio.resumeTimeout=20;audio.probeDelay=8;
  return{audio,contexts,get fetches(){return fetches;},close(){audio.dropContext();Object.assign(globalThis,previous);}};
}

test('a healthy background return restores the fan once and preserves volume and sound preferences',async()=>{
  const h=audioHarness();try{
    h.audio.setVolume(.31);h.audio.setFanVolume(.12);assert.equal(await h.audio.unlock(),true);h.audio.startFan();
    const first=h.audio.fan;h.audio.suspend();assert.equal(first.stopped,true);assert.equal(h.audio.fanWanted,true);
    assert.equal(await h.audio.resume(),true);assert.notEqual(h.audio.fan,first);assert.equal(h.contexts.length,1);
    await Promise.all([h.audio.resume(),h.audio.resume()]);assert.equal(h.contexts[0].sources.filter(s=>!s.stopped).length,1);
    assert.equal(h.audio.volume,.31);assert.equal(h.audio.fanVolume,.12);assert.equal(h.audio.enabled,true);
  }finally{h.close();}
});

test('a never-resolving Safari resume settles and the next gesture recreates its graph using cached audio',async()=>{
  const h=audioHarness();try{
    await h.audio.unlock();h.audio.startFan();h.audio.suspend();h.contexts[0].plan.pending=true;
    assert.equal(await h.audio.resume(),false);assert.equal(h.audio.needsRecovery,true);
    assert.equal(await h.audio.unlock(),true);assert.equal(h.contexts[0].closed,true);assert.equal(h.contexts.length,2);
    assert.ok(h.contexts[1].sources.includes(h.audio.fan));assert.equal(h.fetches,2);
  }finally{h.close();}
});

test('running with a frozen audio clock is detected and recovered in a gesture',async()=>{
  const h=audioHarness();try{
    await h.audio.unlock();h.audio.startFan();h.audio.suspend();h.contexts[0].plan.frozen=true;
    assert.equal(await h.audio.resume(),false);assert.equal(h.contexts[0].state,'running');
    assert.equal(await h.audio.resume({gesture:true}),true);assert.equal(h.contexts.length,2);assert.ok(h.audio.fan);
  }finally{h.close();}
});

test('a new foreground gesture supersedes a pending resume instead of waiting for the old context',async()=>{
  const h=audioHarness();try{
    await h.audio.unlock();h.audio.startFan();h.audio.suspend();h.contexts[0].plan.pending=true;
    const oldAttempt=h.audio.resume(),newAttempt=h.audio.resume({gesture:true});
    assert.equal(h.contexts.length,2,'context creation happens synchronously in the gesture');
    assert.equal(await newAttempt,true);assert.equal(await oldAttempt,false);assert.equal(h.audio.needsRecovery,false);
  }finally{h.close();}
});

test('muting or powering off during interruption prevents unintended fan playback on return',async()=>{
  const h=audioHarness();try{
    await h.audio.unlock();h.audio.startFan();h.audio.suspend();h.audio.setEnabled(false);
    assert.equal(await h.audio.resume(),false);assert.equal(h.audio.fan,null);
    h.audio.setEnabled(true);assert.equal(await h.audio.unlock(),true);assert.ok(h.audio.fan);
    h.audio.suspend();h.audio.stopFan();await h.audio.resume();assert.equal(h.audio.fan,null);assert.equal(h.audio.fanWanted,false);
  }finally{h.close();}
});

test('an interrupted or closed context is replaced on a gesture without duplicating the fan loop',async()=>{
  const h=audioHarness();try{
    await h.audio.unlock();h.audio.startFan();h.contexts[0].state='interrupted';
    assert.equal(await h.audio.resume({gesture:true}),true);const second=h.contexts[1];
    second.state='closed';assert.equal(await h.audio.unlock(),true);assert.equal(h.contexts.length,3);
    assert.equal(h.contexts.flatMap(c=>c.sources).filter(s=>!s.stopped).length,1);
  }finally{h.close();}
});

test('explicitly enabling sound rebuilds even a context whose state and clock falsely look healthy',async()=>{
  const h=audioHarness();try{
    await h.audio.unlock();h.audio.startFan();h.audio.setEnabled(false);h.audio.setEnabled(true);
    const ready=h.audio.unlock({rebuild:true});assert.equal(h.contexts.length,2,'replacement is created in the button gesture');
    assert.equal(await ready,true);assert.equal(h.fetches,2);assert.equal(h.contexts[0].closed,true);assert.ok(h.audio.fan);
  }finally{h.close();}
});

test('cold audio download does not block gesture unlocking and fan loads independently',async()=>{
  let releaseFan,releaseAdvance;
  const h=audioHarness([],{fan:()=>new Promise(r=>{releaseFan=r;}),advance:()=>new Promise(r=>{releaseAdvance=r;})});
  try{
    const prefetch=h.audio.preload();assert.equal(await h.audio.unlock(),true);
    h.audio.startFan();assert.equal(Boolean(h.audio.fan),false);assert.equal(h.fetches,2);
    releaseFan({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});
    await new Promise(r=>setImmediate(r));assert.ok(h.audio.fan);assert.equal(h.audio.buffers.advance,undefined);
    releaseAdvance({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});await prefetch;await h.audio.loading;
    assert.equal(h.fetches,2);assert.equal(h.contexts[0].sources.filter(s=>!s.stopped).length,1);
  }finally{h.close();}
});

test('a late fan download respects muting and a power-off request',async()=>{
  let release;const h=audioHarness([],{fan:()=>new Promise(r=>{release=r;})});
  try{
    await h.audio.unlock();h.audio.startFan();h.audio.setEnabled(false);h.audio.stopFan();
    release({ok:true,arrayBuffer:async()=>new ArrayBuffer(8)});await h.audio.loading;
    assert.equal(Boolean(h.audio.fan),false);assert.equal(h.audio.fanWanted,false);assert.equal(h.audio.enabled,false);
  }finally{h.close();}
});
