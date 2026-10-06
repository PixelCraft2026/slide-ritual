import { readFile } from 'node:fs/promises';
import { ProjectionRenderer, decodeImage } from '../../renderer.js';
import { ProjectorScene, WallLight } from '../../scene.js';
import { AirLight } from '../../atmosphere.js';
import { NativeProjection } from '../../native-projection.js';
import * as timing from '../../transition.js';
import { translate } from '../../i18n.js';

// Execute the app's actual preparation/swap/RAF functions. Browser surfaces are
// spies: this qualifies work placement and render counts, not GPU time or FPS.
export async function transportHarness(options={}){
  const Renderer=options.Renderer||ProjectionRenderer,Scene=options.Scene||ProjectorScene,Wall=options.Wall||WallLight,Air=options.Air||AirLight;
  const text=options.appSource||await readFile(new URL('../../app.js',import.meta.url),'utf8');
  const original=new Map(),globals=['document','Image','devicePixelRatio','GPUTextureUsage','requestAnimationFrame','cancelAnimationFrame','performance','matchMedia','createImageBitmap'];
  for(const name of globals)original.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
  const clock={now:0},rafs=new Map(),elements=new Map();let nextFrame=0,env;
  const metrics={frames:[],textureUploads:0,textureBytes:0,uploadsDuringTransport:0,canvasCreatesDuringTransport:0,readbacksDuringTransport:0,layoutReadsDuringTransport:0,configurationsDuringTransport:0,sceneResizesDuringTransport:0,machineResizesDuringTransport:0,nativeSrcDuringTransport:0,nativeStyleDuringTransport:0,clipMasksDuringTransport:0,animationStarts:0,animations:new Set(),errors:[]};
  const critical=()=>metrics.inFrame||env?.transporting;
  function dimension(value){return{get(){if(critical())metrics.layoutReadsDuringTransport++;return value;},configurable:true};}
  function element(id){
    if(elements.has(id))return elements.get(id);
    const style=new Proxy({getPropertyValue(name){return this[name]||'';},setProperty(name,value){if(critical()&&name==='dynamic-range-limit')metrics.nativeStyleDuringTransport++;this[name]=value;}},{set(target,name,value){if(critical()&&name==='clipPath'&&String(value).startsWith('inset'))metrics.clipMasksDuringTransport++;if(critical()&&name==='filter')metrics.nativeStyleDuringTransport++;target[name]=value;return true;}});
    const el={id,style,dataset:{},classList:{add(){},remove(){},toggle(){}},hidden:false,value:'1',scrollLeft:0,setAttribute(){},removeAttribute(){},prepend(){},replaceWith(next){this.replacement=next;},replaceChildren(){},remove(){},append(){},addEventListener(){},scrollTo({left}){this.scrollLeft=left;},getBoundingClientRect(){if(critical())metrics.layoutReadsDuringTransport++;return{left:0,right:528};},querySelector(){return element(`${id}-span`);},querySelectorAll(){return[];}};
    if(options.animations!==false)el.animate=(keyframes,settings)=>{const animation={keyframes,settings,currentTime:0,pause(){this.paused=true;},play(){this.paused=false;},cancel(){metrics.animations.delete(this);}};metrics.animations.add(animation);metrics.animationStarts++;return animation;};
    if(id==='native')Object.defineProperty(el,'src',{set(){if(critical())metrics.nativeSrcDuringTransport++;}});
    Object.defineProperties(el,{clientWidth:dimension(id==='stage'||id==='room'?1440:528),clientHeight:dimension(id==='stage'||id==='room'?960:352)});
    if(id==='toast')Object.defineProperty(el,'textContent',{set(value){metrics.errors.push(value);}});
    elements.set(id,el);return el;
  }
  function canvas(id){
    let width=1,height=1;const c=element(id),ctx={canvas:c,clearRect(){},save(){},restore(){},scale(){},setTransform(){},translate(){},transform(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},clip(){},fillRect(){},drawImage(){},putImageData(){},createLinearGradient(){return{addColorStop(){}};},createRadialGradient(){return{addColorStop(){}};},createImageData(w,h){return{data:new Uint8ClampedArray(w*h*4)};},getImageData(x,y,w,h,options){
      if(options)throw new Error('Synthetic SDR readback');if(critical())metrics.readbacksDuringTransport++;
      const data=new Uint8ClampedArray(w*h*4);data.fill(128);for(let i=3;i<data.length;i+=4)data[i]=255;return{data,colorSpace:'srgb'};
    }};
    Object.defineProperties(c,{width:{get(){return width;},set(v){width=v;}},height:{get(){return height;},set(v){height=v;}}});c.getContext=()=>ctx;return c;
  }
  const document={body:element('body'),hidden:false,addEventListener(){},querySelector(selector){return element(selector==='.projection-stage'?'stage':'empty-gate');},createElement(type){if(type==='canvas'){if(critical())metrics.canvasCreatesDuringTransport++;return canvas(`canvas-${elements.size}`);}return element(`element-${elements.size}`);}};
  const slides=[{name:'6000 x 4000',width:6000,height:4000,url:'generated-0',type:'SDR'},{name:'9000 x 6000',width:9000,height:6000,url:'generated-1',type:'SDR'},{name:'4000 x 6000',width:4000,height:6000,url:'generated-2',type:'SDR'}];
  if(options.nativePhotos)for(const slide of slides)slide.hdrCandidate=true;
  if(options.slides)slides.splice(0,slides.length,...options.slides);
  Object.assign(globalThis,{document,devicePixelRatio:2,GPUTextureUsage:{TEXTURE_BINDING:1,COPY_DST:2},matchMedia:()=>({matches:false,addEventListener(){}}),requestAnimationFrame(fn){const id=++nextFrame;rafs.set(id,fn);return id;},cancelAnimationFrame(id){rafs.delete(id);},Image:class{constructor(){const image=element(`image-${elements.size}`);image.decode=()=>Promise.resolve();Object.defineProperty(image,'src',{get(){return image.url;},set(url){if(critical())metrics.nativeSrcDuringTransport++;image.url=url;const slide=slides.find(slide=>slide.url===url);image.naturalWidth=slide.width;image.naturalHeight=slide.height;queueMicrotask(()=>image.onload?.());}});return image;}},createImageBitmap:async c=>({width:c.width,height:c.height,close(){}})});
  Object.defineProperty(globalThis,'performance',{value:{now:()=>clock.now},configurable:true,writable:true});
  function renderer(id){
    const r=new Renderer(canvas(id),message=>{throw new Error(message);});r.mode='webgpu';r.pipeline={getBindGroupLayout(){return{};}};
    r.gpu={configure(){if(critical())metrics.configurationsDuringTransport++;},getCurrentTexture(){return{createView(){return{};}};}};
    r.device={createTexture(){return{createView(){return{};},destroy(){}};},createBindGroup(){return{};},queue:{writeTexture(target,data){metrics.textureUploads++;metrics.textureBytes+=data.byteLength;if(critical())metrics.uploadsDuringTransport++;},writeBuffer(){},onSubmittedWorkDone(){return Promise.resolve();},submit(){if(metrics.inFrame&&id==='projection')metrics.frame.projectionRenders++;}},createCommandEncoder(){return{beginRenderPass(){return{setPipeline(){},setBindGroup(){},draw(){},end(){}};},finish(){return{};}};}};
    return r;
  }
  const photo=renderer('projection'),glow=renderer('glow');
  const scene=Object.assign(Object.create(Scene.prototype),{canvas:canvas('projector'),scene:{},camera:{updateProjectionMatrix(){}},renderer:{getPixelRatio(){return 1.5;},setPixelRatio(){},setSize(){if(critical())metrics.sceneResizesDuringTransport++;},render(){if(metrics.inFrame)metrics.frame.sceneRenders++;}}});
  scene.lensPosition=()=>({x:720,y:740});scene.illuminate=()=>scene.draw();scene.mechanism=()=>scene.draw();scene.reset=()=>scene.draw();
  const wall=new Wall(canvas('wall')),air=new Air(canvas('air'));
  const machineLight={renderer:glow,resize(){if(critical())metrics.machineResizesDuringTransport++;},configure(hdr){glow.configure(hdr);},illuminate(){glow.draw();}};
  const room=element('room'),screen=element('screen');element('photoY').value='-3';element('depth').value='4';element('focus').value='0';element('interval').value='4';
  const nativeProjection=new NativeProjection(element('opticalGate'),element('filmMotion'),element('texture'));
  if(options.nativePhotos)nativeProjection.exposure=element('native-exposure');
  env={$:element,t:(key,params)=>translate(key,'zh-CN',params),room,screen,native:element('native'),nativeProjection,renderer:photo,scene,wall,air,machineLight,decodeImage:options.decodeImage||decodeImage,state:{slides,index:0,on:true,auto:false,busy:false,importing:false,demo:false,immersive:false,epoch:0,native:false,nativeHDR:false,displayMode:'auto',started:true,ready:true,aperture:false},cache:new Map(),hdrQuery:{matches:Boolean(options.nativePhotos)},reduceMotion:{matches:false},exposure:1,transporting:false,layoutPending:false,projectionWidth:528,autoTimer:null,transitionFrame:null,finishTransition:null,toastTimer:null,hideTimer:null,powerIcon:'',audio:{advance(){},stopAdvance(){},stopFan(){}},mountProjection(){},showImmersiveControls(){},delay:async()=>{},setTimeout:()=>0,clearTimeout(){},...timing};
  const functions=text.slice(text.indexOf('function toast('),text.indexOf('async function importFiles('));
  env.slideLoads=new WeakMap();
  env.nextDownload=null;env.upcoming=null;
  env.emptyGateSource={width:1,height:1,data:new Float32Array([1,1,1,1]),colorSpace:'srgb',hdr:false};
  if(options.audio)env.audio=options.audio;
  if(options.delay)env.delay=options.delay;
  if(options.setTimeout)env.setTimeout=options.setTimeout;
  if(options.clearTimeout)env.clearTimeout=options.clearTimeout;
  const api=new Function('env',`with(env){${functions}\nreturn{power,loadSlide,goTo,fitScreen,present,resetTransition,scheduleAuto,stopAuto,toggleAuto,prepareUpcoming:typeof prepareUpcoming==='function'?prepareUpcoming:null,preloadNextDownload:typeof preloadNextDownload==='function'?preloadNextDownload:null,nextIndex:typeof nextIndex==='function'?nextIndex:null,preparePresentation:typeof preparePresentation==='function'?preparePresentation:null};}`)(env);
  const width=1200,height=800,data=new Float32Array(width*height*4);data.fill(.25);for(let i=3;i<data.length;i+=4)data[i]=1;
  const loaded={source:{data,width,height,hdr:false,colorSpace:'srgb'},native:Boolean(slides[0].hdrCandidate)};
  if(loaded.native){loaded.image=new Image();loaded.image.src=slides[0].url;await loaded.image.decode();}
  env.cache.set(slides[0],loaded);
  api.fitScreen();
  if(api.preparePresentation){
    let ready=false;const preparation=api.preparePresentation(slides[0],loaded);preparation.then(()=>{ready=true;},()=>{ready=true;});
    while(!ready){if(rafs.size){clock.now+=options.frameStep||1000/60;for(const [id,fn]of [...rafs]){if(!rafs.has(id))continue;rafs.delete(id);fn(clock.now);}}await new Promise(resolve=>setImmediate(resolve));}
    api.present(slides[0],loaded,await preparation);
  }else{await photo.prepare(loaded.source);api.present(slides[0],loaded);}
  const initialUploads=metrics.textureUploads,initialBytes=metrics.textureBytes;
  async function run(pending,control={}){
    let done=false;const work=Promise.resolve(pending).finally(()=>{done=true;});const start=metrics.frames.length;
    let firstFrame,interrupted=false,changedLayout=false;
    for(let step=0;!done&&step<10000;step++){
      if(rafs.size){clock.now+=options.frameStep||1000/60;const callbacks=[...rafs.entries()];for(const [id,fn]of callbacks){
        if(!rafs.has(id))continue;rafs.delete(id);
        if(fn.name==='frame'){
          firstFrame??=clock.now;const elapsed=clock.now-firstFrame;
          if(!interrupted&&control.interruptAt!=null&&elapsed>=control.interruptAt){interrupted=true;env.state.epoch++;env.state.on=false;env.state.busy=false;api.resetTransition();continue;}
          if(!changedLayout&&control.layoutAt!=null&&elapsed>=control.layoutAt){changedLayout=true;element('zoom').value=String(control.zoom||1.2);api.fitScreen();}
        }
        metrics.inFrame=fn.name==='frame';if(metrics.inFrame){metrics.frame={time:clock.now,sceneRenders:0,projectionRenders:0};metrics.frames.push(metrics.frame);}fn(clock.now);metrics.inFrame=false;
      }}
      await new Promise(resolve=>setImmediate(resolve));
    }
    if(!done)throw new Error('Transport did not finish');await work;
    return metrics.frames.slice(start);
  }
  async function goTo(index,control={}){const frames=await run(api.goTo(index),control);if(env.state.on)assertIndex(index);return frames;}
  function assertIndex(index){if(env.state.index!==index||metrics.errors.length)throw new Error(`Transport failed: ${metrics.errors.join('; ')}`);}
  return{env,metrics,api,goTo,run,summary(){return{frames:metrics.frames.length,maxSceneRendersPerFrame:Math.max(0,...metrics.frames.map(frame=>frame.sceneRenders)),maxProjectionRendersPerFrame:Math.max(0,...metrics.frames.map(frame=>frame.projectionRenders)),textureUploads:metrics.textureUploads-initialUploads,textureBytes:metrics.textureBytes-initialBytes,uploadsDuringTransport:metrics.uploadsDuringTransport,canvasCreatesDuringTransport:metrics.canvasCreatesDuringTransport,readbacksDuringTransport:metrics.readbacksDuringTransport,layoutReadsDuringTransport:metrics.layoutReadsDuringTransport,configurationsDuringTransport:metrics.configurationsDuringTransport,sceneResizesDuringTransport:metrics.sceneResizesDuringTransport,machineResizesDuringTransport:metrics.machineResizesDuringTransport,nativeSrcDuringTransport:metrics.nativeSrcDuringTransport,nativeStyleDuringTransport:metrics.nativeStyleDuringTransport,clipMasksDuringTransport:metrics.clipMasksDuringTransport,animationStarts:metrics.animationStarts};},async close(){const ahead=env.upcoming?.pending;env.state.auto=false;env.state.epoch++;env.upcoming=null;await Promise.all(slides.map(slide=>env.slideLoads.get(slide)).filter(Boolean));if(ahead)await run(ahead);while(photo.preparingProjection)await new Promise(resolve=>setImmediate(resolve));nativeProjection.reset();rafs.clear();for(const [name,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}};
}
