import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectionRenderer } from '../renderer.js';
import { ProjectorScene } from '../scene.js';

const source=(value=1)=>({width:2,height:1,data:new Float32Array([value,value,value,1,value,value,value,1]),colorSpace:'srgb',hdr:true});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function gpuRenderer(){
  const renderer=new ProjectionRenderer({width:2,height:1},()=>{}),writes=[],destroyed=[],submissions=[];
  renderer.mode='webgpu';renderer.draw=()=>{};renderer.pipeline={getBindGroupLayout(){return{};}};
  renderer.device={createTexture(descriptor){return{descriptor,createView(){return{};},destroy(){destroyed.push(this);}};},createBindGroup(){return{};},queue:{writeTexture(...args){writes.push(args);},onSubmittedWorkDone(){submissions.push(1);return Promise.resolve();}}};
  return{renderer,writes,destroyed,submissions};
}

test('next-photo GPU upload completes before activation and leaves the current photo bound',async()=>{
  const oldUsage=globalThis.GPUTextureUsage;globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};
  try{
    const {renderer,writes}=gpuRenderer(),current=source(2),next=source(4);
    await renderer.stage(current);renderer.upload(current);const active=renderer.texture;
    const fence=deferred();renderer.device.queue.onSubmittedWorkDone=()=>fence.promise;
    let done=false;const staging=renderer.stage(next).then(()=>{done=true;});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(writes.length,2);assert.equal(renderer.texture,active);assert.equal(renderer.source,current);assert.equal(done,false);
    fence.resolve();await staging;renderer.upload(next);
    assert.equal(writes.length,2);assert.notEqual(renderer.texture,active);assert.equal(renderer.source,next);
    await renderer.stage(current);renderer.upload(current);assert.equal(writes.length,2);assert.equal(renderer.texture,active);
  }finally{if(oldUsage===undefined)delete globalThis.GPUTextureUsage;else globalThis.GPUTextureUsage=oldUsage;}
});

test('GPU cache remains bounded and protects both the current and staged photo',async()=>{
  const oldUsage=globalThis.GPUTextureUsage;globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};
  try{
    const {renderer,destroyed,writes}=gpuRenderer(),current=source(1),next=source(2);
    await renderer.stage(current);renderer.upload(current);const active=renderer.texture;
    await renderer.stage(next);const staged=renderer.stagedResource.texture;
    for(let i=0;i<6;i++){const projection={width:1,height:1,data:new Uint16Array([0,0,0,0])};renderer.textureResource(projection);renderer.trimTextures();}
    assert.ok(renderer.textureSources.size<=3);assert.ok(!destroyed.includes(active));assert.ok(!destroyed.includes(staged));
    const count=writes.length;renderer.upload(next);assert.equal(writes.length,count);assert.equal(renderer.texture,staged);
  }finally{if(oldUsage===undefined)delete globalThis.GPUTextureUsage;else globalThis.GPUTextureUsage=oldUsage;}
});

test('WebGL staging waits asynchronously and restores the current texture binding',async()=>{
  const renderer=new ProjectionRenderer({width:2,height:1},()=>{});renderer.mode='webgl';renderer.draw=()=>{};
  let bound,polls=0,uploads=0,deleted=0,id=0;const bindings=[];
  renderer.gl={TEXTURE_2D:1,TEXTURE_MIN_FILTER:2,TEXTURE_MAG_FILTER:3,TEXTURE_WRAP_S:4,TEXTURE_WRAP_T:5,TEXTURE_MAX_LEVEL:6,LINEAR:7,CLAMP_TO_EDGE:8,RGBA16F:9,RGBA:10,HALF_FLOAT:11,SYNC_GPU_COMMANDS_COMPLETE:12,ALREADY_SIGNALED:13,CONDITION_SATISFIED:14,WAIT_FAILED:15,TIMEOUT_EXPIRED:16,
    createTexture(){return{id:++id};},bindTexture(target,texture){bound=texture;bindings.push(texture);},texParameteri(){},texImage2D(){uploads++;},deleteTexture(){},fenceSync(){return{};},flush(){},clientWaitSync(){return ++polls%2?16:14;},isContextLost(){return false;},deleteSync(){deleted++;}};
  const first=source(1),next=source(4);await renderer.stage(first);renderer.upload(first);renderer.gl.bindTexture(1,renderer.tex);const active=renderer.tex;
  await renderer.stage(next);assert.equal(bound,active);assert.equal(renderer.tex,active);assert.equal(uploads,2);assert.equal(deleted,2);assert.ok(polls>=4);
  renderer.upload(next);assert.equal(uploads,2);assert.notEqual(renderer.tex,active);assert.ok(bindings.includes(active));
});

test('unchanged HDR mode avoids canvas reconfiguration at every photo swap',()=>{
  const {renderer}=gpuRenderer();renderer.hdrSupported=true;let configurations=0;renderer.gpu={configure(){configurations++;}};
  renderer.configure(false);renderer.configure(false);renderer.configure(true);renderer.configure(true);assert.equal(configurations,2);
});

test('a transport frame applies lighting and mechanism changes with one scene render',()=>{
  let renders=0;const scene=Object.assign(Object.create(ProjectorScene.prototype),{renderer:{render(){renders++;}},scene:{},camera:{}});
  scene.beginFrame();scene.draw();scene.draw();scene.draw();assert.equal(renders,0);scene.endFrame();assert.equal(renders,1);
  scene.beginFrame();scene.beginFrame();scene.draw();scene.endFrame();assert.equal(renders,1);scene.endFrame();assert.equal(renders,2);
});

test('the hidden GPU surface does no stale-photo rendering while a native HDR image is active',()=>{
  const renderer=new ProjectionRenderer({hidden:true},()=>{});renderer.mode='webgpu';renderer.source=source();renderer.bind={};
  assert.doesNotThrow(()=>renderer.draw());
  renderer.beginFrame();renderer.draw();renderer.draw();assert.doesNotThrow(()=>renderer.endFrame());
});
