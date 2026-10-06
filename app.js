import { hasHDRMetadata, linearToSrgb } from './hdr.js';
import { ProjectionRenderer, decodeImage } from './renderer.js';
import { processRadiancePixels } from './pixels.js';
import { resampleArea } from './resample.js';
import { ProjectorAudio } from './audio.js';
import { ProjectorScene, WallLight } from './scene.js';
import { AirLight } from './atmosphere.js';
import { MachineLight } from './machine-light.js';
import { NativeProjection } from './native-projection.js';
import { CHANGE_MS, STARTUP_CHANGE_MS, APERTURE_HOLD_MS, transitionAt, startupAt, projectionLayout } from './transition.js';

const $=id=>document.getElementById(id);
const room=$('room'),screen=$('screen'),audio=new ProjectorAudio();
let native=$('nativeImage');
const nativeProjection=new NativeProjection($('opticalGate'),$('filmMotion'),document.querySelector('.surface-texture'));
// Initialize once so viewport changes preserve the user's foreground blur.
const initialDepth=matchMedia('(hover: none) and (pointer: coarse)').matches?2:4;
$('depth').value=String(initialDepth);
$('depth').defaultValue=String(initialDepth);
$('depthValue').textContent=initialDepth.toFixed(1);
room.style.setProperty('--foreground-blur',`${initialDepth}px`);
const demos=[
  {name:'山间来信',url:'assets/alpine.jpg',width:1800,height:1200,type:'SDR',demo:true},
  {name:'林间的访客',url:'assets/woodland.jpg',width:1800,height:2971,type:'SDR',demo:true},
  {name:'日落以前',url:'assets/evening.jpg',width:1800,height:1200,type:'SDR',demo:true},
];
const state={slides:demos.slice(),index:0,on:false,auto:false,busy:false,importing:false,demo:true,immersive:false,epoch:0,native:false,nativeHDR:false,displayMode:'auto',started:false,ready:false,aperture:false};
const powerIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v9m-5-6a8 8 0 1 0 10 0"/></svg>';
const cache=new Map(),hdrQuery=matchMedia('(dynamic-range: high)'),reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
let renderer=new ProjectionRenderer($('projection'),message=>toast(message)),autoTimer,toastTimer,hideTimer,transitionFrame,finishTransition;
const wall=new WallLight($('wallLight')),air=new AirLight($('airLight'));let scene;
const machineLight=new MachineLight($('machineGlow'));
let exposure=0;
let transporting=false,layoutPending=false,projectionWidth=0;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const emptyGateSource={width:1,height:1,data:new Float32Array([1,1,1,1]),colorSpace:'srgb',hdr:false};
function mountProjection(aperture){(aperture?document.querySelector('.empty-gate'):$('filmMotion')).prepend(renderer.canvas);}

function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');showImmersiveControls();clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),5500);}
function displayStatus(){
  const high=hdrQuery.matches,enabled=high&&state.displayMode==='auto'&&renderer.hdrSupported;
  renderer.configure(enabled);
  machineLight.configure(enabled,renderer.params.highlight);
  const nativeHDR=high&&state.nativeHDR&&state.displayMode==='auto';
  const label=nativeHDR?'HDR · 原生预览':enabled?'HDR · 已开启':'SDR · 已开启';
  $('rangeBadge').querySelector('span').textContent=label;$('rangeBadge').classList.toggle('hdr',enabled||nativeHDR);
  $('displayInfo').textContent=enabled?'HDR 显示环境 · SDR 高光扩展已启用':high?(state.displayMode==='sdr'?'已选择 SDR 显示':'HDR 显示环境 · 浮点 HDR 不可用，原生 HDR 照片由浏览器处理'):'当前显示环境为 SDR · HDR 照片自动映射';
  $('highlightSetting').hidden=!enabled||nativeHDR;
  updateMeta();applyNativeSettings();
}
function updateMeta(){
  const slide=state.slides[state.index];
  $('photoName').textContent=slide?.name||'片匣为空';
  let format=slide?.type||'';
  if(slide?.type==='HDR')format=state.nativeHDR?'HDR 标记 · 浏览器解码':renderer.hdr?'HDR':'HDR → SDR';
  else if(slide?.hdrCandidate)format=state.native?'HDR 标记 · 浏览器解码':format;
  else if(renderer.hdr&&slide)format='SDR → HDR';
  $('photoMeta').textContent=slide?`${slide.demo?'示例照片 · ':''}${format}`:'';
  const n=String(state.index+1).padStart(2,'0');$('currentCount').textContent=state.slides.length?n:'00';$('totalCount').textContent=String(state.slides.length).padStart(2,'0');
}
function updateUI(){
  room.classList.toggle('lit',state.on);room.classList.toggle('off',!state.on);
  $('machineState').textContent=state.importing?'装片中':state.busy?(state.started?'过片中':'灯泡预热'):state.on?(state.auto?'自动放映':'正在放映'):'待机';
  $('powerBtn').setAttribute('aria-pressed',String(state.on));$('powerBtn').setAttribute('aria-label',state.on?'关闭幻灯机':'开启幻灯机');
  $('startBtn').disabled=!state.ready||state.busy||state.importing||!state.slides.length;
  $('startBtn').textContent=state.started?'重新开机 →':'先看示例 →';
  $('powerBtn').innerHTML=powerIcon;$('powerBtn').disabled=!state.ready;
  $('importBtn').disabled=!state.ready||state.importing;
  $('playBtn').setAttribute('aria-pressed',String(state.auto));$('playBtn').setAttribute('aria-label',state.auto?'暂停自动放映':'自动放映');
  $('playBtn').innerHTML=state.auto?'<svg viewBox="0 0 24 24"><path d="M8 6h3v12H8Zm7 0h3v12h-3Z"/></svg>':'<svg viewBox="0 0 24 24"><path d="m9 6 10 6-10 6Z"/></svg>';
  $('filesBtn').disabled=!state.ready||state.importing;
  for(const id of ['prevBtn','nextBtn','playBtn'])$(id).disabled=!state.ready||state.busy||state.importing||!state.slides.length;
  $('intro').hidden=state.on||!$('settings').hidden;
  $('trayLabel').textContent=state.demo?'/ 三张风景':`/ ${state.slides.length} 张照片`;
  $('clearBtn').hidden=state.demo||!state.slides.length;
  for(const el of $('filmstrip').querySelectorAll('.slide'))el.setAttribute('aria-current',String(Number(el.dataset.index)===state.index));
  updateMeta();
}
function renderTray(){
  $('filmstrip').replaceChildren();
  state.slides.forEach((slide,index)=>{
    const button=document.createElement('button');button.className='slide';button.dataset.index=index;button.style.setProperty('--angle',`${[0,-2,1.4,-.8,1][index%5]}deg`);button.title=slide.name;button.setAttribute('aria-label',`第 ${index+1} 张：${slide.name}`);
    if(slide.type==='HDR'&&!slide.url){const preview=document.createElement('span');preview.className='hdr-preview';preview.textContent='HDR';button.append(preview);}
    else {const img=document.createElement('img');img.src=slide.url;img.alt='';img.loading='lazy';button.append(img);}
    const number=document.createElement('span');number.className='slide-number';number.textContent=String(index+1).padStart(2,'0');button.append(number);
    const type=document.createElement('span');type.className='slide-type';type.textContent=slide.type==='HDR'||slide.hdrCandidate?'HDR':'35 mm';button.append(type);
    button.addEventListener('click',()=>{if(state.busy||state.importing)return;if(!state.on){state.index=index;updateUI();fitScreen();}else goTo(index);});
    $('filmstrip').append(button);
  });
  updateUI();
}
function presentationLayout(slide=state.slides[state.index],apertureMode=state.aperture){
  const stage=document.querySelector('.projection-stage');
  const ratio=slide?(slide.width/slide.height):1.5;
  const zoom=Number($('zoom').value);
  const {width,height,aperture}=projectionLayout(stage.clientWidth,stage.clientHeight,ratio,zoom);
  const w=room.clientWidth,h=room.clientHeight,centerY=h*((w<600?.34:.31)-Number($('photoY').value)/100),lens=scene?.lensPosition()||{x:w*.54,y:h*.64};
  return{w,h,width,height,aperture,centerY,lens,sw:apertureMode?aperture:width,sh:apertureMode?aperture:height};
}
function applyLayout(layout,prepared){
  const {w,h,width,height,aperture,centerY,sw,sh,lens}=layout;projectionWidth=Math.round(width);
  screen.style.width=`${width}px`;screen.style.height=`${height}px`;
  room.style.setProperty('--screen-width',`${width}px`);room.style.setProperty('--screen-height',`${height}px`);
  room.style.setProperty('--aperture-size',`${aperture}px`);
  room.style.setProperty('--projection-center',`${centerY}px`);
  if(!renderer.canvas.hidden)renderer.resize(sw,sh);
  if(prepared){wall.activate(prepared.wall);air.activate(prepared.air);}
  else{wall.resize(w,h,sw,sh,centerY);air.resize(w,h,sw,sh,lens,centerY);machineLight.resize(w,h,scene,Number($('depth').value));}
}
function fitScreen(){
  if(transporting){layoutPending=true;return;}
  scene?.resize();applyLayout(presentationLayout());
}
function loadImage(url){return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('浏览器无法解码这张照片，请转换为 JPG、PNG、AVIF 或 .hdr'));image.src=url;});}
function preparationViewport(slide){
  const stage=document.querySelector('.projection-stage'),{width,height}=projectionLayout(stage.clientWidth,stage.clientHeight,slide.width/slide.height,Number($('zoom').value)),dpr=Math.min(devicePixelRatio||1,2);
  return{width:Math.max(1,Math.round(width*dpr)),height:Math.max(1,Math.round(height*dpr))};
}
async function loadSlide(slide){
  let result;const viewport=renderer.mode==='native'?undefined:preparationViewport(slide);
  if(cache.has(slide)){const loaded=cache.get(slide);if(!loaded.native&&viewport)await renderer.prepare(loaded.source,viewport);return loaded;}
  if(slide.file&&/\.(hdr|rgbe)$/i.test(slide.name))result={source:await processRadiancePixels(await slide.file.arrayBuffer(),viewport)};
  else{
    const image=await loadImage(slide.url);const source=await decodeImage(image,viewport);
    if(source.hdr){slide.type='HDR';slide.hdrCandidate=true;}
    // Preserve the native gain map if float readback flattened it. Never manufacture its lost highlights.
    result={source,image,native:renderer.mode==='native'||(slide.hdrCandidate&&!source.hdr)};
  }
  // Finish background filtering before the mechanical cycle starts.
  if(!result.native&&renderer.mode!=='native')await renderer.prepare(result.source,viewport);
  cache.set(slide,result);while(cache.size>2)cache.delete(cache.keys().next().value);return result;
}
function spillColor(source){
  let sum=[0,0,0],count=0;
  for(let i=0;i<source.data.length;i+=Math.max(4,Math.floor(source.data.length/4096/4)*4)){for(let c=0;c<3;c++)sum[c]+=Math.sqrt(Math.max(0,Math.min(1,source.data[i+c])));count++;}
  return sum.map(x=>Math.round(80+(x/count)*110)).join(',');
}
async function preparePresentation(slide,loaded,epoch=state.epoch){
  if(epoch!==state.epoch)return null;
  scene?.resize();const layout=presentationLayout(slide,false),dpr=Math.min(devicePixelRatio||1,2),viewport={width:Math.max(1,Math.round(layout.width*dpr)),height:Math.max(1,Math.round(layout.height*dpr))};
  machineLight.resize(layout.w,layout.h,scene,Number($('depth').value));
  if(!loaded.native&&renderer.mode!=='native')await renderer.stage(loaded.source,viewport);
  else if(renderer.mode==='native'&&!loaded.image&&!loaded.nativeURL){
    // Build the Radiance SDR fallback before transport, including PNG encoding.
    const src=loaded.source,canvas=document.createElement('canvas');canvas.width=src.width;canvas.height=src.height;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(src.width,src.height);
    for(let i=0;i<src.data.length;i+=4){for(let c=0;c<3;c++)pixels.data[i+c]=255*Math.pow(Math.max(0,src.data[i+c])/(1+Math.max(0,src.data[i+c])),1/2.2);pixels.data[i+3]=255;}
    ctx.putImageData(pixels,0,0);loaded.nativeURL=canvas.toDataURL();loaded.native=true;loaded.fallbackImage=await loadImage(loaded.nativeURL);
  }
  const nativeImage=loaded.native?await nativeProjection.prepare(loaded.image||loaded.fallbackImage,layout,{hdr:Boolean(slide.hdrCandidate&&loaded.image&&hdrQuery.matches&&state.displayMode==='auto'),displayMode:state.displayMode,...renderer.params}):null;
  if(epoch!==state.epoch)return null;
  const preparedWall=await wall.prepare(loaded.source,layout),preparedAir=await air.prepare(layout,preparedWall.color);
  if(epoch!==state.epoch)return null;
  const current=presentationLayout(slide,false);if(wall.layoutKey(current)!==wall.layoutKey(layout)||air.layoutKey(current,preparedWall.color)!==preparedAir.key)return preparePresentation(slide,loaded,epoch);
  return{layout,viewport,wall:preparedWall,air:preparedAir,spill:spillColor(loaded.source),nativeImage};
}
function present(slide,loaded,prepared){
  mountProjection(false);
  state.native=Boolean(loaded.native);state.nativeHDR=Boolean(state.native&&loaded.image&&slide.hdrCandidate);renderer.canvas.hidden=state.native;
  if(state.native){const image=prepared.nativeImage;if(image!==native){native.hidden=true;native.replaceWith(image);native=image;}native.id='nativeImage';native.hidden=false;native.alt=slide.name;nativeProjection.activate(state.nativeHDR&&hdrQuery.matches&&state.displayMode==='auto');}
  else {native.hidden=true;nativeProjection.deactivate();renderer.upload(loaded.source,prepared.viewport);}
  room.style.setProperty('--spill',prepared.spill);applyLayout(prepared.layout,prepared);light(exposure);displayStatus();
}
function applyNativeSettings(){
  const hdr=Boolean(state.native&&state.nativeHDR&&hdrQuery.matches&&state.displayMode==='auto');
  nativeProjection.setHDR(hdr);
  for(const id of ['brightness','focus'])$(id).disabled=hdr;
  if(!state.native)return;
  // CSS filters may flatten native HDR. Keep the native HDR path untouched.
  const filter=hdr?'none':`brightness(${renderer.params.brightness*renderer.params.boost}) blur(${renderer.params.focus}px)`,range=state.displayMode==='sdr'?'standard':'no-limit';
  if(native.style.filter!==filter)native.style.filter=filter;
  if(native.style.getPropertyValue('dynamic-range-limit')!==range)native.style.setProperty('dynamic-range-limit',range);
}
function light(value,optics){exposure=value;const emitted=value*renderer.params.brightness,gain=optics?.adaptation??1;room.style.setProperty('--exposure',String(emitted));room.dataset.exposureGain=String(gain);wall.draw(emitted,optics);air.illuminate(emitted,wall.color,optics);scene?.illuminate(state.on?1:0,emitted,wall.color,gain*renderer.params.brightness);machineLight.renderer.params.highlight=renderer.params.highlight;machineLight.illuminate(state.on?1:0,gain,renderer.params.brightness);}
function setOptics(frame){
  const gate=$('opticalGate'),motion=$('filmMotion');
  gate.style.opacity=String(frame.open>0?1:0);
  // Film moves through a fixed octagonal optical field. The field's boundary
  // stays in wall coordinates, so portrait and landscape intersections differ.
  if(state.native)nativeProjection.frame(frame);
  else {gate.style.clipPath=`inset(0 ${frame.clipRight*100}% 0 0)`;gate.style.transform=`translateX(${frame.shift*100}%)`;motion.style.transform='none';}
  renderer.params.motion=frame.blur;renderer.params.boost=frame.boost;renderer.draw();if(state.native&&!(state.nativeHDR&&hdrQuery.matches&&state.displayMode==='auto'))applyNativeSettings();
  // Native gain-map HDR keeps its unfiltered browser image path.
  const glow=$('screenGlow'),dx=(frame.shift-frame.clipRight*.5)*projectionWidth;
  glow.style.transform=`translate(-50%,-50%) translateX(${dx}px) rotate(.22deg)`;
  glow.style.width=`${projectionWidth*Math.max(.15,1-frame.clipRight)}px`;
  light(frame.exposure,frame);room.dataset.phase=frame.phase;
}
function resetTransition(){cancelAnimationFrame(transitionFrame);transitionFrame=null;finishTransition?.();finishTransition=null;transporting=false;air.setTransport(false);const wasAperture=state.aperture;state.aperture=false;mountProjection(false);$('opticalGate').style.opacity='1';$('opticalGate').style.clipPath=state.native?'none':'inset(0)';$('opticalGate').style.transform='none';$('filmMotion').style.transform='none';nativeProjection.reset();$('screenGlow').style.transform='';$('screenGlow').style.width='';$('screenGlow').style.opacity='';$('lampAperture').style.opacity='0';$('lampAperture').style.clipPath='inset(0)';room.classList.remove('changing');audio.stopAdvance();renderer.params.focus=Number($('focus').value);renderer.params.motion=0;renderer.params.boost=1;renderer.draw();scene?.reset();if(wasAperture||layoutPending){layoutPending=false;fitScreen();}light(state.on?1:0);room.dataset.phase=state.on?'hold':'off';}
function stopAuto(){state.auto=false;clearTimeout(autoTimer);autoTimer=null;updateUI();}
function scheduleAuto(){clearTimeout(autoTimer);if(!state.auto||!state.on||document.hidden)return;autoTimer=setTimeout(async()=>{if(!state.auto)return;const next=state.index+1;if(next>=state.slides.length&&!$('loop').checked){stopAuto();toast('本次放映结束');return;}await goTo(next);},Number($('interval').value)*1000);}

function animateTransport(epoch,reverse,opening,onSwap){
  const duration=opening?STARTUP_CHANGE_MS:CHANGE_MS;
  transporting=true;air.setTransport(true);
  audio.advance(reverse,duration/1000);room.classList.add('changing');
  const start=performance.now();nativeProjection.start(start,opening,reduceMotion.matches);let swapped=false;
  return new Promise(resolve=>{
    finishTransition=resolve;
    function frame(now){
      if(epoch!==state.epoch){resolve();return;}
      const ms=Math.max(0,Math.min(duration,now-start)),f=opening?startupAt(ms):transitionAt(ms);
      renderer.beginFrame();machineLight.renderer.beginFrame();scene?.beginFrame();wall.beginFrame();air.beginFrame();
      try{
      if(f.swap&&!swapped){onSwap();swapped=true;}
      if(reduceMotion.matches){f.shift=0;f.blur=0;f.corner=0;f.boost=1;f.adaptation=1;f.exposure=f.open>0?1:0;}
      if(opening&&!swapped){
        $('lampAperture').style.opacity=f.open>0?'1':'0';
        $('lampAperture').style.clipPath=`inset(0 ${f.clipRight*100}% 0 0)`;
        $('opticalGate').style.opacity='0';light(f.exposure,f);
      }else{
        $('lampAperture').style.opacity='0';$('screenGlow').style.opacity='';setOptics(f);
      }
      room.dataset.phase=(opening?'startup-':'')+f.phase;
      if(!reduceMotion.matches)scene?.mechanism(opening?f.mechanicalMs:ms,reverse);
      }finally{renderer.endFrame();machineLight.renderer.endFrame();scene?.endFrame();wall.endFrame();air.endFrame();}
      if(ms<duration)transitionFrame=requestAnimationFrame(frame);else resolve();
    }
    transitionFrame=requestAnimationFrame(frame);
  }).finally(()=>{if(epoch===state.epoch){transporting=false;air.setTransport(false);}});
}

async function power(){
  if(state.importing||!state.ready)return;
  if(state.on){state.epoch++;state.on=false;state.busy=false;stopAuto();resetTransition();audio.click();audio.stopFan();room.style.setProperty('--lamp','0');updateUI();return;}
  if(state.busy||!state.slides.length)return;
  state.busy=true;const epoch=++state.epoch;updateUI();
  try{
    const unlock=audio.unlock(),loaded=await loadSlide(state.slides[state.index]);await unlock;if(epoch!==state.epoch)return;
    const prepared=await preparePresentation(state.slides[state.index],loaded);
    if(epoch!==state.epoch)return;
    audio.click();audio.startFan();$('opticalGate').style.opacity='0';
    state.on=true;state.aperture=true;state.native=false;state.nativeHDR=false;
    native.hidden=true;nativeProjection.deactivate();renderer.canvas.hidden=false;mountProjection(true);renderer.upload(emptyGateSource);
    updateUI();displayStatus();fitScreen();wall.setSource(emptyGateSource);
    $('screenGlow').style.opacity='0';room.dataset.phase='warmup';
    room.style.setProperty('--lamp','.25');light(.07);await delay(reduceMotion.matches?150:550);if(epoch!==state.epoch)return;
    room.style.setProperty('--lamp','1');
    $('lampAperture').style.opacity='1';room.dataset.phase='aperture';light(1);
    // The same linear white and SDR/HDR rendering as a white photograph.
    // The five-second viewing interval also applies with reduced motion.
    await delay(APERTURE_HOLD_MS);if(epoch!==state.epoch)return;
    await animateTransport(epoch,false,true,()=>{state.aperture=false;present(state.slides[state.index],loaded,prepared);});
    if(epoch!==state.epoch)return;
    resetTransition();state.started=true;state.busy=false;updateUI();scheduleAuto();
  }catch(error){if(epoch!==state.epoch)return;state.busy=false;state.on=false;audio.stopFan();room.style.setProperty('--lamp','0');resetTransition();updateUI();toast(error.message);}
}
async function goTo(index){
  if(!state.ready||state.busy||state.importing||!state.slides.length)return;
  const reverse=index<state.index;
  if(index<0||index>=state.slides.length){if(!$('loop').checked){toast(index<0?'已是第一张':'已是最后一张');stopAuto();return;}index=(index+state.slides.length)%state.slides.length;}
  if(index===state.index){scheduleAuto();return;}
  if(!state.on){state.index=index;updateUI();fitScreen();return;}
  state.busy=true;clearTimeout(autoTimer);const epoch=++state.epoch;updateUI();
  try{
    const slide=state.slides[index],loaded=await loadSlide(slide);if(epoch!==state.epoch)return;
    const prepared=await preparePresentation(slide,loaded);if(epoch!==state.epoch)return;
    await animateTransport(epoch,reverse,false,()=>{state.index=index;present(slide,loaded,prepared);updateMeta();});
    if(epoch!==state.epoch)return;
    resetTransition();state.busy=false;updateUI();
    const current=$('filmstrip').querySelector(`[data-index="${index}"]`);current?.scrollIntoView({behavior:reduceMotion.matches?'instant':'smooth',block:'nearest',inline:'nearest'});
    scheduleAuto();
  }catch(error){if(epoch!==state.epoch)return;resetTransition();state.busy=false;stopAuto();updateUI();toast(`无法放映：${error.message}`);}
}
async function toggleAuto(){if(state.busy||state.importing)return;if(state.auto){stopAuto();return;}if(!state.on)await power();if(!state.on)return;state.auto=true;updateUI();scheduleAuto();}

async function importFiles(files,{folder=false}={}){
  if(state.importing||!state.ready)return;
  const all=Array.from(files);
  const accepted=(folder?all.filter(f=>/\.(jpe?g|png|webp|avif|gif|bmp|hdr|rgbe|heic|heif|tiff?)$/i.test(f.name)):all)
    .sort((a,b)=>(a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name,undefined,{numeric:true,sensitivity:'base'}));
  if(!accepted.length){if(all.length)toast('这个文件夹中没有可放映的照片');return;}
  state.epoch++;state.busy=false;resetTransition();stopAuto();state.importing=true;updateUI();
  const slides=[],failures=[];
  for(const file of accepted){
    let url;
    try{
      if(file.size>64*1024*1024)throw new Error('超过单张 64 MB 上限');
      if(/\.(heic|heif|raw|dng|cr2|cr3|nef|arw|exr|tiff?)$/i.test(file.name))throw new Error('请先转换为 JPG、PNG、AVIF 或 Radiance .hdr');
      if(/\.(hdr|rgbe)$/i.test(file.name)){
        const source=await processRadiancePixels(await file.arrayBuffer());
        const thumb=document.createElement('canvas');thumb.width=Math.min(112,source.width);thumb.height=Math.max(1,Math.round(thumb.width*source.height/source.width));
        if(thumb.height>180){thumb.height=180;thumb.width=Math.max(1,Math.round(180*source.width/source.height));}
        const ctx=thumb.getContext('2d'),pixels=ctx.createImageData(thumb.width,thumb.height);
        const preview=resampleArea(source.data,source.width,source.height,thumb.width,thumb.height);
        for(let i=0;i<preview.length;i+=4){const l=Math.max(.00001,.2126*preview[i]+.7152*preview[i+1]+.0722*preview[i+2]),scale=Math.min(1,l/(1+l)*1.25)/l;for(let c=0;c<3;c++)pixels.data[i+c]=255*linearToSrgb(preview[i+c]*scale);pixels.data[i+3]=255;}
        ctx.putImageData(pixels,0,0);
        slides.push({name:file.name,file,url:thumb.toDataURL(),width:source.originalWidth,height:source.originalHeight,type:'HDR',hdrCandidate:true});
      }else{
        url=URL.createObjectURL(file);const image=await loadImage(url);
        if(image.naturalWidth*image.naturalHeight>100_000_000)throw new Error('超过 1 亿像素上限，请缩小照片');
        const candidate=hasHDRMetadata(new Uint8Array(await file.slice(0,1_048_576).arrayBuffer()));
        slides.push({name:file.name,file,url,width:image.naturalWidth,height:image.naturalHeight,type:candidate?'HDR':'SDR',hdrCandidate:candidate});
      }
    }catch(error){if(url)URL.revokeObjectURL(url);failures.push(`${file.name}：${error.message}`);}
  }
  if(slides.length){
    if(state.demo||folder){for(const old of state.slides)if(old.url?.startsWith('blob:'))URL.revokeObjectURL(old.url);state.slides=slides;state.index=0;state.demo=false;cache.clear();}else state.slides.push(...slides);
    renderTray();fitScreen();
    if(state.on){try{const slide=state.slides[state.index],loaded=await loadSlide(slide),prepared=await preparePresentation(slide,loaded);if(prepared&&state.on){present(slide,loaded,prepared);state.started=true;}}catch(error){toast(error.message);}}
    toast(`已装入 ${slides.length} 张照片${failures.length?`\n${failures.length} 张未装入：${failures.slice(0,2).join('；')}`:''}`);
  }else toast(failures.slice(0,3).join('\n')||'没有可装入的照片');
  state.importing=false;updateUI();$('fileInput').value='';$('folderInput').value='';
  if(slides.length){toggleSettings(false);if(!state.on)await power();if(state.on){state.auto=true;updateUI();scheduleAuto();}}
}
function clearTray(){state.epoch++;state.on=false;state.busy=false;stopAuto();resetTransition();audio.stopFan();native.removeAttribute('src');for(const s of state.slides)if(s.url?.startsWith('blob:'))URL.revokeObjectURL(s.url);cache.clear();state.slides=[];state.index=0;state.native=false;state.nativeHDR=false;room.style.setProperty('--lamp','0');renderTray();fitScreen();toast('片匣已清空，可以装入新照片');}

async function immersive(){
  state.immersive=!state.immersive;room.classList.toggle('immersive',state.immersive);$('immersiveBtn').setAttribute('aria-pressed',String(state.immersive));
  if(state.immersive){$('settings').hidden=true;$('settingsBtn').setAttribute('aria-expanded','false');try{await room.requestFullscreen();}catch{toast('已进入沉浸观片；此浏览器未开启全屏');}}
  else if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});
  $('immersiveBtn').setAttribute('aria-label',state.immersive?'退出全屏':'进入全屏');fitScreen();showImmersiveControls();
}
function showImmersiveControls(){room.classList.add('interacting');clearTimeout(hideTimer);hideTimer=setTimeout(()=>{if(state.importing){showImmersiveControls();return;}room.classList.remove('interacting');},3200);}
function toggleSettings(force){const hidden=force!==undefined?!force:!$('settings').hidden;$('settings').hidden=hidden;$('settingsBtn').setAttribute('aria-expanded',String(!hidden));$('intro').hidden=state.on||!hidden;showImmersiveControls();}

$('startBtn').addEventListener('click',toggleAuto);$('powerBtn').addEventListener('click',power);
$('prevBtn').addEventListener('click',()=>goTo(state.index-1));
$('nextBtn').addEventListener('click',()=>goTo(state.index+1));
$('playBtn').addEventListener('click',toggleAuto);
// Unlock audio in the gesture that opens the OS folder picker, before its async return.
$('importBtn').addEventListener('click',()=>{audio.unlock().catch(()=>{});$('folderInput').click();});
$('folderInput').addEventListener('change',e=>importFiles(e.target.files,{folder:true}));
$('filesBtn').addEventListener('click',()=>{audio.unlock().catch(()=>{});$('fileInput').click();});
$('fileInput').addEventListener('change',e=>importFiles(e.target.files));$('clearBtn').addEventListener('click',clearTray);
$('settingsBtn').addEventListener('click',()=>toggleSettings());$('closeSettings').addEventListener('click',()=>toggleSettings(false));$('rangeBadge').addEventListener('click',()=>toggleSettings(true));
$('soundBtn').addEventListener('click',async()=>{await audio.unlock();audio.setEnabled(!audio.enabled);$('soundBtn').setAttribute('aria-pressed',String(audio.enabled));$('soundBtn').setAttribute('aria-label',audio.enabled?'关闭机械声音':'开启机械声音');$('soundBtn').style.opacity=audio.enabled?'1':'.4';toast(audio.enabled?'机械声音已开启':'机械声音已关闭');});
$('immersiveBtn').addEventListener('click',immersive);screen.addEventListener('dblclick',immersive);
for(const event of ['pointermove','pointerdown','keydown','wheel','focusin'])document.addEventListener(event,showImmersiveControls,{passive:true});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&state.immersive){state.immersive=false;room.classList.remove('immersive');$('immersiveBtn').setAttribute('aria-pressed','false');$('immersiveBtn').setAttribute('aria-label','进入全屏');fitScreen();}});
document.addEventListener('keydown',e=>{
  if(e.target.matches('input,select,textarea')||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.target.closest('summary,button')&&(e.code==='Space'||e.key==='Enter'))return;
  if(e.key==='ArrowRight'){e.preventDefault();goTo(state.index+1);}else if(e.key==='ArrowLeft'){e.preventDefault();goTo(state.index-1);}else if(e.code==='Space'){e.preventDefault();toggleAuto();}
  else if(e.key.toLowerCase()==='p')power();else if(e.key.toLowerCase()==='m')$('soundBtn').click();else if(e.key.toLowerCase()==='f')immersive();else if(e.key==='Escape'){toggleSettings(false);if(state.immersive)immersive();}
});
const settings=[['brightness','brightness',v=>`${Math.round(v*100)}%`],['focus','focus',v=>v<.1?'清晰':`${v.toFixed(1)} px`],['texture','texture',v=>v<.05?'无':v<.4?'轻微':v<.75?'适中':'明显'],['highlight','highlight',v=>`${v.toFixed(1)}×`]];
for(const [id,param,format]of settings)$(id).addEventListener('input',()=>{const v=Number($(id).value);renderer.params[param]=v;$(id+'Value').textContent=format(v);room.style.setProperty('--texture',String(renderer.params.texture));renderer.draw();applyNativeSettings();light(exposure);});
$('zoom').addEventListener('input',()=>{$('zoomValue').textContent=`${Math.round(Number($('zoom').value)*100)}%`;fitScreen();});
$('depth').addEventListener('input',()=>{const value=$('depth').value;room.style.setProperty('--foreground-blur',`${value}px`);$('depthValue').textContent=Number(value).toFixed(1);machineLight.resize(room.clientWidth,room.clientHeight,scene,Number(value));});
$('diffusion').addEventListener('input',()=>{wall.amount=Number($('diffusion').value);$('diffusionValue').textContent=`${Math.round(wall.amount*100)}%`;light(exposure);});
$('airAmount').addEventListener('input',()=>{const value=Number($('airAmount').value);$('airAmountValue').textContent=`${Math.round(value*100)}%`;air.setAmount(value);});
$('bloom').addEventListener('input',()=>{const value=Number($('bloom').value);$('bloomValue').textContent=`${Math.round(value*100)}%`;machineLight.setAmount(value);});
$('topReflectance').addEventListener('input',()=>{const value=Number($('topReflectance').value);$('topReflectanceValue').textContent=`${Math.round(value*100)}%`;scene?.setTopReflectance(value);});
$('machineLights').addEventListener('input',()=>{const value=Number($('machineLights').value);$('machineLightsValue').textContent=`${Math.round(value*100)}%`;scene?.setEmitterAmount(value);machineLight.setLampAmount(value);});
function setProjectorPosition(){
  const y=Number($('projectorY').value),pitch=Number($('projectorPitch').value);
  room.style.setProperty('--projector-y',`${-y}vh`);
  $('projectorYValue').textContent=y?`${y<0?'下':'上'} ${Math.abs(y)}%`:'基准';
  $('projectorPitchValue').textContent=pitch?`${pitch>0?'仰':'俯'} ${Math.abs(pitch)}°`:'0°';
  scene?.setPitch(pitch);
  fitScreen();
}
for(const id of ['projectorY','projectorPitch'])$(id).addEventListener('input',setProjectorPosition);
$('resetProjectorPosition').addEventListener('click',()=>{$('projectorY').value=-5;$('projectorPitch').value=0;setProjectorPosition();});
function setPhotoPosition(){const y=Number($('photoY').value);$('photoYValue').textContent=y?`${y<0?'下':'上'} ${Math.abs(y)}%`:'基准';fitScreen();}
$('photoY').addEventListener('input',setPhotoPosition);
$('resetPhotoPosition').addEventListener('click',()=>{$('photoY').value=-3;setPhotoPosition();});
$('volume').addEventListener('input',()=>{const v=Number($('volume').value);audio.setVolume(v);$('volumeValue').textContent=`${Math.round(v*100)}%`;});
$('fanVolume').addEventListener('input',()=>{const v=Number($('fanVolume').value);audio.setFanVolume(v);$('fanVolumeValue').textContent=`${Math.round(v*100)}%`;});
$('interval').addEventListener('input',()=>{$('intervalValue').textContent=`${Number($('interval').value)} 秒`;scheduleAuto();});
$('interval').addEventListener('change',scheduleAuto);$('displayMode').addEventListener('change',()=>{state.displayMode=$('displayMode').value;displayStatus();});hdrQuery.addEventListener('change',displayStatus);
let dragDepth=0;
document.addEventListener('dragenter',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();dragDepth++;$('dropOverlay').hidden=false;}});
document.addEventListener('dragover',e=>{if(Array.from(e.dataTransfer?.types||[]).includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;$('dropOverlay').hidden=true;}});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('dropOverlay').hidden=true;if(e.dataTransfer?.files.length)importFiles(e.dataTransfer.files);});
window.addEventListener('resize',fitScreen);
document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(autoTimer);audio.suspend();}else{if(state.on)audio.resume();scheduleAuto();}});

try{scene=new ProjectorScene($('projector'));}catch(error){console.warn('Projector geometry unavailable:',error);toast('当前浏览器无法绘制三维机身，照片仍可放映');}
renderTray();fitScreen();
try{await renderer.init();}catch(error){renderer.mode='native';toast(`使用浏览器原生显示：${error.message}`);}
await nativeProjection.initExposure(renderer);
try{await machineLight.init();}catch{machineLight.renderer.canvas.hidden=true;}
state.ready=true;renderer.canvas.dataset.renderer=renderer.mode;displayStatus();updateUI();fitScreen();light(0);showImmersiveControls();
