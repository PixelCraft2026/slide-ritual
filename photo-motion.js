import { transitionAt,startupAt } from './transition.js';

export const PHOTO_MOTION_SAMPLES=128;
export const PHOTO_UNIFORM_BYTES=64+PHOTO_MOTION_SAMPLES*16;
// A 180-degree shutter on the existing 60 Hz projection update clock. Motion
// is known analytically; no optical-flow estimation or scene copies are used.
export function photoMotion(frame,{time=0,opening=false,travel=1,scale=1,fps=60,maxSamples=PHOTO_MOTION_SAMPLES,neutralGain=false}={},data=new Float32Array(PHOTO_MOTION_SAMPLES*4)){
  const at=opening?startupAt:transitionAt,shutter=500/fps;
  const before=at(time-shutter/2),after=at(time+shutter/2);
  const distance=Math.abs(after.shift-before.shift)*travel*scale;
  if(!frame.velocity||distance<=.25)return null;
  const count=Math.min(PHOTO_MOTION_SAMPLES,maxSamples,Math.max(16,Math.ceil(distance*1.5)));
  for(let i=0;i<count;i++){
    const f=at(time+((i+.5)/count-.5)*shutter),same=f.swap===frame.swap;
    data[i*4]=(f.shift-frame.shift)*travel*scale;
    data[i*4+1]=0;
    data[i*4+2]=neutralGain?1:f.boost/frame.boost;
    data[i*4+3]=same&&f.exposure>0?1:0;
  }
  return{count,data,distance,shutter};
}

// Leave room for the shutter's source edges. The compositor continues moving
// this padded surface through the stationary optical gate. No moving clip.
export function photoPadding(travel){return Math.ceil(Math.max(0,travel)/24);}
