import { CHANGE_MS, STARTUP_CHANGE_MS, EXPOSURE_PEAK, transitionAt, startupAt } from './transition.js';

export function nativeExposureOpacity(frame,reduced=false){return reduced?0:Math.max(0,Math.min(1,((frame.boost??1)-1)/(EXPOSURE_PEAK-1)));}

// A translated fixed clip and an opposite translation of its contents produce
// the same wipe as inset(0, clipRight, 0, 0), without animating a paint mask.
export function nativeWipe(frame){
  return{gate:`translate3d(${(frame.shift-frame.clipRight)*100}%,0,0)`,contents:`translate3d(${frame.clipRight*100}%,0,0)`};
}

export function nativeKeyframes(opening=false,reduced=false){
  const duration=opening?STARTUP_CHANGE_MS:CHANGE_MS,at=opening?startupAt:transitionAt;
  const times=new Set([0,duration,...(opening?[200,1000,1300]:[133,600,967,1167])]);
  for(let ms=1000/120;ms<duration;ms+=1000/120)times.add(ms);
  const gate=[],contents=[],exposure=[];
  for(const ms of [...times].sort((a,b)=>a-b)){
    const frame=at(ms);if(reduced)frame.shift=0;
    const wipe=nativeWipe(frame),offset=ms/duration;
    gate.push({offset,transform:wipe.gate});contents.push({offset,transform:wipe.contents});
    exposure.push({offset,opacity:nativeExposureOpacity(frame,reduced)});
  }
  return{duration,gate,contents,exposure};
}

export class NativeProjection {
  constructor(gate,motion,texture){
    this.gate=gate;this.motion=motion;this.texture=texture;this.animations=[];this.active=false;
    if(globalThis.document?.body){
      this.staging=document.createElement('div');this.staging.hidden=true;
      Object.assign(this.staging.style,{position:'fixed',left:'0',top:'0',clipPath:'inset(0 calc(100% - 1px) calc(100% - 1px) 0)',pointerEvents:'none',zIndex:'8',contain:'layout paint'});
      this.cover=document.createElement('div');Object.assign(this.cover.style,{position:'absolute',inset:'0',background:'#000',opacity:'.999999',pointerEvents:'none'});
      // A fully opaque cover permits occlusion culling to skip the HDR paint.
      this.staging.setAttribute('aria-hidden','true');document.body.append(this.staging);
    }
  }
  async initExposure(renderer){
    if(renderer.mode!=='webgpu'||!renderer.hdrSupported||!globalThis.document)return;
    // A single HDR pixel supplies the multiplier. The browser keeps decoding
    // the original gain-map image; no image filter or duplicate photo is used.
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;canvas.hidden=true;
    Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',mixBlendMode:'multiply',opacity:'0',willChange:'opacity'});
    canvas.style.setProperty('dynamic-range-limit','no-limit');canvas.setAttribute('aria-hidden','true');canvas.dataset.nativeExposure='hdr';
    let context;
    try{
      const device=renderer.device;context=canvas.getContext('webgpu');
      context.configure({device,format:'rgba16float',alphaMode:'opaque',colorSpace:'display-p3',toneMapping:{mode:'extended'}});
      if(context.getConfiguration?.().toneMapping?.mode!=='extended'){context.unconfigure?.();return;}
      const value=1.055*Math.pow(EXPOSURE_PEAK,1/2.4)-.055;
      const module=device.createShaderModule({code:`@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let x=f32((i<<1u)&2u);let y=f32(i&2u);return vec4f(x*2.-1.,1.-y*2.,0.,1.);}@fragment fn fs()->@location(0) vec4f{return vec4f(${value},${value},${value},1.);}`});
      const pipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba16float'}]},primitive:{topology:'triangle-list'}});
      const encoder=device.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
      pass.setPipeline(pipeline);pass.draw(3);pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();
      this.exposure=canvas;this.motion.append(canvas);
    }catch{context?.unconfigure?.();} // Keep native HDR intact if float compositing is unavailable.
  }
  setHDR(hdr){
    const changed=this.hdr!==hdr;this.hdr=hdr;
    if(this.exposure){this.exposure.hidden=!this.active||!hdr;if(!hdr)this.exposure.style.opacity='0';}
    if(changed&&this.active&&this.transport)this.play();
  }
  async prepare(image,layout,{hdr=false,displayMode='auto',brightness=1,focus=0,boost=1}={}){
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
      this.staging.replaceChildren(image,this.cover);this.staging.hidden=false;
      for(let frame=0;frame<4;frame++)await new Promise(resolve=>requestAnimationFrame(resolve));
    }
    return image;
  }
  promote(){for(const element of [this.gate,this.motion,this.texture])if(element)element.style.willChange='transform';}
  activate(hdr=false){
    this.hdr=hdr;
    this.active=true;this.promote();this.gate.style.clipPath='none';this.clearStaging();
    if(this.exposure)this.exposure.hidden=!hdr;
    if(this.transport)this.play();else this.frame({shift:0,clipRight:0});
  }
  deactivate(){
    this.active=false;this.cancel();this.clearStaging();
    if(this.exposure){this.exposure.hidden=true;this.exposure.style.opacity='0';}
    for(const element of [this.gate,this.motion,this.texture])if(element){element.style.willChange='';element.style.transform='none';}
    this.gate.style.clipPath='inset(0)';
  }
  start(startedAt,opening=false,reduced=false){this.transport={startedAt,opening,reduced};if(this.active)this.play();}
  play(){
    this.cancel();
    if(![this.gate,this.motion,this.texture].filter(Boolean).every(element=>typeof element.animate==='function'))return;
    const frames=nativeKeyframes(this.transport.opening,this.transport.reduced),options={duration:frames.duration,fill:'both',easing:'linear'};
    try{
      for(const [element,keyframes]of [[this.gate,frames.gate],[this.motion,frames.contents],[this.texture,frames.contents]])if(element)this.animations.push(element.animate(keyframes,options));
      if(this.hdr&&this.exposure)this.animations.push(this.exposure.animate(frames.exposure,options));
      const elapsed=Math.max(0,performance.now()-this.transport.startedAt);
      for(const animation of this.animations)animation.currentTime=elapsed;
    }catch{this.cancel();} // Fixed-clip translations also work without WAAPI.
  }
  frame(frame){
    if(!this.active||this.animations.length)return;
    const wipe=nativeWipe(frame);this.gate.style.transform=wipe.gate;this.motion.style.transform=wipe.contents;
    if(this.texture)this.texture.style.transform=wipe.contents;
    if(this.exposure)this.exposure.style.opacity=String(this.hdr?nativeExposureOpacity(frame,this.transport?.reduced):0);
  }
  cancel(){for(const animation of this.animations)animation.cancel();this.animations=[];if(this.exposure)this.exposure.style.opacity='0';}
  clearStaging(){this.prepareTicket=(this.prepareTicket||0)+1;if(this.staging){this.staging.hidden=true;this.staging.replaceChildren();}}
  reset(){this.transport=null;this.cancel();this.clearStaging();if(this.active)this.frame({shift:0,clipRight:0});}
}
