import { androidCanvasWorkaround,lightContext } from './canvas-compat.js';

// Environment-only presentation. The photo and native HDR image never enter
// the environment surface. Gamma 1 keeps the original DOM compositor entirely intact.
export class GammaSurface {
  constructor(alpha=false) {
    this.canvas=document.createElement('canvas');
    const g=this.gl=this.canvas.getContext('webgl2',{alpha,antialias:false,premultipliedAlpha:true});
    if(!g)throw new Error('Environment gamma requires WebGL 2');
    const shader=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(g.getShaderInfoLog(s));return s;};
    const v=shader(g.VERTEX_SHADER,`#version 300 es
      out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
    const f=shader(g.FRAGMENT_SHADER,`#version 300 es
      precision highp float;uniform highp sampler2D image;uniform float gamma;uniform bool flipSource;in vec2 uv;out vec4 color;
      void main(){vec4 p=texture(image,vec2(uv.x,flipSource?1.-uv.y:uv.y));vec3 c=pow(max(p.rgb,vec3(0)),vec3(1./gamma));
        float n=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
        c+=vec3(n/255.*smoothstep(0.,1./255.,max(c.r,max(c.g,c.b))));
        color=vec4(clamp(c,0.,1.)*p.a,p.a);}`);
    const p=this.program=g.createProgram();g.attachShader(p,v);g.attachShader(p,f);g.linkProgram(p);g.deleteShader(v);g.deleteShader(f);
    if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(p));
    g.useProgram(p);this.gamma=g.getUniformLocation(p,'gamma');this.flipSource=g.getUniformLocation(p,'flipSource');this.texture=g.createTexture();g.bindTexture(g.TEXTURE_2D,this.texture);
    for(const axis of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,axis,g.CLAMP_TO_EDGE);
    for(const filter of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,filter,g.LINEAR);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,true);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL,g.NONE);
  }
  render(source,gamma,width=source.width,height=source.height) {
    const g=this.gl;if(g.isContextLost())throw new Error('Environment gamma graphics context was lost');
    if(this.canvas.width!==width)this.canvas.width=width;
    if(this.canvas.height!==height)this.canvas.height=height;
    g.viewport(0,0,width,height);g.useProgram(this.program);g.bindTexture(g.TEXTURE_2D,this.texture);
    const ctx=source.getContext('2d'),float=ctx?.getContextAttributes?.().colorType==='float16',typed=androidCanvasWorkaround();
    g.uniform1i(this.flipSource,typed?1:0);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,!typed);
    if(typed){
      // Do not import a floating Canvas/ImageBitmap through Android's shared
      // GPU-image path. Upload the CPU cache as ordinary texture storage.
      let data;try{data=ctx.getImageData(0,0,source.width,source.height,{pixelFormat:float?'rgba-float16':'rgba-unorm8'}).data;}catch{data=ctx.getImageData(0,0,source.width,source.height).data;}
      const half=data.BYTES_PER_ELEMENT===2,pixels=half?new Uint16Array(data.buffer,data.byteOffset,data.length):data;
      g.texImage2D(g.TEXTURE_2D,0,half?g.RGBA16F:g.RGBA,source.width,source.height,0,g.RGBA,half?g.HALF_FLOAT:g.UNSIGNED_BYTE,pixels);
    }else g.texImage2D(g.TEXTURE_2D,0,float?g.RGBA16F:g.RGBA,g.RGBA,float?g.HALF_FLOAT:g.UNSIGNED_BYTE,source);
    g.uniform1f(this.gamma,gamma);g.drawArrays(g.TRIANGLES,0,3);return this.canvas;
  }
  dispose(){const g=this.gl;g.deleteTexture(this.texture);g.deleteProgram(this.program);g.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.remove();}
}

const floatCanvas=()=>{const canvas=document.createElement('canvas');lightContext(canvas);return canvas;};
class GPUEnvironmentSurface {
  constructor(renderer){
    this.device=renderer.device;this.canvas=document.createElement('canvas');this.context=this.canvas.getContext('webgpu');
    if(!this.context)throw new Error('No WebGPU presentation surface');
    this.context.configure({device:this.device,format:'rgba16float',alphaMode:'opaque',colorSpace:'display-p3',toneMapping:{mode:'standard'}});
    const module=this.device.createShaderModule({code:`
      @group(0) @binding(0) var image:texture_2d<f32>;@group(0) @binding(1) var sam:sampler;@group(0) @binding(2) var<uniform> gamma:vec4f;
      struct Out{@builtin(position) pos:vec4f,@location(0) uv:vec2f}
      @vertex fn vs(@builtin(vertex_index) i:u32)->Out{let p=vec2f(f32((i<<1u)&2u),f32(i&2u));var o:Out;o.pos=vec4f(p.x*2.-1.,1.-p.y*2.,0.,1.);o.uv=p;return o;}
      fn linear(c:vec3f)->vec3f{return select(pow((c+.055)/1.055,vec3f(2.4)),c/12.92,c<=vec3f(.04045));}
      fn encode(c:vec3f)->vec3f{return select(1.055*pow(max(c,vec3f(0)),vec3f(1./2.4))-.055,c*12.92,c<=vec3f(.0031308));}
      @fragment fn fs(o:Out)->@location(0) vec4f{var c=pow(max(textureSample(image,sam,o.uv).rgb,vec3f(0)),vec3f(1./gamma.x));
        let n=fract(52.9829189*fract(dot(o.pos.xy,vec2f(.06711056,.00583715))))-.5;
        c=linear(clamp(c+vec3f(n/255.*smoothstep(0.,1./255.,max(c.r,max(c.g,c.b)))),vec3f(0),vec3f(1)));
        c=vec3f(dot(c,vec3f(.82246197,.17753803,0)),dot(c,vec3f(.0331942,.9668058,0)),dot(c,vec3f(.01708263,.07239744,.91051993)));
        return vec4f(encode(c),1);}`});
    this.pipeline=this.device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
    this.uniform=this.device.createBuffer({size:16,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});this.sampler=this.device.createSampler({magFilter:'linear',minFilter:'linear'});
  }
  render(source,gamma,width=source.width,height=source.height){
    const d=this.device;if(!this.texture||this.w!==source.width||this.h!==source.height){this.texture?.destroy();this.w=source.width;this.h=source.height;this.texture=d.createTexture({size:[this.w,this.h],format:'rgba16float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});
      this.bind=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture.createView()},{binding:1,resource:this.sampler},{binding:2,resource:{buffer:this.uniform}}]});}
    if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
    d.queue.copyExternalImageToTexture({source},{texture:this.texture,colorSpace:'srgb',premultipliedAlpha:false},[this.w,this.h]);
    d.queue.writeBuffer(this.uniform,0,new Float32Array([gamma,0,0,0]));const enc=d.createCommandEncoder(),pass=enc.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bind);pass.draw(3);pass.end();d.queue.submit([enc.finish()]);return this.canvas;
  }
  dispose(){this.texture?.destroy();this.uniform.destroy();this.context.unconfigure();this.canvas.remove();}
}
function ellipse(ctx,w,h,cx,cy,rx,ry,stops){
  ctx.save();ctx.translate(cx,cy);ctx.scale(rx,ry);const g=ctx.createRadialGradient(0,0,0,0,0,1);
  for(const [at,color]of stops)g.addColorStop(at,color);ctx.fillStyle=g;ctx.fillRect(-w/rx,-h/ry,2*w/rx,2*h/ry);ctx.restore();
}
export class LiveEnvironmentGamma {
  constructor(host){
    this.host=host;this.value=1;
    for(const object of [host.wall,host.air])object.onDraw=()=>this.changed();
  }
  initialize(){
    if(this.back)return;
    try{this.back=!androidCanvasWorkaround()&&this.host.renderer.mode==='webgpu'?new GPUEnvironmentSurface(this.host.renderer):new GammaSurface();}
    catch(error){this.back?.dispose();this.back=null;throw error;}
    this.back.canvas.className='gamma-environment gamma-background';this.host.element.append(this.back.canvas);
    this.bottom=floatCanvas();this.back.canvas.addEventListener('webglcontextlost',()=>this.fail());
  }
  set(value){
    this.value=value;
    this.host.scene?.setEnvironmentGamma(value);
    this.host.machine.renderer.params.environmentGamma=value;this.host.machine.draw();
    const {room,air}=this.host;air.presentationScale=value===1?null:Math.sqrt(1920*1080/(room.clientWidth*room.clientHeight));
    if(air.w){air.setLayout(air);air.draw();}
    const haze=[215,185,130].map(c=>255*(c/255)**(1/value)).join(' ');this.host.element.style.setProperty('--haze-color',haze);
    if(value===1){cancelAnimationFrame(this.frame);this.frame=null;this.host.element.classList.remove('gamma-active');return;}
    try{this.initialize();this.resize();this.backDirty=true;this.draw();this.host.element.classList.add('gamma-active');}
    catch(error){this.fail(error);}
  }
  fail(error){this.set(1);this.host.failed?.(error);}
  resize(){
    if(this.value===1||!this.back)return;
    // Broad environmental light needs no photo-resolution intermediate. Keep
    // at most 1080P worth of floating pixels; interpolate before gamma/dither.
    const {room}=this.host,w=room.clientWidth,h=room.clientHeight,scale=Math.min(devicePixelRatio||1,1.5,Math.sqrt(1920*1080/(w*h)));
    this.w=w;this.h=h;this.scale=scale;
    const width=Math.ceil(w*scale),height=Math.ceil(h*scale);if(this.bottom.width!==width)this.bottom.width=width;if(this.bottom.height!==height)this.bottom.height=height;
    this.host.air.presentationScale=scale;if(this.host.air.w)this.host.air.setLayout(this.host.air);
    this.backDirty=true;
  }
  changed(){
    if(this.value===1)return;
    this.backDirty=true;
    if(this.frame==null)this.frame=requestAnimationFrame(()=>{this.frame=null;try{this.draw();}catch(error){this.fail(error);}});
  }
  draw(){
    if(this.value===1||!this.back||!this.w)return;
    const {wall,air,state}=this.host,w=this.w,h=this.h,k=this.scale,emitted=wall.exposure||0;
    if(this.backDirty){
      const x=this.bottom.getContext('2d');x.setTransform(k,0,0,k,0,0);x.clearRect(0,0,w,h);
      const cy=h*(state.on?.37:.38),rx=Math.hypot(w*.5,h*(state.on?.63:.62)),ry=rx*h/w;
      ellipse(x,w,h,w*.5,cy,rx,ry,state.on?[[0,'#080605'],[.66,'#020202'],[1,'#000']]:[[0,'#171310'],[.66,'#080706'],[1,'#020202']]);
      if(androidCanvasWorkaround()){
        // Curve the unquantized cached light, not the 8-bit presentation canvas.
        wall.drawTo(x,w,h);air.drawTo(x);
      }else{x.drawImage(wall.canvas,0,0,w,h);x.drawImage(air.canvas,0,0,w,h);}
      const f=air.optics,shift=f?(f.shift-f.clipRight*.5)*wall.sw:0,width=wall.sw*Math.max(.15,1-(f?.clipRight||0)),spill=getComputedStyle(this.host.room).getPropertyValue('--spill');
      x.save();x.translate(w/2+shift,wall.centerY);x.rotate(.22*Math.PI/180);x.globalAlpha=Math.min(1,emitted*.3);x.filter=`blur(${16*k}px)`;x.fillStyle=`rgba(${spill},.26)`;x.fillRect(-width/2,-wall.sh/2,width,wall.sh);x.restore();
      // The native WebGPU surface stays float16 through CSS scaling, so broad
      // light can be enlarged without introducing an intermediate 8-bit step.
      const dpr=Math.min(devicePixelRatio||1,1.5);
      if(this.back.context)this.back.render(this.bottom,this.value);
      else this.back.render(this.bottom,this.value,Math.ceil(w*dpr),Math.ceil(h*dpr));
      this.backDirty=false;
    }
  }
}
