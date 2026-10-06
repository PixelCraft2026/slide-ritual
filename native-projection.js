import { CHANGE_MS, EXIT_MS, STARTUP_CHANGE_MS, EXPOSURE_PEAK, filmTravel, motionRadius, transitionAt, startupAt } from './transition.js';
import { ProjectionRenderer } from './renderer.js';

export const DEFAULT_HDR_ENTRY_EV=1;
export function nativeExposureOpacity(frame,reduced=false,ev=DEFAULT_HDR_ENTRY_EV){
  if(reduced)return 0;
  // The same floating HDR canvas supplies neutral outgoing motion blur,
  // boosted incoming motion blur, and the existing exposure recovery.
  if(frame.phase==='out')return Math.min(1,Math.abs(frame.velocity||0)*EXIT_MS/1.5);
  if(frame.phase==='in')return 1;
  if(ev<=0||(frame.phase&&frame.phase!=='settle'))return 0;
  const envelope=Math.max(0,Math.min(1,((frame.boost??1)-1)/(EXPOSURE_PEAK-1)));
  // Map the recovery in exposure stops to the pre-rendered HDR peak layer.
  return (2**(ev*envelope)-1)/(2**ev-1);
}

export const nativePhotoBoost=(frame,ev=DEFAULT_HDR_ENTRY_EV)=>frame.phase==='out'?1:2**ev;
// The outer octagon is the only clip. Move source pixels, never its boundary.
export function nativeWipe(frame,travel=1){
  return{gate:'translate3d(0px,0,0)',contents:`translate3d(${frame.shift*travel}px,0,0)`};
}

export function nativeKeyframes(opening=false,reduced=false,ev=DEFAULT_HDR_ENTRY_EV,travel=1){
  const duration=opening?STARTUP_CHANGE_MS:CHANGE_MS,at=opening?startupAt:transitionAt;
  const times=new Set([0,duration,...(opening?[200,1000,1300]:[EXIT_MS,600,967,1167])]);
  for(let ms=1000/120;ms<duration;ms+=1000/120)times.add(ms);
  const gate=[],contents=[],exposure=[];
  for(const ms of [...times].sort((a,b)=>a-b)){
    const frame=at(ms);if(reduced)frame.shift=0;
    const wipe=nativeWipe(frame,travel),offset=ms/duration;
    gate.push({offset,transform:wipe.gate});contents.push({offset,transform:wipe.contents});
    exposure.push({offset,opacity:nativeExposureOpacity(frame,reduced,ev)});
  }
  return{duration,gate,contents,exposure};
}

export class NativeProjection {
  constructor(gate,motion,texture){
    this.gate=gate;this.motion=motion;this.texture=texture;this.animations=[];this.active=false;this.exposureEV=DEFAULT_HDR_ENTRY_EV;this.travel=1;
    if(globalThis.document?.body){
      this.staging=document.createElement('div');this.staging.hidden=true;
      Object.assign(this.staging.style,{position:'fixed',left:'0',top:'0',clipPath:'inset(0 calc(100% - 1px) calc(100% - 1px) 0)',pointerEvents:'none',zIndex:'8',contain:'layout paint'});
      this.cover=document.createElement('div');Object.assign(this.cover.style,{position:'absolute',inset:'0',background:'#000',opacity:'.999999',pointerEvents:'none'});
      // A fully opaque cover permits occlusion culling to skip the HDR paint.
      this.staging.setAttribute('aria-hidden','true');document.body.append(this.staging);
    }
  }
  async initExposure(renderer){
    if(renderer.mode==='webgpu'&&renderer.hdrSupported)this.exposureRenderer=renderer;
  }
  async prepareExposure(source,layout){
    if(!source||!this.exposureRenderer)return null;
    this.exposureLayers??=new Map();let resource=this.exposureLayers.get(source);
    try{
      if(!resource){
        const canvas=document.createElement('canvas');
        Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',opacity:'0',willChange:'opacity'});
        canvas.style.setProperty('dynamic-range-limit','no-limit');canvas.setAttribute('aria-hidden','true');canvas.dataset.nativeExposure='hdr';
        const renderer=new ProjectionRenderer(canvas),shared=this.exposureRenderer;
        Object.assign(renderer,{mode:'webgpu',device:shared.device,pipeline:shared.pipeline,sampler:shared.sampler,hdr:true,hdrSupported:true,configuredHDR:true});
        renderer.params.texture=0;
        resource={canvas,renderer,source};this.exposureLayers.set(source,resource);
        renderer.gpu=canvas.getContext('webgpu');renderer.gpu.configure({device:renderer.device,format:'rgba16float',alphaMode:'opaque',colorSpace:'display-p3',toneMapping:{mode:'extended'}});
        const configuration=renderer.gpu.getConfiguration?.();if(configuration&&configuration.toneMapping?.mode!=='extended')throw new Error('Extended HDR canvas unavailable');
        renderer.uniform=renderer.device.createBuffer({size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
      }
      const dpr=Math.min(globalThis.devicePixelRatio||1,2),viewport={width:Math.max(1,Math.round(layout.width*dpr)),height:Math.max(1,Math.round(layout.height*dpr))};
      if(resource.canvas.width!==viewport.width)resource.canvas.width=viewport.width;
      if(resource.canvas.height!==viewport.height)resource.canvas.height=viewport.height;
      resource.canvas.hidden=false;
      resource.layoutWidth=layout.width;
      resource.renderer.params.boost=2**this.exposureEV;
      // Upload the actual HDR pixels before transport. A bounded GPU pass
      // supplies velocity blur; settling fades this canvas over the original.
      await resource.renderer.stage(source,viewport);resource.renderer.upload(source,viewport);await resource.renderer.device.queue.onSubmittedWorkDone();
      this.stagedExposure=resource;
      for(const [key,value]of this.exposureLayers)if(this.exposureLayers.size>3&&value!==this.activeExposure&&value!==resource){this.exposureLayers.delete(key);this.releaseExposure(value);}
      return resource;
    }catch{if(resource&&resource!==this.activeExposure){this.exposureLayers.delete(source);this.releaseExposure(resource);}return null;}
  }
  releaseExposure(resource){
    for(const value of resource.renderer.textureSources?.values()||[])value.texture.destroy();
    resource.renderer.uniform?.destroy();resource.renderer.gpu?.unconfigure();resource.canvas.remove();
  }
  clearExposures(){
    this.cancel();for(const resource of this.exposureLayers?.values()||[])this.releaseExposure(resource);
    this.exposureLayers?.clear();this.activeExposure=this.stagedExposure=this.exposure=null;
  }
  setExposureEV(value){
    this.exposureEV=Math.max(0,Math.min(2,Number.isFinite(value)?value:DEFAULT_HDR_ENTRY_EV));
    if(this.activeExposure){this.activeExposure.renderer.params.boost=2**this.exposureEV;this.activeExposure.renderer.draw();}
  }
  setHDR(hdr){
    const changed=this.hdr!==hdr;this.hdr=hdr;
    if(this.exposure){this.exposure.hidden=!this.active||!hdr;if(!hdr)this.exposure.style.opacity='0';}
    if(changed&&this.active&&this.transport)this.play();
  }
  setLayout(layout){this.travel=filmTravel(layout.aperture,layout.width);this.layout=layout;}
  renderMotion(frame){
    const resource=this.activeExposure;
    if(!this.hdr||!resource||this.transport?.reduced||!['out','in','settle'].includes(frame.phase))return;
    const renderer=resource.renderer,blur=motionRadius(frame,this.travel)*resource.canvas.width/resource.layoutWidth,boost=nativePhotoBoost(frame,this.exposureEV);
    if(renderer.params.motion===blur&&renderer.params.boost===boost)return;
    renderer.params.motion=blur;renderer.params.boost=boost;renderer.draw();
  }
  async prepare(image,layout,{hdr=false,displayMode='auto',brightness=1,focus=0,boost=1,exposure=null}={}){
    const ticket=this.prepareTicket=(this.prepareTicket||0)+1;
    // Reuse this decoded <img> at the swap. Assigning the URL to a different
    // display node at that point leaves its first native HDR paint until entry.
    image.decoding='async';image.loading='eager';
    image.width=Math.round(layout.width);image.height=Math.round(layout.height);
    Object.assign(image.style,{width:'100%',height:'100%',display:'block',objectFit:'fill',imageOrientation:'from-image',willChange:'transform',transform:'translateZ(0)'});
    image.style.filter=hdr?'none':`brightness(${brightness*boost}) blur(${focus}px)`;
    image.style.setProperty('dynamic-range-limit',displayMode==='sdr'?'standard':'no-limit');
    await image.decode?.();
    if(ticket!==this.prepareTicket)return image;
    if(this.staging&&image.parentElement!==this.motion){
      // decode() does not force the first HDR raster/texture transfer. Give the
      // actual image a native paint at its final scale before it enters the gate.
      // Only one covered corner pixel is exposed; the HDR image itself remains
      // opaque, so opacity-dependent tone mapping cannot skip its gain map.
      image.removeAttribute('id');image.hidden=false;
      Object.assign(this.staging.style,{width:`${layout.width}px`,height:`${layout.height}px`});
      if(exposure)exposure.canvas.style.opacity='1';
      this.staging.replaceChildren(image,...(exposure?[exposure.canvas]:[]),this.cover);this.staging.hidden=false;
      for(let frame=0;frame<4;frame++)await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    return image;
  }
  promote(){for(const element of [this.gate,this.motion,this.texture])if(element)element.style.willChange='transform';}
  activate(hdr=false,exposure){
    if(exposure!==undefined){
      if(this.exposure&&this.exposure!==exposure?.canvas)this.exposure.remove();
      this.activeExposure=exposure;this.stagedExposure=null;this.exposure=exposure?.canvas;
      if(this.exposure){this.exposure.style.opacity='0';this.motion.append(this.exposure);}
    }
    this.hdr=hdr;
    this.active=true;this.promote();this.gate.style.clipPath='none';this.clearStaging();
    if(this.exposure)this.exposure.hidden=!hdr;
    if(this.transport)this.play();else this.frame({shift:0,clipRight:0});
  }
  deactivate(){
    this.active=false;this.cancel();this.clearStaging();
    if(this.exposure){this.exposure.hidden=true;this.exposure.style.opacity='0';}
    for(const element of [this.gate,this.motion,this.texture])if(element){element.style.willChange='';element.style.transform='none';}
    this.gate.style.clipPath='none';
  }
  async prepareExit(reduced=false){
    if(!this.active||reduced)return;
    const pending={startedAt:performance.now(),opening:false,reduced,warming:true};this.transport=pending;
    this.renderMotion(transitionAt(0));
    if(this.activeExposure)await this.activeExposure.renderer.device.queue.onSubmittedWorkDone();
    if(this.transport!==pending)return;
    this.play();
    try{
      // Creating a compositor animation can trigger the first HDR raster.
      // Paint its paused initial pose while the old photo is still at rest,
      // then reuse these animations rather than spending exit time on it.
      for(const animation of this.animations){animation.pause();animation.currentTime=0;}
      if(!this.animations.length){this.transport=null;return;}
      for(let frame=0;frame<4&&this.transport===pending;frame++)await new Promise(resolve=>requestAnimationFrame(resolve));
    }catch{if(this.transport===pending){this.transport=null;this.cancel();}}
  }
  start(startedAt,opening=false,reduced=false){
    const primed=this.transport?.warming&&this.transport.opening===opening&&this.transport.reduced===reduced&&this.animations.length;
    this.transport={startedAt,opening,reduced};
    if(this.active){
      if(primed){const elapsed=Math.max(0,performance.now()-startedAt);for(const animation of this.animations){animation.currentTime=elapsed;animation.play();}}
      else this.play();
    }
  }
  play(){
    this.cancel();
    if(![this.gate,this.motion,this.texture].filter(Boolean).every(element=>typeof element.animate==='function'))return;
    const frames=nativeKeyframes(this.transport.opening,this.transport.reduced,this.exposureEV,this.travel),options={duration:frames.duration,fill:'both',easing:'linear'};
    try{
      for(const [element,keyframes]of [[this.gate,frames.gate],[this.motion,frames.contents],[this.texture,frames.gate]])if(element)this.animations.push(element.animate(keyframes,options));
      if(this.hdr&&this.exposure)this.animations.push(this.exposure.animate(frames.exposure,options));
      const elapsed=Math.max(0,performance.now()-this.transport.startedAt);
      for(const animation of this.animations)animation.currentTime=elapsed;
    }catch{this.cancel();} // Fixed-clip translations also work without WAAPI.
  }
  frame(frame){
    if(!this.active)return;
    this.renderMotion(frame);
    if(this.animations.length)return;
    const wipe=nativeWipe(frame,this.travel);this.gate.style.transform=wipe.gate;this.motion.style.transform=wipe.contents;
    if(this.texture)this.texture.style.transform=wipe.gate;
    if(this.exposure)this.exposure.style.opacity=String(this.hdr?nativeExposureOpacity(frame,this.transport?.reduced,this.exposureEV):0);
  }
  cancel(){for(const animation of this.animations)animation.cancel();this.animations=[];if(this.exposure)this.exposure.style.opacity='0';}
  clearStaging(){this.prepareTicket=(this.prepareTicket||0)+1;if(this.staging){this.staging.hidden=true;this.staging.replaceChildren();}}
  reset(){this.transport=null;this.cancel();this.clearStaging();if(this.active)this.frame({shift:0,clipRight:0});}
}
