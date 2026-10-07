// Pure export timing. All times are absolute, in milliseconds.
export function exportDimensions(resolution='1080',orientation='landscape'){
  if(!['1080','2160'].includes(String(resolution))||!['landscape','portrait'].includes(orientation))throw new Error('Invalid export dimensions');
  const short=Number(resolution),long=short*16/9;
  return orientation==='portrait'?{width:short,height:long}:{width:long,height:short};
}
export function exportTimeline(count,hold=4000,{warmup=550,white=5000,opening=1850,change=1500}={}){
  if(!Number.isInteger(count)||count<1||!Number.isFinite(hold)||hold<2000||hold>30000)throw new Error('Invalid slideshow');
  const segments=[{kind:'warmup',start:0,end:warmup,index:0},{kind:'white',start:warmup,end:warmup+white,index:0},{kind:'opening',start:warmup+white,end:warmup+white+opening,index:0}];
  let time=warmup+white+opening;
  for(let index=0;index<count;index++){
    segments.push({kind:'hold',start:time,end:time+hold,index});time+=hold;
    if(index<count-1){segments.push({kind:'change',start:time,end:time+change,index:index+1});time+=change;}
  }
  return{segments,duration:time,sounds:segments.filter(s=>s.kind==='opening'||s.kind==='change').map(s=>({start:s.start,opening:s.kind==='opening'}))};
}
export function timelineAt(timeline,time){
  const t=Math.max(0,Math.min(time,timeline.duration-1e-6)),segment=timeline.segments.find(s=>t<s.end);
  return{...segment,local:t-segment.start};
}
export function shutterSamples(frame,fps,duration,count=8){
  if(![30,60].includes(fps)||!Number.isInteger(count)||count<1)throw new Error('Invalid shutter');
  const center=(frame+.5)*1000/fps,exposure=500/fps;
  return Array.from({length:count},(_,i)=>Math.min(duration-1e-6,Math.max(0,center+((i+.5)/count-.5)*exposure)));
}
export function encoderBitrate(height,fps,mbps='auto'){
  if(mbps==='auto'||mbps==null)return (height>=2160?72_000_000:24_000_000)*(fps===60?1.5:1);
  const value=Number(mbps);if(!Number.isFinite(value)||value<2||value>200)throw new Error('码率须在 2–200 Mbps 之间');
  return Math.round(value*1_000_000);
}
// Generate small audio chunks instead of allocating the entire soundtrack.
export function mixAudioChunk(buffers,timeline,settings,start,length,sampleRate=48000){
  const pcm=new Float32Array(length*2),events=timeline.sounds;
  const sample=(buffer,time,channel)=>{
    if(!buffer||time<0)return 0;const p=time*buffer.sampleRate,i=Math.floor(p),f=p-i;if(i>=buffer.length)return 0;
    const data=buffer.getChannelData(Math.min(channel,buffer.numberOfChannels-1));return data[i]*(1-f)+(data[Math.min(i+1,data.length-1)]||0)*f;
  };
  if(!settings.enabled)return pcm;
  const active=events.filter(e=>e.start/1000<start+length/sampleRate&&e.start/1000+(buffers[e.opening?'advance-startup':'advance']?.duration||0)>start);
  for(let i=0;i<length;i++){
    const time=start+i/sampleRate,fan=buffers.fan;
    for(let channel=0;channel<2;channel++){
      let value=(fan?sample(fan,time%fan.duration,channel)*settings.fanVolume*.55*Math.min(1,time/1.5):0)+sample(buffers.click,time,channel)*settings.volume;
      for(const event of active)value+=sample(buffers[event.opening?'advance-startup':'advance'],time-event.start/1000,channel)*settings.volume*(event.opening?.785:.767);
      pcm[i*2+channel]=Math.max(-1,Math.min(1,value));
    }
  }
  return pcm;
}
