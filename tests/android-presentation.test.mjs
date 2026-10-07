import test from 'node:test';
import assert from 'node:assert/strict';
import {ProjectionRenderer} from '../renderer.js';
import {canvasPresentation} from '../canvas-compat.js';

async function initRenderer(nav,{transparent=false,photo=false}={}){
  const configs=[],pipelines=[],textures=[],shaders=[];let gpuRequests=0;
  const gpuContext={configure(config){configs.push(config);},getConfiguration(){return configs.at(-1);}};
  const device={lost:new Promise(()=>{}),addEventListener(){},createShaderModule(){return{getCompilationInfo:async()=>({messages:[]})};},createRenderPipelineAsync:async descriptor=>{pipelines.push(descriptor);return{getBindGroupLayout(){return{};}};},createBuffer(){return{};},createSampler(){return{};},createTexture(descriptor){textures.push(descriptor);return{createView(){return{};}};},createBindGroup(){return{};},queue:{writeTexture(){}}};
  const original=new Map(['navigator','GPUBufferUsage','GPUTextureUsage','devicePixelRatio'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{...nav,gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm',requestAdapter:async()=>{gpuRequests++;return{requestDevice:async()=>device};}}}});
  globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2};globalThis.devicePixelRatio=3;
  const gl={createShader:()=>({}),shaderSource(shader,source){shaders.push(source);},compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},getProgramParameter:()=>true,useProgram(){},createBuffer:()=>({}),bindBuffer(){},bufferData(){},getAttribLocation:()=>0,enableVertexAttribArray(){},vertexAttribPointer(){},getUniformLocation:(program,name)=>name,createTexture:()=>({}),bindTexture(){},texParameteri(){},texImage2D(...args){textures.push(args);}};
  const renderer=new ProjectionRenderer({width:1,height:1,style:{},addEventListener(){},getContext(type){return type==='webgpu'?gpuContext:gl;}},error=>assert.fail(error),{transparent,photo});
  try{
    await renderer.init();renderer.configure(true);
    for(const [w,h] of [[400,890],[890,400],[400,1040],[400,890]])renderer.resize(w,h,230);
    renderer.configure(false);renderer.configure(true);
    renderer.textureResource({width:1,height:1,data:new Uint16Array(4)});
    return{renderer,configs,pipelines,textures,shaders,gpuRequests};
  }finally{for(const [key,value]of original){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
}

test('Android restores WebGPU-first photos and room glow with native SDR presentation across fullscreen resizes',async()=>{
  for(const nav of [{userAgent:'Android 16; Xiaomi 15 Chrome/154'},{userAgent:'Android 16; Xiaomi 15 EdgA/154'},{userAgent:'Linux x86_64',userAgentData:{platform:'Android'}}])for(const options of [{photo:true},{transparent:true}]){
    const {renderer,configs,pipelines,textures,shaders,gpuRequests}=await initRenderer(nav,options);
    assert.equal(renderer.mode,'webgpu');assert.equal(renderer.hdrSupported,false);assert.equal(renderer.hdr,false);
    assert.equal(gpuRequests,1);assert.ok(configs.length>=1);assert.equal(pipelines.length,1);
    for(const config of configs){assert.equal(config.format,'bgra8unorm');assert.equal(config.colorSpace,'srgb');assert.equal(config.toneMapping.mode,'standard');}
    assert.equal(pipelines[0].fragment.constants.standardOutput,1);assert.equal(textures[0].format,'rgba16float');
  }
});
test('Windows and iPad retain floating P3 HDR presentation',async()=>{
  for(const userAgent of ['Windows NT 10.0 Chrome/154','iPad; CPU OS 26_0 AppleWebKit/605.1.15']){
    const {renderer,configs,pipelines}=await initRenderer({userAgent},{photo:true});
    assert.equal(renderer.hdrSupported,true);assert.equal(renderer.hdr,true);
    for(const config of configs){assert.equal(config.format,'rgba16float');assert.equal(config.colorSpace,'display-p3');}
    assert.equal(configs.at(-1).toneMapping.mode,'extended');assert.equal(pipelines[0].fragment.constants.standardOutput,0);
  }
});
test('Android desktop-mode UA metadata and either preferred native format use standard presentation',()=>{
  const nav={userAgent:'Linux x86_64 Chrome/154',userAgentData:{platform:'Android'}};
  for(const format of ['rgba8unorm','bgra8unorm'])assert.deepEqual(canvasPresentation({getPreferredCanvasFormat:()=>format},nav),{format,colorSpace:'srgb',floating:false});
  assert.equal(canvasPresentation(undefined,nav).format,'rgba8unorm');
});
