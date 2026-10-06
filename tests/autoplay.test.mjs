import test from 'node:test';
import assert from 'node:assert/strict';
import {transportHarness} from './helpers/transport-harness.mjs';

const turn=()=>new Promise(resolve=>setImmediate(resolve));
function timers(){
  let serial=0;const waits=new Map();
  return{waits,setTimeout(callback,ms){const id=++serial;waits.set(id,{callback,ms});return id;},clearTimeout(id){waits.delete(id);}};
}

for(const nativePhotos of [false,true])test(`autoplay prepares the next ${nativePhotos?'native HDR':'SDR'} photo during the four-second hold and reuses it`,async()=>{
  const clock=timers(),h=await transportHarness({...clock,nativePhotos});
  try{
    h.env.state.auto=true;const visible=h.env.state.slides[0],active=h.env.renderer?.activeResource;
    h.api.scheduleAuto();const deadline=clock.waits.get(h.env.autoTimer);
    assert.equal(deadline.ms,4000);assert.equal(h.env.upcoming.slide,h.env.state.slides[1]);
    await h.run(h.env.upcoming.pending);const ready=await h.env.upcoming.pending;
    assert.ok(ready?.prepared);assert.equal(h.env.state.index,0);assert.equal(h.env.cache.has(visible),true);
    if(active)assert.equal(h.env.renderer.activeResource,active);
    const preparedWall=ready.prepared.wall;
    const original=h.env.wall.prepare;let newPreparations=0;
    h.env.wall.prepare=function(...args){newPreparations++;return original.apply(this,args);};
    await h.run(deadline.callback());h.api.stopAuto();
    assert.equal(h.env.state.index,1);assert.equal(h.env.wall.activePrepared,preparedWall);
    // Scheduling the third photo can call prepare after the completed transport;
    // the second photo must have reused its already staged wall buffer.
    assert.equal(h.metrics.uploadsDuringTransport,0);assert.equal(h.metrics.readbacksDuringTransport,0);
    assert.equal(h.metrics.canvasCreatesDuringTransport,0);assert.equal(h.metrics.nativeSrcDuringTransport,0);
    assert.ok(newPreparations<=1);
  }finally{await h.close();}
});

test('a slow next decode starts before the deadline while the current photo remains visible',async()=>{
  let release,decodes=0;const pending=new Promise(resolve=>{release=resolve;}),clock=timers();
  const h=await transportHarness({...clock,decodeImage:()=>{decodes++;return pending;}});
  try{
    const source=h.env.cache.get(h.env.state.slides[0]).source;h.env.state.auto=true;h.api.scheduleAuto();
    const deadline=clock.waits.get(h.env.autoTimer);await turn();
    assert.equal(decodes,1);assert.equal(deadline.ms,4000);assert.equal(h.env.state.index,0);
    release(source);await h.run(h.env.upcoming.pending);await h.run(deadline.callback());h.api.stopAuto();
    assert.equal(h.env.state.index,1);assert.equal(decodes,2,'only the next cycle can begin the third decode');
  }finally{release?.(h.env.cache.values().next().value?.source);await h.close();}
});

test('a changed viewport invalidates an already prepared next presentation',async()=>{
  const clock=timers(),h=await transportHarness(clock);
  try{
    h.env.state.auto=true;h.api.scheduleAuto();await h.run(h.env.upcoming.pending);
    const old=await h.env.upcoming.pending;h.env.$('zoom').value='1.2';
    await h.goTo(1);h.api.stopAuto();
    assert.notEqual(h.env.wall.activePrepared,old.prepared.wall);
    assert.notEqual(h.env.wall.activePrepared.layout.width,old.prepared.wall.layout.width);
    assert.equal(h.metrics.uploadsDuringTransport,0);
  }finally{await h.close();}
});

test('stopping autoplay during a pending decode discards its presentation and timer',async()=>{
  let release;const pending=new Promise(resolve=>{release=resolve;}),clock=timers(),h=await transportHarness({...clock,decodeImage:()=>pending});
  try{
    h.env.state.auto=true;h.api.scheduleAuto();const work=h.env.upcoming.pending;
    await turn();h.api.stopAuto();release(h.env.cache.get(h.env.state.slides[0]).source);
    assert.equal(await work,null);assert.equal(h.env.upcoming,null);assert.equal(h.env.autoTimer,null);
    assert.equal(h.env.state.index,0);assert.equal(h.metrics.frames.length,0);
  }finally{await h.close();}
});

test('autoplay does not prepare or start a deadline while hidden, busy or importing',async()=>{
  const clock=timers(),h=await transportHarness(clock);
  try{
    h.env.state.auto=true;
    for(const flag of ['hidden','busy','importing']){
      const owner=flag==='hidden'?globalThis.document:h.env.state;owner[flag]=true;
      h.api.scheduleAuto();assert.equal(h.env.autoTimer,null);assert.equal(h.env.upcoming,null);owner[flag]=false;
    }
    h.env.state.index=2;assert.equal(h.api.nextIndex(),null);
    h.env.$('loop').checked=true;assert.equal(h.api.nextIndex(),0);
    h.env.state.slides.splice(1);h.env.state.index=0;assert.equal(h.api.nextIndex(),0);
    h.api.scheduleAuto();assert.equal(h.env.upcoming,null);assert.equal(clock.waits.get(h.env.autoTimer).ms,4000);
  }finally{await h.close();}
});
