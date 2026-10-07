import { toHalf } from './hdr.js';
import { canvasPresentation } from './canvas-compat.js';
import { processImagePixels, prepareImageProjection, projectionPixelsSize } from './pixels.js';
import { PHOTO_UNIFORM_BYTES,photoPadding } from './photo-motion.js';

// Projection filtering is linear-light; browser decode uses its native color
// pipeline. Canvas presentation uses extended sRGB transfer.
const wgsl = `
override standardOutput:u32=0u;
struct Params { effects:vec4f, source:vec4f, size:vec4f, photo:vec4f, paths:array<vec4f,128> }
@group(0) @binding(0) var tex:texture_2d<f32>;
@group(0) @binding(1) var sam:sampler;
@group(0) @binding(2) var<uniform> p:Params;
struct Out { @builtin(position) pos:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Out {
  let x=f32((i<<1u)&2u);let y=f32(i&2u);
  var o:Out;o.pos=vec4f(x*2.-1.,1.-y*2.,0.,1.);o.uv=vec2f(x,y);return o;
}
fn encode(v:vec3f)->vec3f { let a=abs(v); return sign(v)*select(1.055*pow(a,vec3f(1./2.4))-.055,a*12.92,a<=vec3f(.0031308)); }
fn visible(uv:vec2f)->f32 {return select(0.,1.,all(uv>=vec2f(0.))&&all(uv<=vec2f(1.)));}
fn focused(uv:vec2f,dx:vec2f,dy:vec2f)->vec4f {
  var c=textureSampleGrad(tex,sam,uv,dx,dy);
  if(p.effects.y>0.){let d=p.effects.y/p.photo.xy;c=vec4f(c.rgb*.4+(textureSampleGrad(tex,sam,uv+vec2f(d.x,0.),dx,dy).rgb+textureSampleGrad(tex,sam,uv-vec2f(d.x,0.),dx,dy).rgb+textureSampleGrad(tex,sam,uv+vec2f(0.,d.y),dx,dy).rgb+textureSampleGrad(tex,sam,uv-vec2f(0.,d.y),dx,dy).rgb)*.15,c.a);}
  return c;
}
@fragment fn fs(o:Out)->@location(0) vec4f {
  let uv=(o.uv-.5)*p.size.xy/p.photo.xy+.5;
  // Explicit gradients keep sampling valid inside uniform effect branches.
  let dx=dpdx(uv);let dy=dpdy(uv);
  let center=focused(uv,dx,dy);var c=center.rgb;var coverage=center.a*visible(uv);
  if(p.photo.z>0.) {var sum=vec3f(0.);var alpha=0.;
    for(var i=0u;i<128u;i++){if(i>=u32(p.photo.z)){break;}let path=p.paths[i];let at=uv-vec2f(path.x/p.photo.x,0.);let sample=focused(at,dx,dy);let a=sample.a*visible(at)*path.w;sum+=sample.rgb*path.z*a;alpha+=a;}
    c=sum/max(alpha,.00001);coverage=alpha/p.photo.z;
  }
  if(standardOutput==1u){
    if(p.source.z>.5){c=vec3f(dot(c,vec3f(1.22494018,-.22494018,0.)),dot(c,vec3f(-.04205695,1.04205695,0.)),dot(c,vec3f(-.01963755,-.07863605,1.09827360)));}
  }else if(p.source.z<.5) { c=vec3f(dot(c,vec3f(.82246197,.17753803,0.)),dot(c,vec3f(.0331942,.9668058,0.)),dot(c,vec3f(.01708263,.07239744,.91051993))); }
  c*=p.effects.x;
  let weights=select(vec3f(.22897456,.69173852,.07928691),vec3f(.2126,.7152,.0722),standardOutput==1u);let l=max(dot(c,weights),0.00001);
  if(p.source.y>.5 && p.source.x<.5) { let t=clamp((l-.58)/.42,0.,1.);c*=1.+(p.source.w-1.)*t*t*(3.-2.*t); }
  if(p.source.y<.5 && p.source.x>.5) { c*=min(1.,(l/(1.+l)*1.25))/l; }
  let v=dot(uv-.5,uv-.5);c*=1.-v*.22*p.effects.z;
  let noise=fract(sin(dot(o.pos.xy-vec2f((p.size.x-p.photo.x)*.5,0.),vec2f(12.9898,78.233)))*43758.5453)-.5;
  c*=vec3f(1.,1.-.009*p.effects.z,1.-.025*p.effects.z);
  var encoded=encode(c);if(p.effects.w>0. && p.effects.w!=1.){encoded=pow(max(encoded,vec3f(0.)),vec3f(1./p.effects.w));}let grain=noise*.6/255.*p.effects.z*smoothstep(.015,.08,max(encoded.r,max(encoded.g,encoded.b)));
  // Values are encoded in the presentation color space. SDR premultiplication
  // follows clipping, so transparent edge RGB never exceeds its alpha.
  var display=encoded+vec3f(grain);if(standardOutput==1u){display=clamp(display,vec3f(0),vec3f(1));}
  if(p.size.z>.5){let alpha=clamp(coverage*p.size.w,0.,1.);return vec4f(display*alpha,alpha);}
  return vec4f(display,1.);
}`;

const vertexGL=`#version 300 es
in vec2 pos;out vec2 uv;void main(){uv=pos*.5+.5;gl_Position=vec4(pos.x,-pos.y,0.,1.);}`;
const fragmentGL=`#version 300 es
precision highp float;uniform sampler2D tex;uniform vec4 effects;uniform vec4 source;uniform vec2 size;uniform vec2 transparency;uniform vec4 photo;uniform vec4 paths[128];in vec2 uv;out vec4 outputColor;
vec3 encode(vec3 v){vec3 a=abs(v);return sign(v)*mix(1.055*pow(a,vec3(1./2.4))-.055,a*12.92,lessThanEqual(a,vec3(.0031308)));}
float visible(vec2 at){return float(all(greaterThanEqual(at,vec2(0)))&&all(lessThanEqual(at,vec2(1))));}
vec4 focused(vec2 at){vec4 c=texture(tex,at);if(effects.y>0.){vec2 d=effects.y/photo.xy;c.rgb=c.rgb*.4+(texture(tex,at+vec2(d.x,0.)).rgb+texture(tex,at-vec2(d.x,0.)).rgb+texture(tex,at+vec2(0.,d.y)).rgb+texture(tex,at-vec2(0.,d.y)).rgb)*.15;}return c;}
void main(){vec2 at=(uv-.5)*size/photo.xy+.5;vec4 center=focused(at);vec3 c=center.rgb;float coverage=center.a*visible(at);
if(photo.z>0.){vec3 sum=vec3(0);float alpha=0.;for(int i=0;i<128;i++){if(i>=int(photo.z))break;vec4 path=paths[i];vec2 sampleAt=at-vec2(path.x/photo.x,0.);vec4 sampleColor=focused(sampleAt);float a=sampleColor.a*visible(sampleAt)*path.w;sum+=sampleColor.rgb*path.z*a;alpha+=a;}c=sum/max(alpha,.00001);coverage=alpha/photo.z;}
if(source.z>.5){c=vec3(dot(c,vec3(1.22494018,-.22494018,0.)),dot(c,vec3(-.04205695,1.04205695,0.)),dot(c,vec3(-.01963755,-.07863605,1.09827360)));}
c*=effects.x;float l=max(dot(c,vec3(.2126,.7152,.0722)),.00001);if(source.x>.5)c*=min(1.,l/(1.+l)*1.25)/l;
c*=1.-dot(at-.5,at-.5)*.22*effects.z;float n=fract(sin(dot(gl_FragCoord.xy-vec2((size.x-photo.x)*.5,0.),vec2(12.9898,78.233)))*43758.5453)-.5;c*=vec3(1.,1.-.009*effects.z,1.-.025*effects.z);vec3 encoded=encode(c);if(effects.w>0. && effects.w!=1.)encoded=pow(max(encoded,vec3(0)),vec3(1./effects.w));float grain=n*.6/255.*effects.z*smoothstep(.015,.08,max(encoded.r,max(encoded.g,encoded.b)));float a=transparency.x>.5?clamp(coverage*transparency.y,0.,1.):1.;outputColor=vec4((encoded+grain)*a,a);}`;

export async function decodeImage(image,viewport) {
  const scale=Math.min(1,2560/Math.max(image.naturalWidth,image.naturalHeight),Math.sqrt(3_000_000/(image.naturalWidth*image.naturalHeight)));
  const width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{colorSpace:'display-p3',colorType:'float16',willReadFrequently:true});
  canvas.configureHighDynamicRange?.({mode:'extended'});
  // Browser coarse reduction avoids reading every native pixel of a large photo.
  // "high" is a quality hint, not a promise of a particular browser kernel.
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,width,height);
  let pixels;try{pixels=ctx.getImageData(0,0,width,height,{colorSpace:'display-p3',pixelFormat:'rgba-float16'});}catch{pixels=ctx.getImageData(0,0,width,height);}
  const colorSpace=pixels.colorSpace||ctx.getContextAttributes?.().colorSpace||'srgb';
  canvas.width=canvas.height=1;
  return processImagePixels(pixels.data,width,height,colorSpace,viewport);
}

export class ProjectionRenderer {
  constructor(canvas,onFailure,{transparent=false,photo=false}={}){this.canvas=canvas;this.onFailure=onFailure;this.transparent=transparent;this.photo=photo;this.alpha=transparent||photo;this.mode='none';this.hdr=false;this.hdrSupported=false;this.source=null;this.params={brightness:1,focus:0,texture:.22,highlight:2,motion:0,boost:1,opacity:1};}
  async init({sdrOnly=false}={}){
    this.presentation=canvasPresentation();
    if(navigator.gpu&&!sdrOnly){
      try{
        const adapter=await navigator.gpu.requestAdapter();
        if(!adapter)throw new Error('No adapter');
        this.device=await adapter.requestDevice();this.gpu=this.canvas.getContext('webgpu');
        if(!this.gpu)throw new Error('No WebGPU context');
        this.mode='webgpu';
        this.gpu.configure({device:this.device,format:this.presentation.format,alphaMode:this.alpha?'premultiplied':'opaque',colorSpace:this.presentation.colorSpace,toneMapping:{mode:this.presentation.floating?'extended':'standard'}});
        this.hdrSupported=this.presentation.floating&&this.gpu.getConfiguration?.().toneMapping?.mode==='extended';
        this.configure(false);
        this.device.addEventListener('uncapturederror',e=>{e.preventDefault();this.onFailure?.(e.error.message);});
        this.device.lost.then(info=>{if(info.reason!=='destroyed')this.onFailure?.('显卡渲染连接已中断，请重新载入页面');});
        const module=this.device.createShaderModule({code:wgsl});
        const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
        if(errors.length)throw new Error(errors.map(m=>m.message).join('\n'));
        this.pipeline=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',constants:{standardOutput:this.presentation.floating?0:1},targets:[{format:this.presentation.format}]},primitive:{topology:'triangle-list'}});
        this.uniform=this.device.createBuffer({size:PHOTO_UNIFORM_BYTES,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        this.sampler=this.device.createSampler({magFilter:'linear',minFilter:'linear'});
        return;
      }catch(error){
        this.device?.destroy();this.device=null;this.gpu=null;
        const replacement=this.canvas.cloneNode(false);this.canvas.replaceWith(replacement);this.canvas=replacement;
        this.hdrSupported=false;
        console.info('WebGPU unavailable; using SDR renderer:',error.message);
      }
    }
    const gl=this.gl=this.canvas.getContext('webgl2',{alpha:this.alpha,antialias:false,preserveDrawingBuffer:true});
    if(!gl){this.mode='native';return;}
    const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    this.program=gl.createProgram();gl.attachShader(this.program,compile(gl.VERTEX_SHADER,vertexGL));gl.attachShader(this.program,compile(gl.FRAGMENT_SHADER,fragmentGL));gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);const v=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(this.program,'pos');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    this.locations={effects:gl.getUniformLocation(this.program,'effects'),source:gl.getUniformLocation(this.program,'source'),size:gl.getUniformLocation(this.program,'size'),transparency:gl.getUniformLocation(this.program,'transparency'),photo:gl.getUniformLocation(this.program,'photo'),paths:gl.getUniformLocation(this.program,'paths[0]')};
    this.mode='webgl';this.hdr=false;
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.onFailure?.('显卡渲染连接已中断，请重新载入页面');});
  }
  configure(hdr){this.hdr=Boolean(hdr&&this.hdrSupported);if(this.mode==='webgpu'&&this.configuredHDR!==this.hdr){this.gpu.configure({device:this.device,format:this.presentation?.format||'rgba16float',alphaMode:this.alpha?'premultiplied':'opaque',colorSpace:this.presentation?.colorSpace||'display-p3',toneMapping:{mode:this.hdr?'extended':'standard'}});this.configuredHDR=this.hdr;}this.draw();}
  prepare(source,viewport={width:this.canvas.width,height:this.canvas.height}){
    this.halfSources??=new WeakMap();
    if(!this.halfSources.has(source))this.halfSources.set(source,new Map());
    const cache=this.halfSources.get(source),size=this.transparent?source:projectionPixelsSize(source,viewport),key=`${size.width}x${size.height}`;
    if(!cache.has(key)){
      if(this.transparent||source.width===1&&source.height===1){
        // The already blurred machine glow is magnified; it needs no resampling.
        const half=new Uint16Array(source.data.length);for(let i=0;i<half.length;i++)half[i]=toHalf(source.data[i]);cache.set(key,{data:half,width:source.width,height:source.height});
      }else if(source.preparedProjection?.width===size.width&&source.preparedProjection?.height===size.height){cache.set(key,source.preparedProjection);delete source.preparedProjection;}
      else{
        const pending=prepareImageProjection(source,viewport).then(projection=>{cache.set(key,projection);this.trimPrepared(cache,key);return projection;},error=>{cache.delete(key);throw error;});cache.set(key,pending);
      }
    }
    return cache.get(key);
  }
  trimPrepared(cache,keep){for(const key of cache.keys())if(cache.size>2&&key!==keep&&!(cache.get(key) instanceof Promise))cache.delete(key);}
  prepared(source,viewport=this.canvas){
    const cache=this.halfSources?.get(source);if(!cache)return null;
    const size=this.transparent?source:projectionPixelsSize(source,viewport===this.canvas?(this.photoSize||viewport):viewport),exact=cache.get(`${size.width}x${size.height}`);
    if(exact&&!(exact instanceof Promise))return exact;
    return [...cache.values()].find(value=>!(value instanceof Promise))||null;
  }
  upload(source,viewport=this.canvas){
    let projection=this.prepared(source,viewport);
    if(!projection){const ready=this.prepare(source,viewport);if(ready instanceof Promise)throw new Error('Prepare the photograph before uploading');projection=ready;}
    this.source=source;this.uploadProjection(projection);
  }
  uploadProjection(projection){
    const resource=this.textureResource(projection);this.activeResource=resource;
    if(this.stagedResource===resource)this.stagedResource=null;
    if(this.mode==='webgpu'){this.texture=resource.texture;this.bind=resource.bind;}
    else if(this.mode==='webgl')this.tex=resource.texture;
    this.uploadedProjection=projection;this.trimTextures();this.draw();
  }
  textureResource(projection){
    this.textureSources??=new Map();
    if(this.textureSources.has(projection))return this.textureSources.get(projection);
    const {data,width,height}=projection,resource={projection};
    if(this.mode==='webgpu'){
      resource.texture=this.device.createTexture({size:[width,height],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
      this.device.queue.writeTexture({texture:resource.texture},data,{bytesPerRow:width*8},[width,height]);
      resource.bind=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:resource.texture.createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.uniform}}]});
    }else if(this.mode==='webgl'){
      const g=this.gl;resource.texture=g.createTexture();g.bindTexture(g.TEXTURE_2D,resource.texture);
      g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAX_LEVEL,0);
      g.texImage2D(g.TEXTURE_2D,0,g.RGBA16F,width,height,0,g.RGBA,g.HALF_FLOAT,data);g.bindTexture(g.TEXTURE_2D,this.tex||null);
    }
    this.textureSources.set(projection,resource);return resource;
  }
  trimTextures(keep){
    for(const [projection,resource]of this.textureSources||[])if(this.textureSources.size>3&&resource!==this.activeResource&&resource!==this.stagedResource&&resource!==keep){
      resource.texture?.destroy?.();if(this.mode==='webgl')this.gl.deleteTexture(resource.texture);this.textureSources.delete(projection);
    }
  }
  async stage(source,viewport=this.canvas){
    const ticket=this.stageTicket=(this.stageTicket||0)+1,projection=await this.prepare(source,viewport),resource=this.textureResource(projection);if(ticket===this.stageTicket)this.stagedResource=resource;this.trimTextures(resource);
    if(!resource.ready)resource.ready=(async()=>{
      if(this.mode==='webgpu')await this.device.queue.onSubmittedWorkDone();
      else if(this.mode==='webgl'){
        const g=this.gl,sync=g.fenceSync(g.SYNC_GPU_COMMANDS_COMPLETE,0);if(!sync)throw new Error('Texture upload fence unavailable');g.flush();
        let checked=performance.now(),waited=0;
        try{while(true){const status=g.clientWaitSync(sync,0,0);if(status===g.ALREADY_SIGNALED||status===g.CONDITION_SATISFIED)break;const now=performance.now();if(!globalThis.document?.hidden)waited+=now-checked;checked=now;if(status===g.WAIT_FAILED||g.isContextLost()||waited>5000)throw new Error('Texture upload did not complete');await new Promise(resolve=>setTimeout(resolve,8));}}
        finally{g.deleteSync(sync);}
      }
    })();
    await resource.ready;return projection;
  }
  refreshProjection(){
    if(this.transparent||!this.source||this.mode==='native'||this.canvas.hidden)return;
    this.requestedProjection={source:this.source,...(this.photoSize||{width:this.canvas.width,height:this.canvas.height})};
    if(this.preparingProjection)return;
    this.preparingProjection=true;
    const refresh=async()=>{
      try{
        while(this.requestedProjection){
          const request=this.requestedProjection;this.requestedProjection=null;
          const projection=await this.prepare(request.source,request);
          const size=this.photoSize||this.canvas;
          if(!this.canvas.hidden&&request.source===this.source&&request.width===size.width&&request.height===size.height&&projection!==this.uploadedProjection)this.uploadProjection(projection);
        }
      }catch(error){this.onFailure?.(error.message);}
      finally{this.preparingProjection=false;}
    };
    refresh();
  }
  resize(width,height,travel=0){const dpr=Math.min(devicePixelRatio||1,2),pad=this.photo?photoPadding(travel):0,pw=Math.max(1,Math.round(width*dpr)),h=Math.max(1,Math.round(height*dpr)),w=pw+2*Math.ceil(pad*dpr);this.photoSize={width:pw,height:h};
    if(this.photo&&this.canvas.style){Object.assign(this.canvas.style,{position:'absolute',left:`${-pad}px`,top:'0',width:`calc(100% + ${2*pad}px)`,height:'100%'});}
    if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;this.draw();this.refreshProjection();}
  beginFrame(){this.batchDepth=(this.batchDepth||0)+1;}
  endFrame(){if(this.batchDepth>0&&--this.batchDepth===0&&this.drawPending){this.drawPending=false;this.draw();}}
  draw(){
    if(this.batchDepth){this.drawPending=true;return;}
    if(!this.source||!this.mode||this.mode==='native'||this.canvas.hidden)return;
    const p=this.params,s=this.source,photo=this.photoSize||this.canvas,motion=p.motionProfile;
    if(this.mode==='webgpu'&&this.bind){
      const data=this.uniformData??=new Float32Array(PHOTO_UNIFORM_BYTES/4);
      data.set([p.brightness*p.boost,p.focus,p.texture,this.transparent?(p.environmentGamma??1):1,s.hdr?1:0,this.hdr?1:0,s.colorSpace==='display-p3'?1:0,p.highlight,this.canvas.width,this.canvas.height,this.alpha?1:0,p.opacity,photo.width,photo.height,motion?.count||0,0]);
      if(motion)data.set(motion.data.subarray(0,motion.count*4),16);
      this.device.queue.writeBuffer(this.uniform,0,data,0,motion?16+motion.count*4:16);
      const enc=this.device.createCommandEncoder();const pass=enc.beginRenderPass({colorAttachments:[{view:this.gpu.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:this.alpha?0:1}}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bind);pass.draw(3);pass.end();this.device.queue.submit([enc.finish()]);
    }else if(this.mode==='webgl'){
      const g=this.gl;g.bindTexture(g.TEXTURE_2D,this.tex);g.viewport(0,0,this.canvas.width,this.canvas.height);g.useProgram(this.program);g.uniform4f(this.locations.effects,p.brightness*p.boost,p.focus,p.texture,this.transparent?(p.environmentGamma??1):1);g.uniform4f(this.locations.source,s.hdr?1:0,0,s.colorSpace==='display-p3'?1:0,1);g.uniform2f(this.locations.size,this.canvas.width,this.canvas.height);g.uniform2f(this.locations.transparency,this.alpha?1:0,p.opacity);g.uniform4f(this.locations.photo,photo.width,photo.height,motion?.count||0,0);if(motion)g.uniform4fv(this.locations.paths,motion.data.subarray(0,motion.count*4));g.drawArrays(g.TRIANGLES,0,3);
    }
    this.onDraw?.();
  }
}
