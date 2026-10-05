import { srgbToLinear, toHalf } from './hdr.js';

// All processing is linear-light. Canvas presentation uses extended sRGB transfer.
const wgsl = `
struct Params { effects:vec4f, source:vec4f, size:vec4f }
@group(0) @binding(0) var tex:texture_2d<f32>;
@group(0) @binding(1) var sam:sampler;
@group(0) @binding(2) var<uniform> p:Params;
struct Out { @builtin(position) pos:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Out {
  let x=f32((i<<1u)&2u);let y=f32(i&2u);
  var o:Out;o.pos=vec4f(x*2.-1.,1.-y*2.,0.,1.);o.uv=vec2f(x,y);return o;
}
fn encode(v:vec3f)->vec3f { let a=abs(v); return sign(v)*select(1.055*pow(a,vec3f(1./2.4))-.055,a*12.92,a<=vec3f(.0031308)); }
@fragment fn fs(o:Out)->@location(0) vec4f {
  let uv=o.uv;let d=p.effects.y/p.size.xy;
  var c=textureSample(tex,sam,uv).rgb*.4;
  c+=(textureSample(tex,sam,uv+vec2f(d.x,0.)).rgb+textureSample(tex,sam,uv-vec2f(d.x,0.)).rgb+textureSample(tex,sam,uv+vec2f(0.,d.y)).rgb+textureSample(tex,sam,uv-vec2f(0.,d.y)).rgb)*.15;
  if(p.effects.w>0.) { var moving=vec3f(0.);for(var i=-4;i<=4;i++){moving+=textureSample(tex,sam,uv+vec2f(f32(i)*p.effects.w/p.size.x,0.)).rgb/9.;}c=mix(c,moving,.85); }
  if(p.source.z<.5) { c=vec3f(dot(c,vec3f(.82246197,.17753803,0.)),dot(c,vec3f(.0331942,.9668058,0.)),dot(c,vec3f(.01708263,.07239744,.91051993))); }
  c*=p.effects.x;
  let l=max(dot(c,vec3f(.22897456,.69173852,.07928691)),0.00001);
  if(p.source.y>.5 && p.source.x<.5) { let t=clamp((l-.58)/.42,0.,1.);c*=1.+(p.source.w-1.)*t*t*(3.-2.*t); }
  if(p.source.y<.5 && p.source.x>.5) { c*=min(1.,(l/(1.+l)*1.25))/l; }
  let v=dot(uv-.5,uv-.5);c*=1.-v*.22*p.effects.z;
  let noise=fract(sin(dot(o.pos.xy,vec2f(12.9898,78.233)))*43758.5453)-.5;
  c+=vec3f(noise*.003*p.effects.z);
  c*=vec3f(1.,1.-.009*p.effects.z,1.-.025*p.effects.z);
  // rgba16float canvas values are encoded in its declared colorSpace.
  if(p.size.z>.5){let alpha=clamp(textureSample(tex,sam,uv).a*p.size.w,0.,1.);return vec4f(encode(c)*alpha,alpha);}
  return vec4f(encode(c),1.);
}`;

const vertexGL=`#version 300 es
in vec2 pos;out vec2 uv;void main(){uv=pos*.5+.5;gl_Position=vec4(pos.x,-pos.y,0.,1.);}`;
const fragmentGL=`#version 300 es
precision highp float;uniform sampler2D tex;uniform vec4 effects;uniform vec4 source;uniform vec2 size;uniform vec2 transparency;in vec2 uv;out vec4 outputColor;
vec3 encode(vec3 v){vec3 a=abs(v);return sign(v)*mix(1.055*pow(a,vec3(1./2.4))-.055,a*12.92,lessThanEqual(a,vec3(.0031308)));}
void main(){vec2 d=effects.y/size;vec3 c=texture(tex,uv).rgb*.4;c+=(texture(tex,uv+vec2(d.x,0.)).rgb+texture(tex,uv-vec2(d.x,0.)).rgb+texture(tex,uv+vec2(0.,d.y)).rgb+texture(tex,uv-vec2(0.,d.y)).rgb)*.15;
if(effects.w>0.){vec3 moving=vec3(0.);for(int i=-4;i<=4;i++){moving+=texture(tex,uv+vec2(float(i)*effects.w/size.x,0.)).rgb/9.;}c=mix(c,moving,.85);}
if(source.z>.5){c=vec3(dot(c,vec3(1.22494018,-.22494018,0.)),dot(c,vec3(-.04205695,1.04205695,0.)),dot(c,vec3(-.01963755,-.07863605,1.09827360)));}
c*=effects.x;float l=max(dot(c,vec3(.2126,.7152,.0722)),.00001);if(source.x>.5)c*=min(1.,l/(1.+l)*1.25)/l;
c*=1.-dot(uv-.5,uv-.5)*.22*effects.z;float n=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5;c+=n*.003*effects.z;c*=vec3(1.,1.-.009*effects.z,1.-.025*effects.z);float a=transparency.x>.5?clamp(texture(tex,uv).a*transparency.y,0.,1.):1.;outputColor=vec4(encode(c)*a,a);}`;

export async function decodeImage(image) {
  const scale=Math.min(1,2560/Math.max(image.naturalWidth,image.naturalHeight),Math.sqrt(3_000_000/(image.naturalWidth*image.naturalHeight)));
  const width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d',{colorSpace:'display-p3',colorType:'float16',willReadFrequently:true});
  canvas.configureHighDynamicRange?.({mode:'extended'});
  ctx.drawImage(image,0,0,width,height);
  let pixels;
  try {pixels=ctx.getImageData(0,0,width,height,{colorSpace:'display-p3',pixelFormat:'rgba-float16'});} catch {pixels=ctx.getImageData(0,0,width,height);}
  const float=pixels.data.BYTES_PER_ELEMENT===2;
  const data=new Float32Array(width*height*4);let peak=0,peakLuminance=0;
  for(let i=0;i<data.length;i+=4){const alpha=Number(pixels.data[i+3])/(float?1:255);for(let c=0;c<3;c++){data[i+c]=srgbToLinear(Number(pixels.data[i+c])/(float?1:255))*alpha;peak=Math.max(peak,data[i+c]);}peakLuminance=Math.max(peakLuminance,.22897456*data[i]+.69173852*data[i+1]+.07928691*data[i+2]);data[i+3]=1;}
  return {data,width,height,colorSpace:pixels.colorSpace||ctx.getContextAttributes?.().colorSpace||'srgb',hdr:float&&peakLuminance>1.015,peak,float};
}

export class ProjectionRenderer {
  constructor(canvas,onFailure,{transparent=false}={}){this.canvas=canvas;this.onFailure=onFailure;this.transparent=transparent;this.mode='none';this.hdr=false;this.hdrSupported=false;this.source=null;this.params={brightness:1,focus:0,texture:.22,highlight:2,motion:0,boost:1,opacity:1};}
  async init(){
    if(navigator.gpu){
      try{
        const adapter=await navigator.gpu.requestAdapter();
        if(!adapter)throw new Error('No adapter');
        this.device=await adapter.requestDevice();this.gpu=this.canvas.getContext('webgpu');
        if(!this.gpu)throw new Error('No WebGPU context');
        this.mode='webgpu';
        this.gpu.configure({device:this.device,format:'rgba16float',alphaMode:this.transparent?'premultiplied':'opaque',colorSpace:'display-p3',toneMapping:{mode:'extended'}});
        this.hdrSupported=this.gpu.getConfiguration?.().toneMapping?.mode==='extended';
        this.configure(false);
        this.device.addEventListener('uncapturederror',e=>{e.preventDefault();this.onFailure?.(e.error.message);});
        this.device.lost.then(info=>{if(info.reason!=='destroyed')this.onFailure?.('显卡渲染连接已中断，请重新载入页面');});
        const module=this.device.createShaderModule({code:wgsl});
        const errors=(await module.getCompilationInfo()).messages.filter(m=>m.type==='error');
        if(errors.length)throw new Error(errors.map(m=>m.message).join('\n'));
        this.pipeline=await this.device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
        this.uniform=this.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
        this.sampler=this.device.createSampler({magFilter:'linear',minFilter:'linear'});
        return;
      }catch(error){
        this.device?.destroy();this.device=null;this.gpu=null;
        const replacement=this.canvas.cloneNode(false);this.canvas.replaceWith(replacement);this.canvas=replacement;
        this.hdrSupported=false;
        console.info('WebGPU unavailable; using SDR renderer:',error.message);
      }
    }
    const gl=this.gl=this.canvas.getContext('webgl2',{alpha:this.transparent,antialias:false,preserveDrawingBuffer:true});
    if(!gl){this.mode='native';return;}
    const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
    this.program=gl.createProgram();gl.attachShader(this.program,compile(gl.VERTEX_SHADER,vertexGL));gl.attachShader(this.program,compile(gl.FRAGMENT_SHADER,fragmentGL));gl.linkProgram(this.program);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);const v=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,v);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(this.program,'pos');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    this.locations={effects:gl.getUniformLocation(this.program,'effects'),source:gl.getUniformLocation(this.program,'source'),size:gl.getUniformLocation(this.program,'size'),transparency:gl.getUniformLocation(this.program,'transparency')};
    this.tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.tex);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.mode='webgl';this.hdr=false;
    this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.onFailure?.('显卡渲染连接已中断，请重新载入页面');});
  }
  configure(hdr){this.hdr=Boolean(hdr&&this.hdrSupported);if(this.mode==='webgpu')this.gpu.configure({device:this.device,format:'rgba16float',alphaMode:this.transparent?'premultiplied':'opaque',colorSpace:'display-p3',toneMapping:{mode:this.hdr?'extended':'standard'}});this.draw();}
  prepare(source){
    this.halfSources??=new WeakMap();
    if(!this.halfSources.has(source)){const half=new Uint16Array(source.data.length);for(let i=0;i<half.length;i++)half[i]=toHalf(source.data[i]);this.halfSources.set(source,half);}
    return this.halfSources.get(source);
  }
  upload(source){
    this.source=source;
    const half=this.prepare(source);
    if(this.mode==='webgpu'){
      this.texture?.destroy();this.texture=this.device.createTexture({size:[source.width,source.height],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});
      this.device.queue.writeTexture({texture:this.texture},half,{bytesPerRow:source.width*8},[source.width,source.height]);
      this.bind=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture.createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.uniform}}]});
    }else if(this.mode==='webgl'){
      const g=this.gl;g.bindTexture(g.TEXTURE_2D,this.tex);g.texImage2D(g.TEXTURE_2D,0,g.RGBA16F,source.width,source.height,0,g.RGBA,g.HALF_FLOAT,half);
    }
    this.draw();
  }
  resize(width,height){const dpr=Math.min(devicePixelRatio||1,2);this.canvas.width=Math.max(1,Math.round(width*dpr));this.canvas.height=Math.max(1,Math.round(height*dpr));this.draw();}
  draw(){
    if(!this.source||!this.mode||this.mode==='native')return;
    const p=this.params,s=this.source;
    if(this.mode==='webgpu'&&this.bind){
      this.device.queue.writeBuffer(this.uniform,0,new Float32Array([p.brightness*p.boost,p.focus,p.texture,p.motion,s.hdr?1:0,this.hdr?1:0,s.colorSpace==='display-p3'?1:0,p.highlight,this.canvas.width,this.canvas.height,this.transparent?1:0,p.opacity]));
      const enc=this.device.createCommandEncoder();const pass=enc.beginRenderPass({colorAttachments:[{view:this.gpu.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bind);pass.draw(3);pass.end();this.device.queue.submit([enc.finish()]);
    }else if(this.mode==='webgl'){
      const g=this.gl;g.viewport(0,0,this.canvas.width,this.canvas.height);g.useProgram(this.program);g.uniform4f(this.locations.effects,p.brightness*p.boost,p.focus,p.texture,p.motion);g.uniform4f(this.locations.source,s.hdr?1:0,0,s.colorSpace==='display-p3'?1:0,1);g.uniform2f(this.locations.size,this.canvas.width,this.canvas.height);g.uniform2f(this.locations.transparency,this.transparent?1:0,p.opacity);g.drawArrays(g.TRIANGLES,0,3);
    }
  }
}
