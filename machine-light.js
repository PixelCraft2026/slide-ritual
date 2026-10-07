import * as THREE from './vendor/three.module.js';
import { ProjectionRenderer } from './renderer.js';
import { srgbToLinear } from './hdr.js';
import { lightContext } from './canvas-compat.js';

// Soft optical bloom from the complete luminous windows, underarm slit and
// side slot. Their source textures and the bloom share one exposure gain.
export class MachineLight {
  constructor(canvas){this.renderer=new ProjectionRenderer(canvas,()=>{}, {transparent:true});this.renderer.params.texture=0;this.power=0;this.amount=.3;this.lampAmount=1;this.gain=1;this.brightness=1;canvas.hidden=true;}
  async init(){await this.renderer.init();this.ready=true;this.key=null;}
  configure(hdr,highlight){this.renderer.params.highlight=highlight;this.renderer.configure(hdr);}
  resize(w,h,scene,depth=4){
    if(!this.ready||!scene)return;
    const r=scene.canvas.getBoundingClientRect(),key=[w,h,r.left,r.top,r.width,r.height,depth,scene.pitch].join(',');if(key===this.key)return;this.key=key;
    scene.scene.updateMatrixWorld(true);
    const scale=Math.min(1,1440/w),width=Math.round(w*scale),height=Math.round(h*scale);
    const seed=document.createElement('canvas');seed.width=width;seed.height=height;const ctx=lightContext(seed);ctx.scale(scale,scale);
    const project=(o,x,y,z=0)=>{const v=o.localToWorld(new THREE.Vector3(x,y,z)).project(scene.camera);return [r.left+(v.x+1)*r.width/2,r.top+(1-v.y)*r.height/2];};
    const polygon=points=>{ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();};
    for(const vent of scene.vents.children){
      const im=vent.material.map.image,p=[[-.036,.4865],[.036,.4865],[.036,-.4865],[-.036,-.4865]].map(q=>project(vent,...q));
      // Two affine triangles preserve the perspective of each real vent.
      for(const [corners,dx,dy] of [[[0,1,2],[p[1][0]-p[0][0],p[1][1]-p[0][1]],[p[2][0]-p[1][0],p[2][1]-p[1][1]]],[[0,2,3],[p[2][0]-p[3][0],p[2][1]-p[3][1]],[p[3][0]-p[0][0],p[3][1]-p[0][1]]]]){
        ctx.save();polygon(corners.map(i=>p[i]));ctx.clip();ctx.transform(dx[0]/im.width,dx[1]/im.width,dy[0]/im.height,dy[1]/im.height,p[0][0],p[0][1]);ctx.drawImage(im,0,0);ctx.restore();
      }
    }
    const slit=scene.scene.getObjectByName('transport-underarm-light-slit');ctx.fillStyle='rgba(255,226,170,.70)';polygon([[-.32,.007,-.032],[.32,.007,-.032],[.32,.007,.032],[-.32,.007,.032]].map(p=>project(slit,...p)));ctx.fill();
    const slot=scene.scene.getObjectByName('side-light-slot');ctx.fillStyle='rgba(255,226,170,.58)';polygon(slot.userData.glowCorners.map(p=>project(slot,...p)));ctx.fill();
    const halo=document.createElement('canvas');halo.width=width;halo.height=height;const hc=lightContext(halo,{willReadFrequently:true});hc.globalCompositeOperation='lighter';
    // The broad skirts remain visible against blackout without isolated white shapes.
    for(const [blur,alpha] of [[2+depth*.7,.22],[7+depth*1.5,.90],[20+depth*3,1],[42+depth*4,.80]]){hc.filter=`blur(${blur*scale}px)`;hc.globalAlpha=alpha;hc.drawImage(seed,0,0);}
    hc.filter='none';hc.globalAlpha=1;
    const read=ctx=>{try{return ctx.getImageData(0,0,width,height,{pixelFormat:ctx.getContextAttributes?.().colorType==='float16'?'rgba-float16':'rgba-unorm8'}).data;}catch{return ctx.getImageData(0,0,width,height).data;}};
    const pixels=read(hc),precise=pixels.BYTES_PER_ELEMENT===2,unit=precise?1:255,data=new Float32Array(width*height*4);
    // Keep the optical skirt broad while preserving the dark ribs between
    // windows. The geometry already supplies the direct light at their centres.
    const mask=document.createElement('canvas');mask.width=width;mask.height=height;const mc=lightContext(mask,{willReadFrequently:true});mc.filter=`blur(${(depth+2)*scale}px)`;mc.drawImage(seed,0,0);const m=read(mc);let peak=1/unit;for(let i=3;i<m.length;i+=4)peak=Math.max(peak,m[i]);
    for(let i=0;i<data.length;i+=4){for(let c=0;c<3;c++)data[i+c]=srgbToLinear(pixels[i+c]/unit)*.80;data[i+3]=pixels[i+3]/unit*(1-.65*m[i+3]/peak);pixels[i+3]=data[i+3]*unit;}
    if(this.renderer.mode==='native'){const image=precise?new ImageData(pixels,width,height,{pixelFormat:'rgba-float16'}):hc.createImageData(width,height);if(!precise)image.data.set(pixels);hc.putImageData(image,0,0);}
    this.source={data,width,height,colorSpace:'srgb',hdr:false};this.renderer.resize(w,h);this.renderer.upload(this.source);this.fallback=halo;this.draw();
  }
  setAmount(value){this.amount=Math.max(0,Math.min(1,Number(value)||0));this.renderer.params.opacity=this.amount;this.draw();}
  setLampAmount(value){this.lampAmount=Math.max(0,Math.min(3,Number(value)||0));this.illuminate(this.power,this.gain,this.brightness);}
  illuminate(power,gain=1,brightness=1){this.power=power;this.gain=gain;this.brightness=brightness;this.renderer.params.opacity=this.amount;this.renderer.params.brightness=brightness*gain*this.lampAmount;this.draw();}
  draw(){
    const r=this.renderer;r.canvas.hidden=!this.power||this.amount===0||this.lampAmount===0;r.canvas.dataset.exposureGain=String(this.gain||1);r.canvas.dataset.strength=String(this.amount);r.canvas.dataset.emitterAmount=String(this.lampAmount);
    if(!this.ready||!this.power||this.amount===0||this.lampAmount===0)return;
    if(r.mode==='native'&&this.fallback){const ctx=r.canvas.getContext('2d');ctx.clearRect(0,0,r.canvas.width,r.canvas.height);for(let i=0;i<this.amount;i++){ctx.globalAlpha=Math.min(1,r.params.brightness*.70)*Math.min(1,this.amount-i);ctx.drawImage(this.fallback,0,0,r.canvas.width,r.canvas.height);}}
    else r.draw();
  }
}
