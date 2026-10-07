import { Output,Mp4OutputFormat,StreamTarget,VideoSampleSource,AudioSampleSource,VideoSample,AudioSample } from 'mediabunny';
import { exportDimensions,exportTimeline,encoderBitrate,mixAudioChunk } from './export-model.js';
import { ExportRenderer } from './export-renderer.js';

// Yield without the nested setTimeout minimum delay. Still allow cancellation,
// progress paints and native encoder/file-writer backpressure.
const yieldUI=()=>globalThis.scheduler?.yield?.()??new Promise(resolve=>setTimeout(resolve,0));
const checkAbort=signal=>{if(signal.aborted)throw new DOMException('Canceled','AbortError');};
export async function encoderConfig(width,height,fps,sound=true,mbps='auto'){
  if(!globalThis.VideoEncoder||!globalThis.VideoFrame||!globalThis.AudioEncoder&&sound)throw new Error('此浏览器不支持视频导出，请使用新版 Chrome 或 Edge');
  const bitrate=encoderBitrate(Math.min(width,height),fps,mbps);
  // High profile, levels 4.2 / 5.1 / 5.2. The exact size and rate are probed.
  const levels=Math.max(width,height)>1920||bitrate>62_500_000?['34','33']:['2a','29'];
  for(const level of levels)for(const acceleration of ['prefer-hardware','no-preference']){
    const config={codec:`avc1.6400${level}`,width,height,framerate:fps,bitrate,bitrateMode:'variable',hardwareAcceleration:acceleration,latencyMode:'quality',avc:{format:'avc'}};
    let supported=false;try{supported=(await VideoEncoder.isConfigSupported(config)).supported;}catch{}
    if(supported){
      if(sound&&!(await AudioEncoder.isConfigSupported({codec:'mp4a.40.2',sampleRate:48000,numberOfChannels:2,bitrate:128000})).supported)throw new Error('此浏览器不支持 AAC 声音导出');
      return config;
    }
  }
  throw new Error('此设备不支持所选导出设置，请尝试降低码率、分辨率或帧率');
}

async function soundtrack(host,snapshot,signal){
  const context=new OfflineAudioContext(2,3840,48000),buffers={};
  for(const name of ['fan','advance','advance-startup']){checkAbort(signal);buffers[name]=await context.decodeAudioData((await host.loadAudio(name)).slice(0));}
  // Use the viewer's actual switch-click oscillator and envelope.
  const osc=context.createOscillator(),gain=context.createGain();osc.type='triangle';osc.frequency.setValueAtTime(180,0);osc.frequency.exponentialRampToValueAtTime(48,.05);gain.gain.setValueAtTime(.04,0);gain.gain.exponentialRampToValueAtTime(.001,.07);osc.connect(gain);gain.connect(context.destination);osc.start();osc.stop(.08);buffers.click=await context.startRendering();
  return buffers;
}

export async function exportMovie(host,snapshot,options,{signal,onProgress=()=>{},onMetrics=()=>{}}){
  const {width,height}=exportDimensions(options.resolution,options.orientation),fps=Number(options.fps);
  if(![30,60].includes(fps))throw new Error('Invalid frame rate');
  const config=await encoderConfig(width,height,fps,options.sound,options.bitrate),timeline=exportTimeline(snapshot.slides.length,snapshot.settings.interval*1000),frames=Math.ceil(timeline.duration*fps/1000);
  let renderer,output,fileStream,wakeLock;const chunks=[],memoryLimit=512*1024*1024;
  const metrics={prepare:0,render:0,capture:0,encode:0,audio:0,finalize:0},started=performance.now();let tick=started,lastYield=started,lastProgress=started;
  try{
    checkAbort(signal);
    try{wakeLock=await navigator.wakeLock?.request('screen');}catch{}
    let target;
    if(options.fileHandle){
      fileStream=await options.fileHandle.createWritable();target=new StreamTarget(new WritableStream({async write(chunk){await fileStream.write(chunk);}}));
    }else{
      // Fragmented MP4 avoids retaining every encoded packet until finalization.
      let bytes=0;target=new StreamTarget(new WritableStream({write(chunk){if(chunk.type!=='write')return;if(chunk.position!==bytes)throw new Error('Unexpected MP4 write');bytes+=chunk.data.byteLength;if(bytes>memoryLimit)throw new Error('视频超过浏览器下载内存上限，请使用直接保存或缩短放映');chunks.push(chunk.data.slice());}}));
    }
    output=new Output({format:new Mp4OutputFormat({fastStart:'fragmented',minimumFragmentDuration:1}),target});
    const video=new VideoSampleSource({codec:'avc',fullCodecString:config.codec,bitrate:config.bitrate,bitrateMode:config.bitrateMode,frameRate:fps,hardwareAcceleration:config.hardwareAcceleration,latencyMode:'quality'});
    const audio=options.sound?new AudioSampleSource({codec:'aac',bitrate:128000}):null;
    output.addVideoTrack(video,{frameRate:fps});if(audio)output.addAudioTrack(audio);
    onProgress({phase:'prepare',progress:0});
    const buffers=audio?await soundtrack(host,snapshot,signal):null;
    renderer=new ExportRenderer(host,snapshot,width,height,fps);await renderer.init();await renderer.prepareWhite();await renderer.prepareSlide(0);
    checkAbort(signal);await output.start();metrics.prepare+=performance.now()-tick;
    let audioCursor=0;const totalAudio=Math.round(frames/fps*48000);
    for(let i=0;i<frames;i++){
      checkAbort(signal);const center=(i+.5)*1000/fps;tick=performance.now();
      await renderer.prepareFrame(timeline,center);metrics.prepare+=performance.now()-tick;tick=performance.now();
      const presented=renderer.render(timeline,center);metrics.render+=performance.now()-tick;tick=performance.now();
      // Native canvas -> VideoFrame lets the browser manage the GPU transfer
      // and color conversion. Avoid a synchronous RGBA readback every frame.
      const sample=new VideoSample(presented,{timestamp:i/fps,duration:1/fps});
      metrics.capture+=performance.now()-tick;tick=performance.now();
      try{await video.add(sample,{keyFrame:i%fps===0});}finally{sample.close();}
      metrics.encode+=performance.now()-tick;tick=performance.now();
      const until=Math.min(totalAudio,Math.round((i+1)/fps*48000));
      while(audio&&audioCursor<until){checkAbort(signal);const length=Math.min(1024,until-audioCursor),data=mixAudioChunk(buffers,timeline,{...snapshot.sound,enabled:true},audioCursor/48000,length),sample=new AudioSample({data,format:'f32',numberOfChannels:2,sampleRate:48000,timestamp:audioCursor/48000});try{await audio.add(sample);}finally{sample.close();}audioCursor+=length;}
      metrics.audio+=performance.now()-tick;const now=performance.now();
      if(now-lastProgress>=100||i===frames-1){onProgress({phase:'render',progress:(i+1)/frames,frame:i+1,frames});lastProgress=now;}
      if(now-lastYield>=24){await yieldUI();lastYield=performance.now();}
    }
    checkAbort(signal);onProgress({phase:'finalize',progress:1});tick=performance.now();await output.finalize();checkAbort(signal);metrics.finalize=performance.now()-tick;onMetrics({...metrics,total:performance.now()-started,frames,width,height,fps});
    if(fileStream){await fileStream.close();fileStream=null;return{saved:true,duration:frames/fps,width,height,fps,bitrate:config.bitrate};}
    return{blob:new Blob(chunks,{type:'video/mp4'}),duration:frames/fps,width,height,fps,bitrate:config.bitrate};
  }catch(error){if(output&&output.state!=='finalized')await output.cancel().catch(()=>{});if(fileStream)await fileStream.abort().catch(()=>{});throw error;}
  finally{renderer?.dispose();await wakeLock?.release().catch(()=>{});}
}

export function openVideoExport(host){
  const dialog=document.getElementById('exportDialog'),status=document.getElementById('exportStatus'),progress=document.getElementById('exportProgress'),form=document.getElementById('exportForm'),start=document.getElementById('exportStart'),cancel=document.getElementById('exportCancel'),close=document.getElementById('exportClose'),download=document.getElementById('exportDownload');
  const t=host.t;let controller=null,downloadURL=null;
  const updateBitrate=()=>{
    const custom=form.elements.bitrate.value==='custom';document.getElementById('exportCustomBitrate').hidden=!custom;form.elements.customBitrate.required=custom;form.elements.customBitrate.disabled=!custom||dialog.dataset.running==='true';
    const target=custom?form.elements.customBitrate.value:form.elements.bitrate.value;
    try{document.getElementById('exportBitrateHint').textContent=t('目标码率 {mbps} Mbps；实际码率随画面复杂度变化。',{mbps:encoderBitrate(Number(form.elements.resolution.value),Number(form.elements.fps.value),target)/1_000_000});}catch{document.getElementById('exportBitrateHint').textContent=t('码率须在 2–200 Mbps 之间');}
  };
  form.onchange=updateBitrate;form.elements.customBitrate.oninput=updateBitrate;updateBitrate();
  const message=key=>{status.textContent=t(key);};
  const cleanupDownload=()=>{if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=null;download.hidden=true;download.removeAttribute('href');};
  const running=value=>{for(const el of form.querySelectorAll('select,input'))el.disabled=value;start.disabled=value;close.disabled=value;cancel.hidden=!value;dialog.dataset.running=String(value);if(!value)updateBitrate();};
  dialog.oncancel=e=>{if(controller){e.preventDefault();controller.abort();}};
  close.onclick=()=>dialog.close();cancel.onclick=()=>controller?.abort();
  form.onsubmit=async e=>{
    e.preventDefault();if(controller)return;
    const options={resolution:form.elements.resolution.value,orientation:form.elements.orientation.value,fps:Number(form.elements.fps.value),sound:form.elements.sound.checked,bitrate:form.elements.bitrate.value==='custom'?form.elements.customBitrate.value:form.elements.bitrate.value};
    let paused=false;controller=new AbortController();const signal=controller.signal;running(true);cleanupDownload();progress.value=0;message('正在检查导出能力…');
    try{
      // Call the picker in the submit gesture, before awaiting codec checks.
      if(window.showSaveFilePicker)try{options.fileHandle=await window.showSaveFilePicker({suggestedName:`slide-ritual-${options.orientation}-${options.resolution}p-${options.fps}fps.mp4`,types:[{description:'MP4 video',accept:{'video/mp4':['.mp4']}}]});}catch(error){if(error.name==='AbortError')throw error;}
      const snapshot=host.snapshot();if(!snapshot.slides.length)throw new Error('请先装入照片');
      const {width,height}=exportDimensions(options.resolution,options.orientation);await encoderConfig(width,height,options.fps,options.sound,options.bitrate);checkAbort(signal);
      await host.pause(signal);paused=true;
      const result=await exportMovie(host,snapshot,options,{signal,onProgress(info){progress.value=info.progress;status.textContent=info.phase==='prepare'?t('正在准备画面与声音…'):info.phase==='finalize'?t('正在完成视频…'):t('正在导出 {percent}% · {frame}/{frames} 帧',{percent:Math.floor(info.progress*100),frame:info.frame,frames:info.frames});}});
      if(result.blob){downloadURL=URL.createObjectURL(result.blob);download.href=downloadURL;download.download=`slide-ritual-${options.orientation}-${options.resolution}p-${options.fps}fps.mp4`;download.hidden=false;}
      message(result.saved?'视频已保存，放映已恢复':'视频已完成，点击下载；放映已恢复');progress.value=1;
    }catch(error){message(error.name==='AbortError'?'已取消导出，放映已恢复':error.message);}
    finally{try{if(paused)await host.resume();}finally{controller=null;running(false);}}
  };
  // Free large Blob URLs when the user leaves the export dialog.
  dialog.onclose=cleanupDownload;cleanupDownload();running(false);message('导出完整暗室画面与声音。导出期间暂停放映，结束后恢复。');form.elements.sound.checked=host.snapshot().sound.enabled;dialog.showModal();
}
