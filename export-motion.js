// Export-only vector gather. The renderer knows the motion, so no flow estimator
// or extra full-scene shutter renders are needed. Filtering is in linear light.
const vertex=`#version 300 es
out vec2 uv;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
const transfer=`vec3 linear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}`;
// Neutral, fixed subpixel rounding noise, at most half an 8-bit code value.
// Apply after gamma, once, to avoid colored grain and visible contour rings.
export const exportPresentation=`uniform float gamma;
  vec3 curve(vec3 c){return pow(max(c,vec3(0)),vec3(1./gamma));}
  vec3 rounding(vec3 c){float n=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))))-.5;
  return clamp(c+vec3(n/255.*smoothstep(0.,1./255.,max(c.r,max(c.g,c.b)))),0.,1.);}`;
export class ExportFilter{
  constructor(fragment,alpha=false){
    this.canvas=document.createElement('canvas');const g=this.gl=this.canvas.getContext('webgl2',{alpha,antialias:false,preserveDrawingBuffer:true});
    if(!g)throw new Error('此设备无法绘制完整导出画面');
    const compile=(type,code)=>{const s=g.createShader(type);g.shaderSource(s,code);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw new Error(g.getShaderInfoLog(s));return s;};
    const p=this.program=g.createProgram(),v=compile(g.VERTEX_SHADER,vertex),f=compile(g.FRAGMENT_SHADER,fragment);g.attachShader(p,v);g.attachShader(p,f);g.linkProgram(p);g.deleteShader(v);g.deleteShader(f);
    if(!g.getProgramParameter(p,g.LINK_STATUS))throw new Error(g.getProgramInfoLog(p));g.useProgram(p);
    this.texture=g.createTexture();g.bindTexture(g.TEXTURE_2D,this.texture);for(const axis of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,axis,g.CLAMP_TO_EDGE);for(const filter of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,filter,g.LINEAR);
  }
  location(name){return this.gl.getUniformLocation(this.program,name);}
  upload(canvas,width,height,float=false){
    const g=this.gl;if(g.isContextLost())throw new Error('导出显卡连接已中断');
    if(this.canvas.width!==width)this.canvas.width=width;if(this.canvas.height!==height)this.canvas.height=height;
    g.viewport(0,0,width,height);g.useProgram(this.program);g.bindTexture(g.TEXTURE_2D,this.texture);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,true);g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL,g.NONE);g.texImage2D(g.TEXTURE_2D,0,float?g.RGBA16F:g.RGBA,g.RGBA,float?g.HALF_FLOAT:g.UNSIGNED_BYTE,canvas);
  }
  draw(){this.gl.drawArrays(this.gl.TRIANGLES,0,3);return this.canvas;}
  dispose(){const g=this.gl;g.deleteTexture(this.texture);g.deleteProgram(this.program);g.getExtension('WEBGL_lose_context')?.loseContext();this.canvas.width=this.canvas.height=1;}
}
export class PhotoMotionBlur extends ExportFilter{
  constructor(){super(`#version 300 es
    precision highp float;uniform sampler2D image;uniform vec2 size;uniform float gate;uniform int count;uniform vec4 path[192];in vec2 uv;out vec4 color;
    ${transfer}
    void main(){vec2 p=(vec2(uv.x,1.-uv.y)-.5)*gate;vec3 sum=vec3(0);float alpha=0.;
      for(int i=0;i<192;i++){if(i>=count)break;vec4 motion=path[i];vec2 at=(p-vec2(motion.x,0))/size+.5;
        float visible=float(all(greaterThanEqual(at,vec2(0)))&&all(lessThanEqual(at,vec2(1)))&&p.x<gate*(.5-motion.y));
        float a=visible*motion.w;sum+=linear(texture(image,vec2(at.x,1.-at.y)).rgb)*motion.z*a;alpha+=a;}
      alpha/=float(count);vec3 c=encode(sum/max(alpha*float(count),.00001));color=vec4(c*alpha,alpha);
    }`,true);this.path=new Float32Array(192*4);}
  render(canvas,{width,height,gate,paths}){
    this.upload(canvas,Math.ceil(gate),Math.ceil(gate));const g=this.gl;this.path.fill(0);for(let i=0;i<paths.length;i++)this.path.set(paths[i],i*4);
    g.uniform2f(this.location('size'),width,height);g.uniform1f(this.location('gate'),gate);g.uniform1i(this.location('count'),paths.length);g.uniform4fv(this.location('path[0]'),this.path);return this.draw();
  }
}
export class EnvironmentGamma extends ExportFilter{
  constructor(){super(`#version 300 es
    precision highp float;uniform sampler2D image;in vec2 uv;out vec4 color;
    ${exportPresentation}
    void main(){color=vec4(rounding(curve(texture(image,uv).rgb)),1);}`);}
  render(canvas,gamma){this.upload(canvas,canvas.width,canvas.height,true);this.gl.uniform1f(this.location('gamma'),gamma);return this.draw();}
}

// Per-object projected motion for the 3D mechanism. Reuse the lit color buffer,
// render one inexpensive velocity/depth pass, then gather along those vectors.
export class MachineMotionBlur{
  constructor(scene,T){
    this.scene=scene;this.T=T;this.previous=new Map();const r=scene.renderer,w=scene.canvas.width,h=scene.canvas.height;
    this.color=new T.FramebufferTexture(w,h);this.color.minFilter=this.color.magFilter=T.LinearFilter;
    this.velocity=new T.WebGLRenderTarget(w,h,{type:T.HalfFloatType,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true});
    this.velocityMaterial=new T.ShaderMaterial({uniforms:{previousMVP:{value:new T.Matrix4()},shutter:{value:.5}},vertexShader:`
      uniform mat4 previousMVP;uniform float shutter;varying vec2 velocity;varying float depth;
      void main(){vec4 current=projectionMatrix*modelViewMatrix*vec4(position,1);vec4 previous=previousMVP*vec4(position,1);
        velocity=(current.xy/current.w-previous.xy/previous.w)*.5*shutter;depth=current.z/current.w*.5+.5;gl_Position=current;}`,
      fragmentShader:`varying vec2 velocity;varying float depth;void main(){gl_FragColor=vec4(velocity,depth,1);}`,toneMapped:false});
    this.material=new T.ShaderMaterial({uniforms:{image:{value:this.color},motion:{value:this.velocity.texture},pixel:{value:new T.Vector2(1/w,1/h)}},vertexShader:`varying vec2 uvOut;void main(){uvOut=uv;gl_Position=vec4(position.xy,0,1);}`,
      fragmentShader:`uniform sampler2D image;uniform sampler2D motion;uniform vec2 pixel;varying vec2 uvOut;
        vec3 linear(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
        vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
        void main(){vec4 center=texture2D(motion,uvOut);vec2 v=center.xy;
          if(dot(v/pixel,v/pixel)<.25){gl_FragColor=texture2D(image,uvOut);return;}
          vec3 c=vec3(0);float alpha=0.,weight=0.;
          for(int i=0;i<24;i++){vec2 at=uvOut+v*((float(i)+.5)/24.-.5);vec4 m=texture2D(motion,at);
            float accept=float(m.a<.5||abs(m.z-center.z)<.002);vec4 sampleColor=texture2D(image,at);c+=linear(sampleColor.rgb/max(sampleColor.a,.00001))*sampleColor.a*accept;alpha+=sampleColor.a*accept;weight+=accept;}
          float a=alpha/max(weight,.00001);gl_FragColor=vec4(encode(c/max(alpha,.00001))*a,a);}`,transparent:true,blending:T.NoBlending,toneMapped:false});
    this.quad=new T.Scene();this.geometry=new T.PlaneGeometry(2,2);this.quad.add(new T.Mesh(this.geometry,this.material));this.camera=new T.Camera();
  }
  apply(time,shutter){
    const s=this.scene,r=s.renderer,T=this.T;s.scene.updateMatrixWorld(true);s.camera.updateMatrixWorld(true);
    const vp=new T.Matrix4().multiplyMatrices(s.camera.projectionMatrix,s.camera.matrixWorldInverse),callbacks=[];
    this.velocityMaterial.uniforms.shutter.value=this.lastTime==null?0:Math.min(1,shutter/Math.max(1,time-this.lastTime));
    s.scene.traverse(o=>{if(!o.isMesh)return;const mvp=new T.Matrix4().multiplyMatrices(vp,o.matrixWorld),old=this.previous.get(o);this.previous.set(o,{mvp,visible:o.visible});
      const callback=o.onBeforeRender;callbacks.push([o,callback]);o.onBeforeRender=()=>{this.velocityMaterial.uniforms.previousMVP.value.copy(old?.visible?old.mvp:mvp);this.velocityMaterial.uniformsNeedUpdate=true;};});
    try{
      r.copyFramebufferToTexture(new T.Vector2(0,0),this.color);r.setRenderTarget(this.velocity);r.setClearColor(0,0);r.clear();s.scene.overrideMaterial=this.velocityMaterial;r.render(s.scene,s.camera);s.scene.overrideMaterial=null;
      r.setRenderTarget(null);r.clear();r.render(this.quad,this.camera);
    }finally{s.scene.overrideMaterial=null;r.setRenderTarget(null);for(const[o,callback]of callbacks)o.onBeforeRender=callback;this.lastTime=time;}
  }
  reset(){this.previous.clear();this.lastTime=null;}
  dispose(){this.color.dispose();this.velocity.dispose();this.velocityMaterial.dispose();this.material.dispose();this.geometry.dispose();this.previous.clear();}
}
