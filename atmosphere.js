// A restrained screen-space approximation of illuminated air. The HDR photo
// remains on its own, unfiltered surface above this pass.
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
    if(this.shouldAnimate()){if(this.frame==null){this.last=performance.now();this.frame=requestAnimationFrame(this.tick);}}
    else {cancelAnimationFrame(this.frame);this.frame=null;}
    this.draw();
  }
  resize(w,h,sw,sh,lens,centerY=h*(w<600?.34:.31)){
    this.w=w;this.h=h;this.sw=sw;this.sh=sh;this.centerY=centerY;this.lens=lens||{x:w*.54,y:h*.64};
    this.scale=Math.min(devicePixelRatio,1.25);this.canvas.width=Math.ceil(w*this.scale);this.canvas.height=Math.ceil(h*this.scale);
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
  rebuild(){
    if(!this.w)return;
    const c=this.beam=document.createElement('canvas');c.width=Math.ceil(this.w*.5);c.height=Math.ceil(this.h*.5);
    const ctx=c.getContext('2d');ctx.scale(.5,.5);
    const source=this.lens,top=this.section(0).wallY;
    Object.assign(this.canvas.dataset,{baseWidth:String(this.sw),baseY:String(top)});
    const rgb=this.color.map((v,i)=>Math.round(155+Math.min(1,v)*75+(i===0?10:0))).join(',');
    // Overlapping soft cross sections have no hard triangular cone boundary.
    // The wall image hides the far end, the machine hides the lens endpoint.
    ctx.save();ctx.beginPath();ctx.moveTo(this.w/2-this.sw/2,top);ctx.lineTo(this.w/2+this.sw/2,top);ctx.lineTo(source.x+3,source.y);ctx.lineTo(source.x-3,source.y);ctx.closePath();ctx.clip();
    ctx.filter='blur(5px)';
    for(let y=top;y<source.y;y+=4){
      const {t,x:cx,halfWidth:width}=this.section(y),fade=Math.sqrt(t)*(1-.25*t);
      const g=ctx.createLinearGradient(cx-width,y,cx+width,y),a=.04*this.amount*fade;
      g.addColorStop(0,`rgba(${rgb},0)`);g.addColorStop(.22,`rgba(${rgb},${a*.35})`);g.addColorStop(.5,`rgba(${rgb},${a})`);g.addColorStop(.78,`rgba(${rgb},${a*.35})`);g.addColorStop(1,`rgba(${rgb},0)`);
      ctx.fillStyle=g;ctx.fillRect(cx-width,y,width*2,5);
    }
    ctx.restore();
  }
  draw(){
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
