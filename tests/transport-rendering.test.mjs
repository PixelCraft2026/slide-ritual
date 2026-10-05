import test from 'node:test';
import assert from 'node:assert/strict';
import { transportHarness } from './helpers/transport-harness.mjs';

test('continuous landscape/portrait navigation prepares every resource before the entry animation',async()=>{
  const harness=await transportHarness();
  try{
    for(const index of [1,2,1]){
      const frames=await harness.goTo(index);assert.ok(frames.length>=80);
      assert.ok(frames.every(frame=>frame.sceneRenders===1&&frame.projectionRenders===1));
    }
    const result=harness.summary();
    assert.equal(result.uploadsDuringTransport,0);assert.equal(result.canvasCreatesDuringTransport,0);assert.equal(result.readbacksDuringTransport,0);
    assert.equal(result.layoutReadsDuringTransport,0);assert.equal(result.configurationsDuringTransport,0);assert.equal(result.sceneResizesDuringTransport,0);assert.equal(result.machineResizesDuringTransport,0);
    assert.ok(result.textureBytes>1_000_000);assert.ok(harness.env.renderer.textureSources.size<=3);
  }finally{await harness.close();}
});

test('cancelled transport keeps the current image and can reuse the staged next image',async()=>{
  const harness=await transportHarness();
  try{
    const current=harness.env.renderer.source;await harness.goTo(1,{interruptAt:300});
    assert.equal(harness.env.state.index,0);assert.equal(harness.env.renderer.source,current);assert.equal(harness.env.transporting,false);
    assert.equal(harness.env.renderer.batchDepth||0,0);assert.equal(harness.env.scene.batchDepth||0,0);
    const uploads=harness.metrics.textureUploads;harness.env.state.on=true;await harness.goTo(1);
    assert.equal(harness.metrics.textureUploads,uploads);assert.equal(harness.env.state.index,1);assert.equal(harness.summary().uploadsDuringTransport,0);
  }finally{await harness.close();}
});

test('zoom changes during insertion are applied after transport without rebuilding its active frames',async()=>{
  const harness=await transportHarness();
  try{
    await harness.goTo(1,{layoutAt:1000,zoom:1.2});
    assert.equal(harness.env.layoutPending,false);assert.ok(harness.env.projectionWidth>528);assert.equal(harness.summary().canvasCreatesDuringTransport,0);
    assert.equal(harness.summary().layoutReadsDuringTransport,0);
  }finally{await harness.close();}
});
