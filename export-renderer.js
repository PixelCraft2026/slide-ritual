import { timelineAt } from './export-model.js';
import { PhotoMotionBlur,MachineMotionBlur } from './export-motion.js';
import { HoldCompositor } from './export-compositor.js';

// Detached canvases with local geometry: never resize or reconfigure the viewer.
function canvasRect(left,top,width,height){
  const canvas=document.createElement('canvas');
  Object.defineProperties(canvas,{clientWidth:{value:width},clientHeight:{value:height}});
  canvas.getBoundingClientRect=()=>({left,top,width,height,right:left+width,bottom:top+height,x:left,y:top});return canvas;
}
const white={width:1,height:1,data:new Float32Array([1,1,1,1]),colorSpace:'srgb',hdr:false};
export class ExportRenderer{
  constructor(host,snapshot,width,height,fps=30){
    this.host=host;this.snapshot=snapshot;this.width=width;this.height=height;this.shutter=500/fps;
    this.scale=width/(width>height?960:540);this.w=width/this.scale;this.h=height/this.scale;this.cache=new Map();
    this.canvas=document.createElement('canvas');Object.assign(this.canvas,{width,height});this.ctx=this.canvas.getContext('2d',{colorSpace:'srgb',colorType:'float16'});
    const mobile=this.w<600,mw=mobile?this.w*1.28:Math.min(this.h*1.15,this.w*.92),mh=this.h*(mobile?.55:.63);
    this.machineRect={left:this.w*.5-mw/2,top:this.h*(1+(mobile?.05:.08))-mh-this.h*snapshot.settings.projectorY/100,width:mw,height:mh};
    const {ProjectorScene,WallLight,AirLight,MachineLight,ProjectionRenderer}=host;
    this.scene=new ProjectorScene(canvasRect(...Object.values(this.machineRect)));
    this.scene.renderer.setPixelRatio(this.scale);this.scene.renderer.setSize(mw,mh,false);
    this.scene.setPitch(snapshot.settings.projectorPitch);this.scene.setTopReflectance(snapshot.settings.topReflectance);this.scene.setEmitterAmount(snapshot.settings.machineLights);
    this.wall=new WallLight(document.createElement('canvas'));this.wall.amount=snapshot.settings.diffusion;
    this.air=new AirLight(document.createElement('canvas'),{manual:true});this.air.amount=snapshot.settings.airAmount;
    // Detach automatic animation; export owns absolute time and sampling.
    this.air.schedule=()=>{};this.air.shouldAnimate=()=>false;
    this.photo=new ProjectionRenderer(document.createElement('canvas'),()=>{});
    this.machine=new MachineLight(document.createElement('canvas'));
    Object.assign(this.photo.params,{brightness:snapshot.settings.brightness,focus:snapshot.settings.focus*this.scale,texture:snapshot.settings.texture,motion:0,highlight:1});
    this.makeBackground();this.active=null;this.stillMachine=document.createElement('canvas');this.photoBlur=new PhotoMotionBlur();
    if(host.THREE)this.machineBlur=new MachineMotionBlur(this.scene,host.THREE);
    this.hold=new HoldCompositor(width,height,snapshot.settings.environmentGamma??1);
  }
  async init(){
    if(!this.scene.renderer.extensions.has('EXT_color_buffer_float'))throw new Error('此设备不支持导出的浮点运动模糊');
    this.scene.renderer.debug.onShaderError=()=>{throw new Error('此设备无法绘制完整导出画面');};
    await Promise.all([this.photo.init({sdrOnly:true}),this.machine.renderer.init()]);
    if(this.photo.mode!=='webgl'||!['webgl','webgpu'].includes(this.machine.renderer.mode))throw new Error('此设备无法绘制完整导出画面');
    this.machine.ready=true;this.machine.setAmount(this.snapshot.settings.bloom);this.machine.setLampAmount(this.snapshot.settings.machineLights);this.machine.configure(false,1);
    this.machine.resize(this.w,this.h,this.scene,this.snapshot.settings.depth);
    for(const [name,selector]of [['surface','.surface-texture']]){
      const css=getComputedStyle(document.querySelector(selector)).backgroundImage,match=css.match(/^url\(["']?(.*?)["']?\)$/);
      if(match){
        const image=new Image();image.src=match[1];await image.decode();
        // SVG turbulence must be rasterized once, not reevaluated as a vector
        // pattern on each full-resolution output frame.
        const raster=document.createElement('canvas');raster.width=image.naturalWidth;raster.height=image.naturalHeight;raster.getContext('2d').drawImage(image,0,0);this[name]=raster;
      }
    }
  }
  makeBackground(){
    const c=this.background=document.createElement('canvas');c.width=this.width;c.height=this.height;const x=c.getContext('2d',{colorType:'float16'});x.scale(this.width,this.height);
    const g=x.createRadialGradient(.5,.37,0,.5,.37,.8);g.addColorStop(0,'#080605');g.addColorStop(.66,'#020202');g.addColorStop(1,'#000');x.fillStyle=g;x.fillRect(0,0,1,1);
  }
  layout(ratio,aperture=false){
    const {projectionLayout}=this.host,{width,height,aperture:size}=projectionLayout(this.w,this.h,ratio,this.snapshot.settings.zoom);
    return{w:this.w,h:this.h,width,height,aperture:size,sw:aperture?size:width,sh:aperture?size:height,centerY:this.h*((this.w<600?.34:.31)-this.snapshot.settings.photoY/100),lens:this.scene.lensPosition()};
  }
  async prepareSlide(index){
    if(index<0||this.cache.has(index))return;
    const slide=this.snapshot.slides[index],layout=this.layout(slide.width/slide.height),viewport={width:Math.round(layout.width*this.scale),height:Math.round(layout.height*this.scale)};
    let source;
    if(slide.file&&/\.(hdr|rgbe)$/i.test(slide.name))source=await this.host.processRadiancePixels(await slide.file.arrayBuffer(),viewport);
    else{
      const image=new Image();image.src=slide.url;await image.decode();
      // Decode from the original, to the output photo size, never the preview cache.
      const factor=Math.min(1,viewport.width/image.naturalWidth,viewport.height/image.naturalHeight),width=Math.max(1,Math.round(image.naturalWidth*factor)),height=Math.max(1,Math.round(image.naturalHeight*factor));
      const c=document.createElement('canvas');Object.assign(c,{width,height});const ctx=c.getContext('2d',{colorSpace:'display-p3',colorType:'float16',willReadFrequently:true});c.configureHighDynamicRange?.({mode:'extended'});ctx.drawImage(image,0,0,width,height);
      let pixels;try{pixels=ctx.getImageData(0,0,width,height,{colorSpace:'display-p3',pixelFormat:'rgba-float16'});}catch{pixels=ctx.getImageData(0,0,width,height);}
      source=await this.host.processImagePixels(pixels.data,width,height,pixels.colorSpace||'srgb',viewport);c.width=c.height=1;
    }
    const projection=await this.photo.stage(source,viewport),wall=await this.wall.prepare(source,layout),air=await this.air.prepare(layout,wall.color);
    const spill=[0,0,0];let n=0;for(let i=0;i<source.data.length;i+=Math.max(4,Math.floor(source.data.length/4096/4)*4)){for(let k=0;k<3;k++)spill[k]+=Math.sqrt(Math.max(0,Math.min(1,source.data[i+k])));n++;}
    this.cache.set(index,{source,projection,layout,wall,air,spill:spill.map(v=>Math.round(80+v/n*110)).join(',')});
    for(const [old,item]of this.cache)if(old<index-1){item.wall.buffer.close?.();item.air.beam.close?.();this.cache.delete(old);}
  }
  async prepareWhite(){
    const layout=this.layout(1.5,true),projection=await this.photo.stage(white,{width:Math.round(layout.sw*this.scale),height:Math.round(layout.sh*this.scale)}),wall=await this.wall.prepare(white,layout),air=await this.air.prepare(layout,wall.color);
    this.empty={source:white,projection,layout,wall,air,spill:'255,255,255'};
  }
  activate(item){
    if(this.active===item)return;this.active=item;const {layout}=item;
    this.photo.canvas.width=Math.round(layout.sw*this.scale);this.photo.canvas.height=Math.round(layout.sh*this.scale);
    this.photo.upload(item.source,{width:this.photo.canvas.width,height:this.photo.canvas.height});this.wall.activate(item.wall);this.air.activate(item.air);
  }
  async prepareFrame(timeline,time){
    const f=timelineAt(timeline,time);if(f.kind==='change'){await this.prepareSlide(f.index-1);await this.prepareSlide(f.index);}else await this.prepareSlide(f.index);
  }
  frameAt(segment){
    if(segment.kind==='opening')return this.host.startupAt(segment.local);
    if(segment.kind==='change')return this.host.transitionAt(segment.local);
    return{phase:'hold',shift:0,clipRight:0,exposure:segment.kind==='warmup'?.07:1,boost:1,adaptation:1};
  }
  sourceIndex(segment,frame){
    if(segment.kind==='warmup'||segment.kind==='white')return -1;
    if(segment.kind==='opening')return frame.swap?0:-1;
    return segment.kind==='change'?segment.index-(frame.swap?0:1):segment.index;
  }
  render(timeline,time){
    const segment=timelineAt(timeline,time),s=this.snapshot.settings;
    let frame={phase:'hold',shift:0,clipRight:0,exposure:1,boost:1,adaptation:1},item;
    if(segment.kind==='warmup'||segment.kind==='white'){item=this.empty;if(segment.kind==='warmup')frame.exposure=.07;}
    else if(segment.kind==='opening'){frame=this.host.startupAt(segment.local);item=frame.swap?this.cache.get(0):this.empty;}
    else if(segment.kind==='change'){frame=this.host.transitionAt(segment.local);item=this.cache.get(frame.swap?segment.index:segment.index-1);}
    else item=this.cache.get(segment.index);
    this.activate(item);const {layout}=item,optics=this.host.projectionOptics(frame,layout.aperture,layout.sw),emitted=frame.exposure*s.brightness;
    this.wall.draw(emitted,optics);this.air.time=time/1000;this.air.exposure=emitted;this.air.color=this.wall.color;this.air.optics=optics;this.air.draw();
    const cycle=segment.kind==='opening'||segment.kind==='change';
    const sceneKey=[emitted,frame.adaptation||1,...this.wall.color].join(',');
    if(cycle||this.cycleStart!=null||this.stillSceneKey!==sceneKey){
      this.scene.beginFrame();this.scene.illuminate(1,emitted,this.wall.color,(frame.adaptation||1)*s.brightness);
      if(cycle){if(this.cycleStart!==segment.start){this.scene.reset();this.cycleStart=segment.start;}this.scene.mechanism(segment.kind==='opening'?frame.mechanicalMs:segment.local);this.stillSceneKey=null;}
      else{
        if(this.cycleStart!=null){this.scene.mechanism(1500);this.scene.reset();this.cycleStart=null;}
        this.stillSceneKey=sceneKey;
      }
      this.scene.endFrame();
      if(cycle)this.machineBlur?.apply(time,this.shutter);else this.machineBlur?.reset();
      // Copy immediately: Three.js may clear its drawing buffer after yielding.
      if(!cycle){const c=this.stillMachine;c.width=this.scene.canvas.width;c.height=this.scene.canvas.height;const ctx=c.getContext('2d');ctx.filter=`blur(${s.depth*this.scale}px)`;ctx.drawImage(this.scene.canvas,0,0);}
    }
    if(this.photo.params.boost!==frame.boost){this.photo.params.boost=frame.boost;this.photo.draw();}
    if(this.lastMachineGain!==(frame.adaptation||1)){this.lastMachineGain=frame.adaptation||1;this.machine.illuminate(1,this.lastMachineGain,s.brightness);}
    const holdKey=[segment.kind,sceneKey,frame.boost].join('|');
    if(!cycle&&this.holdItem===item&&this.holdKey===holdKey)return this.hold.render(this.air.canvas);
    if(cycle){this.holdItem=null;this.holdKey=null;}
    const x=this.ctx,w=this.w,h=this.h;x.setTransform(1,0,0,1,0,0);x.drawImage(this.background,0,0);x.setTransform(this.scale,0,0,this.scale,0,0);
    x.drawImage(this.wall.canvas,0,0,w,h);
    const cacheLayer=layer=>{this.hold.layer(this.canvas,layer);x.setTransform(1,0,0,1,0,0);x.clearRect(0,0,this.width,this.height);x.setTransform(this.scale,0,0,this.scale,0,0);};
    cacheLayer(false);
    x.save();x.globalAlpha=segment.kind==='warmup'?0:Math.min(1,frame.exposure*.3);x.filter=`blur(${16*this.scale}px)`;x.fillStyle=`rgba(${item.spill},.26)`;const glowWidth=layout.sw*Math.max(.15,1-optics.clipRight),glowShift=(optics.shift-optics.clipRight*.5)*layout.sw;x.fillRect(w/2-glowWidth/2+glowShift,layout.centerY-layout.sh/2,glowWidth,layout.sh);x.restore();
    cacheLayer('glow');
    // Fixed octagonal optical field, including actual subframe occlusion.
    x.save();x.translate(w/2,layout.centerY);x.rotate(.22*Math.PI/180);const a=layout.aperture;
    x.beginPath();for(const [i,p]of [[-.34,-.5],[.34,-.5],[.5,-.34],[.5,.34],[.34,.5],[-.34,.5],[-.5,.34],[-.5,-.34]].entries())i?x.lineTo(p[0]*a,p[1]*a):x.moveTo(p[0]*a,p[1]*a);x.closePath();x.clip();
    const travel=this.host.filmTravel(a,layout.sw),dx=frame.shift*travel;
    const before=this.frameAt(timelineAt(timeline,time-this.shutter/2)),after=this.frameAt(timelineAt(timeline,time+this.shutter/2));
    const distance=Math.abs(after.shift-before.shift)*travel*this.scale,wipe=Math.abs((after.clipRight||0)-(before.clipRight||0))*a*this.scale;
    const vectorBlur=distance>.25||item===this.empty&&wipe>.25;
    if(vectorBlur){
      // Dense gathers from one photo follow the known transport path. No
      // equally spaced, visibly separate copies of an entire scene are drawn.
      const count=Math.min(192,Math.max(16,Math.ceil(Math.max(distance,wipe)*1.5))),paths=[];
      for(let i=0;i<count;i++){
        const at=timelineAt(timeline,time+((i+.5)/count-.5)*this.shutter),f=this.frameAt(at);
        const same=this.sourceIndex(at,f)===this.sourceIndex(segment,frame);
        paths.push([f.shift*travel*this.scale,item===this.empty&&at.kind==='opening'?(f.clipRight||0):0,f.boost/frame.boost,same&&f.exposure>0?(item===this.empty?Math.min(1,f.exposure):1):0]);
      }
      const blurred=this.photoBlur.render(this.photo.canvas,{width:layout.sw*this.scale,height:layout.sh*this.scale,gate:a*this.scale,paths});
      x.drawImage(blurred,-a/2,-a/2,a,a);
    }
    if(!vectorBlur&&item===this.empty&&segment.kind==='opening'){x.beginPath();x.rect(-a/2,-a/2,a*(1-frame.clipRight),a);x.clip();}
    if(!vectorBlur&&frame.exposure>0&&segment.kind!=='warmup'){x.globalAlpha=item===this.empty?Math.min(1,frame.exposure):1;x.drawImage(this.photo.canvas,-layout.sw/2+dx,-layout.sh/2,layout.sw,layout.sh);
      if(this.surface&&s.texture>0){x.globalAlpha=s.texture*.035;x.fillStyle=x.createPattern(this.surface,'repeat');x.fillRect(-layout.sw/2+dx,-layout.sh/2,layout.sw,layout.sh);}}
    x.restore();x.globalAlpha=1;
    cacheLayer('photo');
    const r=this.machineRect;x.save();if(cycle)x.filter=`blur(${s.depth*this.scale}px)`;x.drawImage(cycle?this.scene.canvas:this.stillMachine,r.left,r.top,r.width,r.height);x.restore();
    const hazeY=h*(.98-s.projectorY/100),haze=x.createRadialGradient(w*.5,hazeY,0,w*.5,hazeY,h*.26);haze.addColorStop(0,'#d7b98206');haze.addColorStop(.45,'#d7b98202');haze.addColorStop(1,'#d7b98200');x.fillStyle=haze;x.fillRect(0,0,w,h);
    x.save();x.translate(w*.5,h*(this.w<600?.35:.34));x.scale(w,h);const v=x.createRadialGradient(0,0,.24,0,0,.8);v.addColorStop(0,'#0000');v.addColorStop(.56,'#0002');v.addColorStop(1,this.w<600?'#0005':'#0008');x.fillStyle=v;x.fillRect(-1,-1,2,2);x.restore();
    const bottom=x.createLinearGradient(0,h*.84,0,h);bottom.addColorStop(0,'#0000');bottom.addColorStop(1,'#0007');x.fillStyle=bottom;x.fillRect(0,0,w,h);
    if(!this.machine.renderer.canvas.hidden)x.drawImage(this.machine.renderer.canvas,0,0,w,h);
    this.hold.layer(this.canvas,true);if(!cycle){this.holdItem=item;this.holdKey=holdKey;}
    return this.hold.render(this.air.canvas);
  }
  dispose(){
    this.photoBlur?.dispose();this.machineBlur?.dispose();this.hold?.dispose();
    for(const object of [this.scene.scene,this.scene.wallShadowScene])object?.traverse(o=>{o.geometry?.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])if(m){for(const v of Object.values(m))if(v?.isTexture)v.dispose();m.dispose();}});
    this.scene.renderer.dispose();this.scene.renderer.forceContextLoss();
    for(const r of [this.photo,this.machine.renderer]){r.gl?.getExtension('WEBGL_lose_context')?.loseContext();r.canvas.width=r.canvas.height=1;}
    this.machine.renderer.device?.destroy();
    for(const item of this.cache.values()){item.wall.buffer.close?.();item.air.beam.close?.();}this.empty?.wall.buffer.close?.();this.empty?.air.beam.close?.();this.cache.clear();this.air.exposure=0;cancelAnimationFrame(this.air.frame);this.canvas.width=this.canvas.height=this.stillMachine.width=this.stillMachine.height=1;
  }
}
