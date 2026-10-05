import test from 'node:test';
import assert from 'node:assert/strict';
import { transitionAt, mechanismAt, startupAt, projectionLayout, SLIDE_PITCH, GATE_Z, CHANGE_MS, STARTUP_CHANGE_MS, EXPOSURE_PEAK } from '../transition.js';

test('continuous reference timing includes 834 ms dark dwell and no crossfade',()=>{
  assert.equal(transitionAt(0).phase,'out');
  assert.equal(transitionAt(132).phase,'out');
  for(let t=133;t<967;t++){
    const f=transitionAt(t);assert.equal(f.phase,'dark');assert.equal(f.open,0);assert.equal(f.exposure,0);
  }
  assert.equal(transitionAt(967).phase,'in');
  assert.equal(transitionAt(1166).phase,'in');
  assert.equal(transitionAt(1167).phase,'settle');
});
test('texture changes while the light gate is fully closed',()=>{
  const firstSwap=Array.from({length:CHANGE_MS},(_,t)=>t).find(t=>transitionAt(t).swap);
  assert.equal(firstSwap,600);assert.equal(transitionAt(firstSwap).open,0);
});
test('old slide exits laterally; incoming slit opens monotonically and settles',()=>{
  let previous=0;
  for(let t=967;t<1167;t++){
    const f=transitionAt(t);assert.ok(f.open>=previous);previous=f.open;assert.ok(f.shift<=0);assert.ok(f.exposure>=0);
  }
  assert.ok(transitionAt(90).shift<-.1);
  const end=transitionAt(CHANGE_MS);assert.equal(end.open,1);assert.equal(end.boost,1);assert.equal(end.blur,0);assert.equal(end.exposure,1);
});

test('one continuous exposure recovery drives blackout emitters and entering photos',()=>{
  for(const [sample,duration] of [[transitionAt,CHANGE_MS],[startupAt,STARTUP_CHANGE_MS]]){
    let previous=sample(0).adaptation;
    for(let ms=0;ms<=duration;ms++){
      const f=sample(ms);
      assert.equal(f.boost,f.adaptation);
      assert.ok(Math.abs(f.exposure-f.open*f.adaptation)<1e-12);
      assert.ok(f.adaptation>=1&&f.adaptation<=EXPOSURE_PEAK);
      assert.ok(Math.abs(f.adaptation-previous)<.004,'no exposure step at a phase boundary');previous=f.adaptation;
      if(f.phase==='dark'||f.phase==='in')assert.equal(f.adaptation,EXPOSURE_PEAK);
    }
    assert.equal(sample(duration).adaptation,1);
  }
});

test('transport clears the old mount before indexing, then inserts an aligned new mount',()=>{
  for(const reverse of [false,true])for(let ms=0;ms<=CHANGE_MS;ms++){
    const f=mechanismAt(ms,reverse);
    if(f.indexing>0)assert.equal(f.extraction,1,'old slide must be returned to its slot');
    if(f.insertion>0){assert.equal(f.indexing,1,'tray must stop before insertion');assert.equal(f.newZ,GATE_Z,'incoming mount must align with the throat');}
    if(ms<390)assert.ok(Math.abs(f.trayZ)===0);
    assert.ok(f.leak>0,'the lamp does not extinguish during gate blackout');
  }
});
test('backward transport reverses only indexing and both mounts retain their identities',()=>{
  for(let ms=0;ms<=CHANGE_MS;ms++){
    const a=mechanismAt(ms),b=mechanismAt(ms,true);
    assert.equal(a.oldX,b.oldX);assert.equal(a.newX,b.newX);assert.equal(a.trayZ,-b.trayZ);
    if(ms>0){const p=mechanismAt(ms-1);assert.ok(a.oldX>=p.oldX);assert.ok(a.newX<=p.newX);assert.ok(Math.abs(a.oldX-p.oldX)<.01);}
  }
  assert.equal(mechanismAt(0).oldX,.56);assert.equal(mechanismAt(CHANGE_MS).newX,.56);
  assert.equal(mechanismAt(CHANGE_MS).trayZ,-SLIDE_PITCH);
});

test('empty gate wipes out, stays dark, then inserts the first photo with the mechanism',()=>{
  assert.equal(startupAt(0).phase,'out');
  for(let ms=200;ms<1000;ms++){const f=startupAt(ms);assert.equal(f.open,0);assert.equal(f.exposure,0);}
  const swap=Array.from({length:STARTUP_CHANGE_MS},(_,ms)=>ms).find(ms=>startupAt(ms).swap);
  assert.equal(startupAt(swap).phase,'dark');
  assert.equal(startupAt(1000).phase,'in');assert.equal(startupAt(1300).phase,'settle');
  assert.equal(startupAt(STARTUP_CHANGE_MS).mechanicalMs,CHANGE_MS);
  assert.equal(startupAt(STARTUP_CHANGE_MS).exposure,1);
});
test('portrait and landscape share a centred optical field and fit inside its octagon',()=>{
  for(const [w,h] of [[1440,960],[390,844],[844,390]])for(const zoom of [.7,1,1.5]){
    const a=projectionLayout(w,h,1.5,zoom),b=projectionLayout(w,h,1/1.5,zoom);
    assert.equal(a.aperture,b.aperture);assert.equal(a.width,b.height);
    assert.equal(a.width,a.aperture);assert.equal(b.height,b.aperture);
    for(const ratio of [.4,.667,1,1.5,2.5]){
      const f=projectionLayout(w,h,ratio,zoom);
      assert.ok(f.width<=f.aperture+.001&&f.height<=f.aperture+.001);
      assert.ok(f.width+f.height<=f.aperture*1.68+.001);
    }
  }
});
