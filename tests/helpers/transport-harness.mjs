import { readFile } from 'node:fs/promises';
import { ProjectionRenderer, decodeImage } from '../../renderer.js';
import { ProjectorScene, WallLight } from '../../scene.js';
import { AirLight } from '../../atmosphere.js';
import * as timing from '../../transition.js';

// Execute the app's actual preparation/swap/RAF functions. Browser surfaces are
// spies: this qualifies work placement and render counts, not GPU time or FPS.
export async function transportHarness(options={}){
  const Renderer=options.Renderer||ProjectionRenderer,Scene=options.Scene||ProjectorScene,Wall=options.Wall||WallLight,Air=options.Air||AirLight;
  const text=options.appSource||await readFile(new URL('../../app.js',import.meta.url),'utf8');
  const original=new Map(),globals=['document','Image','devicePixelRatio','GPUTextureUsage','requestAnimationFrame','cancelAnimationFrame','performance','matchMedia','createImageBitmap'];
  for(const name of globals)original.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
  const clock={now:0},rafs=new Map(),elements=new Map();let nextFrame=0,env;
  const metrics={frames:[],textureUploads:0,textureBytes:0,uploadsDuringTransport:0,canvasCreatesDuringTransport:0,readbacksDuringTransport:0,layoutReadsDuringTransport:0,configurationsDuringTransport:0,sceneResizesDuringTransport:0,machineResizesDuringTransport:0,errors:[]};
  const critical=()=>metrics.inFrame||env?.transporting;
  function dimension(value){return{get(){if(critical())metrics.layoutReadsDuringTransport++;return value;},configurable:true};}
  function element(id){
    if(elements.has(id))return elements.get(id);
    const el={id,style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){}},hidden:false,value:'1',setAttribute(){},removeAttribute(){},prepend(){},replaceChildren(){},append(){},addEventListener(){},scrollIntoView(){},querySelector(){return element(`${id}-span`);},querySelectorAll(){return[];}};
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
  const document={hidden:false,addEventListener(){},querySelector(selector){return element(selector==='.projection-stage'?'stage':'empty-gate');},createElement(type){if(type==='canvas'){if(critical())metrics.canvasCreatesDuringTransport++;return canvas(`canvas-${elements.size}`);}return element(`element-${elements.size}`);}};
  const slides=[{name:'6000 x 4000',width:6000,height:4000,url:'generated-0',type:'SDR'},{name:'9000 x 6000',width:9000,height:6000,url:'generated-1',type:'SDR'},{name:'4000 x 6000',width:4000,height:6000,url:'generated-2',type:'SDR'}];
  Object.assign(globalThis,{document,devicePixelRatio:2,GPUTextureUsage:{TEXTURE_BINDING:1,COPY_DST:2},matchMedia:()=>({matches:false,addEventListener(){}}),requestAnimationFrame(fn){const id=++nextFrame;rafs.set(id,fn);return id;},cancelAnimationFrame(id){rafs.delete(id);},Image:class{set src(url){const slide=slides.find(slide=>slide.url===url);this.naturalWidth=slide.width;this.naturalHeight=slide.height;queueMicrotask(()=>this.onload());}decode(){return Promise.resolve();}},createImageBitmap:async c=>({width:c.width,height:c.height,close(){}})});
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
  const room=element('room'),screen=element('screen');element('photoY').value='-3';element('depth').value='4';element('focus').value='0';
  env={$:element,room,screen,native:element('native'),renderer:photo,scene,wall,air,machineLight,decodeImage:options.decodeImage||decodeImage,state:{slides,index:0,on:true,auto:false,busy:false,importing:false,demo:false,immersive:false,epoch:0,native:false,nativeHDR:false,displayMode:'auto',started:true,ready:true,aperture:false},cache:new Map(),hdrQuery:{matches:false},reduceMotion:{matches:false},exposure:1,transporting:false,layoutPending:false,projectionWidth:528,autoTimer:null,transitionFrame:null,finishTransition:null,toastTimer:null,hideTimer:null,powerIcon:'',audio:{advance(){},stopAdvance(){},stopFan(){}},mountProjection(){},showImmersiveControls(){},delay:async()=>{},setTimeout:()=>0,clearTimeout(){},...timing};
  const functions=text.slice(text.indexOf('function toast('),text.indexOf('async function importFiles('));
  const api=new Function('env',`with(env){${functions}\nreturn{goTo,fitScreen,present,resetTransition,preparePresentation:typeof preparePresentation==='function'?preparePresentation:null};}`)(env);
  const width=1200,height=800,data=new Float32Array(width*height*4);data.fill(.25);for(let i=3;i<data.length;i+=4)data[i]=1;
  const loaded={source:{data,width,height,hdr:false,colorSpace:'srgb'},native:false};env.cache.set(slides[0],loaded);
  api.fitScreen();if(api.preparePresentation)api.present(slides[0],loaded,await api.preparePresentation(slides[0],loaded));else{await photo.prepare(loaded.source);api.present(slides[0],loaded);}
  const initialUploads=metrics.textureUploads,initialBytes=metrics.textureBytes;
  async function goTo(index,control={}){
    let done=false;const work=api.goTo(index).finally(()=>{done=true;});const start=metrics.frames.length;
    let firstFrame,interrupted=false,changedLayout=false;
    for(let step=0;!done&&step<10000;step++){
      if(rafs.size){clock.now+=1000/60;const callbacks=[...rafs.entries()];for(const [id,fn]of callbacks){
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
    if(!interrupted)assertIndex(index);return metrics.frames.slice(start);
  }
  function assertIndex(index){if(env.state.index!==index||metrics.errors.length)throw new Error(`Transport failed: ${metrics.errors.join('; ')}`);}
  return{env,metrics,goTo,summary(){return{frames:metrics.frames.length,maxSceneRendersPerFrame:Math.max(0,...metrics.frames.map(frame=>frame.sceneRenders)),maxProjectionRendersPerFrame:Math.max(0,...metrics.frames.map(frame=>frame.projectionRenders)),textureUploads:metrics.textureUploads-initialUploads,textureBytes:metrics.textureBytes-initialBytes,uploadsDuringTransport:metrics.uploadsDuringTransport,canvasCreatesDuringTransport:metrics.canvasCreatesDuringTransport,readbacksDuringTransport:metrics.readbacksDuringTransport,layoutReadsDuringTransport:metrics.layoutReadsDuringTransport,configurationsDuringTransport:metrics.configurationsDuringTransport,sceneResizesDuringTransport:metrics.sceneResizesDuringTransport,machineResizesDuringTransport:metrics.machineResizesDuringTransport};},async close(){while(photo.preparingProjection)await new Promise(resolve=>setImmediate(resolve));rafs.clear();for(const [name,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}};
}
