// A restrained screen-space approximation of illuminated air. The HDR photo
// remains on its own, unfiltered surface above this pass.
export async function snapshotLight(canvas){
  let image=canvas;if(typeof createImageBitmap==='function'){try{image=await createImageBitmap(canvas);}catch{/* Use the already rendered canvas on older implementations. */}}
  // Force deferred blur/raster work to finish while no transport is running.
  // A one-pixel readback avoids copying the full padded lighting surface.
  const warm=document.createElement('canvas');warm.width=warm.height=1;const ctx=warm.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,1,1);ctx.getImageData(0,0,1,1);return image;
}
export class AirLight {
  constructor(canvas){
    this.canvas=canvas;this.ctx=canvas.getContext('2d');this.exposure=0;this.color=[.45,.42,.35];this.amount=1.4;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)');this.time=0;this.last=0;
    let seed=2167;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
    this.motes=Array.from({length:16},()=>({u:rand(),v:rand(),phase:rand()*Math.PI*2,speed:.004+rand()*.010,size:.45+rand()*1.15,depth:rand()}));
    this.tick=now=>{
      this.frame=null;
      if(!this.shouldAnimate()){this.draw();return;}
      if(now-this.last>=32){this.time+=Math.min(.08,(now-this.last)/1000);this.last=now;this.draw();}
      this.frame=requestAnimationFrame(this.tick);
    };
    this.reduced.addEventListener('change',()=>this.schedule());
    document.addEventListener('visibilitychange',()=>this.schedule());
  }
  shouldAnimate(){return this.exposure>0&&this.amount>0&&!this.reduced.matches&&!document.hidden;}
  schedule(){
    if(this.transport){const now=performance.now();if(now-this.last>=32){this.time+=Math.min(.08,(now-this.last)/1000);this.last=now;}this.draw();return;}
    if(this.shouldAnimate()){if(this.frame==null){this.last=performance.now();this.frame=requestAnimationFrame(this.tick);}}
    else {cancelAnimationFrame(this.frame);this.frame=null;}
    this.draw();
  }
  setTransport(active){if(this.transport===active)return;this.transport=active;cancelAnimationFrame(this.frame);this.frame=null;this.last=performance.now();if(!active)this.schedule();}
  layoutKey(layout,color=this.color){return[layout.w,layout.h,layout.sw,layout.sh,layout.centerY,layout.lens?.x,layout.lens?.y,Math.min(devicePixelRatio,1.25),this.amount,...color].join(',');}
  setLayout(layout){Object.assign(this,layout);this.scale=Math.min(devicePixelRatio,1.25);const w=Math.ceil(this.w*this.scale),h=Math.ceil(this.h*this.scale);if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;}
  resize(w,h,sw,sh,lens,centerY=h*(w<600?.34:.31)){
    const layout={w,h,sw,sh,centerY,lens:lens||{x:w*.54,y:h*.64}};if(this.layoutKey(layout)===this.layoutKey(this))return;this.setLayout(layout);
    this.rebuild();this.draw();
  }
  illuminate(exposure,color,optics){
    const changed=color!==this.color;this.exposure=exposure;this.color=color;this.optics=optics;
    if(changed)this.rebuild();this.schedule();
  }
  setAmount(value){this.amount=value;this.rebuild();this.schedule();}
  section(y,optics){
    // The wide end meets the lower edge of the actual photo, not an oversized
    // imaginary aperture behind it. Dust and scattering share this geometry.
    const wallY=(this.centerY??this.h*(this.w<600?.34:.31))+this.sh/2,source=this.lens;
    const t=Math.max(0,Math.min(1,(source.y-y)/Math.max(1,source.y-wallY)));
    const factor=optics?Math.max(0,1-optics.clipRight):1;
    const dx=optics?(optics.shift-optics.clipRight*.5)*this.sw:0;
    return {wallY,t,x:source.x+(this.w/2+dx-source.x)*t,halfWidth:(3*(1-t)+this.sw/2*t)*factor};
  }
  makeBeam(layout,color){
    const c=document.createElement('canvas');c.width=Math.ceil(layout.w*.5);c.height=Math.ceil(layout.h*.5);
    const ctx=c.getContext('2d');ctx.scale(.5,.5);
    const source=layout.lens,section=y=>this.section.call(layout,y),top=section(0).wallY;
    const rgb=color.map((v,i)=>Math.round(155+Math.min(1,v)*75+(i===0?10:0))).join(',');
    // Overlapping soft cross sections have no hard triangular cone boundary.
    // The wall image hides the far end, the machine hides the lens endpoint.
    ctx.save();ctx.beginPath();ctx.moveTo(layout.w/2-layout.sw/2,top);ctx.lineTo(layout.w/2+layout.sw/2,top);ctx.lineTo(source.x+3,source.y);ctx.lineTo(source.x-3,source.y);ctx.closePath();ctx.clip();
    ctx.filter='blur(5px)';
    for(let y=top;y<source.y;y+=4){
      const {t,x:cx,halfWidth:width}=section(y),fade=Math.sqrt(t)*(1-.25*t);
      const g=ctx.createLinearGradient(cx-width,y,cx+width,y),a=.04*this.amount*fade;
      g.addColorStop(0,`rgba(${rgb},0)`);g.addColorStop(.22,`rgba(${rgb},${a*.35})`);g.addColorStop(.5,`rgba(${rgb},${a})`);g.addColorStop(.78,`rgba(${rgb},${a*.35})`);g.addColorStop(1,`rgba(${rgb},0)`);
      ctx.fillStyle=g;ctx.fillRect(cx-width,y,width*2,5);
    }
    ctx.restore();return c;
  }
  async prepare(layout,color){
    this.preparations??=new Map();const key=this.layoutKey(layout,color);if(this.preparations.has(key))return this.preparations.get(key).pending;
    const pending=(async()=>({layout,color,beam:await snapshotLight(this.makeBeam(layout,color)),key}))(),entry={pending};this.preparations.set(key,entry);entry.value=await pending;
    for(const [old,item]of this.preparations)if(this.preparations.size>2&&old!==key&&item.value!==this.activePrepared){item.value?.beam.close?.();this.preparations.delete(old);}
    return entry.value;
  }
  activate(prepared){this.activePrepared=prepared;this.setLayout(prepared.layout);this.color=prepared.color;this.beam=prepared.beam;Object.assign(this.canvas.dataset,{baseWidth:String(this.sw),baseY:String(this.section(0).wallY)});}
  rebuild(){
    if(!this.w)return;this.activePrepared=null;this.beam=this.makeBeam(this,this.color);Object.assign(this.canvas.dataset,{baseWidth:String(this.sw),baseY:String(this.section(0).wallY)});
  }
  beginFrame(){this.batchDepth=(this.batchDepth||0)+1;}
  endFrame(){if(this.batchDepth>0&&--this.batchDepth===0&&this.drawPending){this.drawPending=false;this.draw();}}
  draw(){
    if(this.batchDepth){this.drawPending=true;return;}
    const ctx=this.ctx;if(!this.w)return;
    ctx.setTransform(this.scale,0,0,this.scale,0,0);ctx.clearRect(0,0,this.w,this.h);
    const intensity=Math.min(1.5,this.exposure)*this.amount;
    this.canvas.dataset.exposure=intensity.toFixed(3);this.canvas.dataset.moving=String(this.shouldAnimate());
    if(intensity<=0){this.canvas.dataset.dust='0';return;}
    ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=Math.min(1,this.exposure);
    const f=this.optics,dx=f?(f.shift-f.clipRight*.5)*this.sw:0,widthFactor=f?Math.max(.05,1-f.clipRight):1;
    const top=this.section(0).wallY,source=this.lens;let visible=0;
    if(this.beam){
      ctx.save();ctx.translate(source.x,source.y);ctx.transform(widthFactor,0,dx/(top-source.y),1,0,0);ctx.translate(-source.x,-source.y);
      ctx.drawImage(this.beam,0,0,this.w,this.h);ctx.restore();
    }
    for(const p of this.motes){
      const v=((p.v-this.time*p.speed)%1+1)%1,y=top+v*(source.y-top);
      const {x:center,halfWidth:beamWidth}=this.section(y,f);
      const x=center+(p.u-.5)*beamWidth*2.3+Math.sin(this.time*.23+p.phase)*5;
      const distance=Math.abs(x-center)/beamWidth;
      const illumination=Math.max(0,1-distance*distance)**2*Math.sin(Math.PI*v)**.8;
      // Most motes stay invisible outside the light; only occasional near ones
      // soften into small bokeh. No twinkle, spawning flashes or rain-like streaks.
      const alpha=Math.min(.65,illumination*(.09+.22*p.depth)*Math.min(2,this.amount));if(alpha<.008)continue;
      visible++;const radius=p.size*(.45+p.depth*.7);
      const gradient=ctx.createRadialGradient(x,y,0,x,y,radius*2.5);
      gradient.addColorStop(0,`rgba(255,239,203,${alpha})`);gradient.addColorStop(.3,`rgba(233,225,205,${alpha*.5})`);gradient.addColorStop(1,'rgba(233,225,205,0)');
      ctx.fillStyle=gradient;ctx.fillRect(x-radius*2.5,y-radius*2.5,radius*5,radius*5);
    }
    ctx.restore();this.canvas.dataset.dust=String(visible);
  }
}
