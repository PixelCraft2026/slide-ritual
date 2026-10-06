// Based on reference/画面参考2.mp4, original PTS 18.883333–20.383333.
// See qa/reference-sequence.json: 121 consecutive source frames, no resampling.
export const CHANGE_MS=1500;
export const EXIT_MS=200;
export const STARTUP_CHANGE_MS=1850;
export const APERTURE_HOLD_MS=5000;
// One camera-exposure recovery for the image and every housing emitter.
export const EXPOSURE_PEAK=1.34;
export const SLIDE_PITCH=.098;
export const GATE_Z=-.22;
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=x=>{x=clamp(x);return x*x*(3-2*x);};
const filmEntry=(p,duration=200)=>{const velocity=6*p*(1-p)/duration;return {shift:smooth(p)-1,clipRight:0,corner:0,velocity,blur:velocity*1000/240};};
// Travel past the fixed optical field, including narrow portrait photos.
export const filmTravel=(aperture,width)=>(aperture+width)/2+1;
// A half-frame shutter at 60 Hz, bounded to a subtle 8 CSS-pixel radius.
export const motionRadius=(frame,travel)=>Math.min(8,Math.abs(frame.velocity||0)*travel*1000/240);
export function projectionOptics(frame,aperture,width){
  const dx=frame.shift*filmTravel(aperture,width),left=Math.max(-aperture/2,dx-width/2),right=Math.min(aperture/2,dx+width/2),visible=Math.max(0,right-left),clipRight=1-visible/width;
  // Approximate spill from the visible midline, without clipping the photo.
  return {...frame,clipRight,shift:visible?(left+right)/(2*width)+clipRight*.5:0};
}
export function transitionAt(ms){
  // The entire photo translates continuously inside a stationary octagon.
  // There is no second moving mask or stationary segment of the travel.
  if(ms<EXIT_MS){const p=clamp(ms/EXIT_MS),gain=1+(EXPOSURE_PEAK-1)*smooth(p),film=filmEntry(1-p,EXIT_MS);return {phase:'out',open:1-p,...film,velocity:-film.velocity||0,exposure:(1-p)*gain,boost:gain,adaptation:gain,swap:false};}
  if(ms<967)return {phase:'dark',open:0,shift:-1,clipRight:0,corner:0,velocity:0,blur:0,exposure:0,boost:EXPOSURE_PEAK,adaptation:EXPOSURE_PEAK,swap:ms>=600};
  if(ms<1167){const p=clamp((ms-967)/200);return {phase:'in',open:p,...filmEntry(p),exposure:p*EXPOSURE_PEAK,boost:EXPOSURE_PEAK,adaptation:EXPOSURE_PEAK,swap:true};}
  const p=smooth((ms-1167)/333),gain=1+(EXPOSURE_PEAK-1)*(1-p);return {phase:'settle',open:1,shift:0,clipRight:0,corner:0,velocity:0,blur:0,exposure:gain,boost:gain,adaptation:gain,swap:true};
}

// External motion follows the reference's pull / dwell / index / push order.
// The hidden linkage and exact travel distances are a geometric approximation.
export function mechanismAt(ms,reverse=false){
  const extraction=smooth(ms/310),indexing=smooth((ms-390)/220),insertion=smooth((ms-740)/427);
  const direction=reverse?-1:1;
  return {
    phase:ms<310?'extract':ms<390?'release':ms<610?'index':ms<740?'engage':ms<1167?'insert':'seated',
    extraction,indexing,insertion,direction,
    oldX:.56+1.01*extraction,
    newX:1.57-1.01*insertion,
    trayZ:-direction*SLIDE_PITCH*indexing,
    newZ:GATE_Z+direction*SLIDE_PITCH*(1-indexing),
    carriage:extraction*(1-insertion),
    // A little lamp light always escapes through the side, even with the gate shut.
    leak:.48+.52*Math.sin(Math.PI*extraction*(1-insertion)),
  };
}

// Reference 2, one-based decoded frames 297–370 (variable frame rate).
// Include the beginning of the empty-gate wipe seen just before frame 297.
export function startupAt(ms){
  let mechanicalMs;
  if(ms<200)mechanicalMs=ms/200*EXIT_MS;
  else if(ms<1000)mechanicalMs=EXIT_MS+(ms-200)/800*(967-EXIT_MS);
  else if(ms<1300)mechanicalMs=967+(ms-1000)/300*200;
  else mechanicalMs=1167+Math.min(1,(ms-1300)/550)*333;
  const f=transitionAt(mechanicalMs);
  // Only the empty white gate has a shutter wipe; photos use translation.
  if(ms<200){f.shift=0;f.corner=0;f.velocity=0;f.blur=0;f.clipRight=clamp(ms/200);}
  else if(ms<1300){f.velocity*=2/3;f.blur=Math.abs(f.velocity)*1000/240;}
  return {...f,mechanicalMs};
}

export function projectionLayout(w,h,ratio,zoom=1){
  const mobile=w<600;
  const aperture=Math.min(Math.min(w*(mobile?.63:.52),h*(mobile?.43:.55))*zoom,w*.9,h*(mobile?.63:.70));
  // Both orientations use the same optical field. Square images fit inside
  // the diagonal corners instead of exceeding the empty gate's illumination.
  const short=Math.min(ratio,1/ratio),long=aperture*Math.min(1,1.68/(1+short));
  return {aperture,width:ratio>=1?long:long*ratio,height:ratio>=1?long/ratio:long};
}
