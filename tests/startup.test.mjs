import test from 'node:test';
import assert from 'node:assert/strict';
import {transportHarness} from './helpers/transport-harness.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function startupControls(){
  const holds=[],audio={unlock:()=>new Promise(()=>{}),click(){},startFan(){this.wanted=true;},stopFan(){this.wanted=false;},stopAdvance(){},advance(){}};
  return{holds,audio,delay(ms){const wait=deferred();holds.push({ms,...wait});return wait.promise;}};
}

test('a cold photo and stalled audio cannot delay the initial lamp response',async()=>{
  const c=startupControls(),photo=deferred();const h=await transportHarness({...c,decodeImage:()=>photo.promise});
  try{
    const source=h.env.cache.get(h.env.state.slides[0]).source;
    h.env.cache.clear();h.env.state.on=false;h.env.state.started=false;
    const startup=h.api.power();
    assert.equal(h.env.state.on,true);assert.equal(h.env.state.busy,true);
    assert.equal(h.env.room.dataset.phase,'warmup');assert.equal(h.env.room.style['--lamp'],'.25');
    assert.equal(c.audio.wanted,true);assert.equal(c.holds[0].ms,550);
    assert.equal(h.env.nextDownload.slide,h.env.state.slides[1]);
    assert.equal(h.env.slideLoads.has(h.env.state.slides[1]),false,'opening fetches the next photo without starting its pixel work');
    c.holds[0].resolve();await turn();
    assert.equal(h.env.room.dataset.phase,'aperture');assert.equal(c.holds[1].ms,5000);
    assert.equal(h.env.room.style['--lamp'],'1');
    await h.api.power();photo.resolve(source);c.holds[1].resolve();await startup;
    assert.equal(h.env.state.on,false);assert.equal(c.audio.wanted,false);
  }finally{await h.close();}
});

test('photo preparation overlaps the five-second white field without shortening it',async()=>{
  const c=startupControls(),h=await transportHarness(c);
  try{
    h.env.state.on=false;const startup=h.api.power();
    c.holds[0].resolve();await turn();
    // Resource preparation has already completed, but transport must still wait.
    for(let i=0;i<5;i++)await turn();
    assert.equal(h.env.room.dataset.phase,'aperture');assert.equal(h.env.state.aperture,true);
    assert.equal(h.metrics.frames.length,0);assert.equal(c.holds[1].ms,5000);
    await h.api.power();c.holds[1].resolve();await startup;
    assert.equal(h.env.state.on,false);
  }finally{await h.close();}
});

test('an early photo failure is handled and returns the projector to standby',async()=>{
  const c=startupControls(),h=await transportHarness({...c,decodeImage:async()=>{throw new Error('Photo unavailable');}});
  try{
    h.env.cache.clear();h.env.state.on=false;const startup=h.api.power();
    await turn();c.holds[0].resolve();await turn();c.holds[1].resolve();await startup;
    assert.equal(h.env.state.on,false);assert.equal(h.env.state.busy,false);
    assert.equal(c.audio.wanted,false);assert.equal(h.env.room.style['--lamp'],'0');
    assert.deepEqual(h.metrics.errors,['Photo unavailable']);
  }finally{await h.close();}
});

test('prefetch and a simultaneous first click share one photo decode',async()=>{
  const photo=deferred();let decodes=0;const h=await transportHarness({decodeImage:()=>{decodes++;return photo.promise;}});
  try{
    const slide=h.env.state.slides[0],source=h.env.cache.get(slide).source;h.env.cache.clear();
    const prefetched=h.api.loadSlide(slide),clicked=h.api.loadSlide(slide);await turn();
    assert.equal(decodes,1);photo.resolve(source);
    const [first,second]=await Promise.all([prefetched,clicked]);assert.equal(first,second);
    assert.equal(h.env.slideLoads.has(slide),false);
  }finally{await h.close();}
});
