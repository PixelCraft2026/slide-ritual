export class ProjectorAudio {
  constructor(){this.volume=.55;this.fanVolume=.18;this.enabled=true;this.buffers={};this.active=new Set();}
  async unlock(){
    if(!this.context){
      const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;
      this.context=new AudioCtx();this.master=this.context.createGain();this.master.gain.value=this.enabled?this.volume:0;this.master.connect(this.context.destination);
      this.fanMaster=this.context.createGain();this.fanMaster.gain.value=this.enabled?1:0;this.fanMaster.connect(this.context.destination);
      this.loading=Promise.all(['advance','fan'].map(async name=>{try{const response=await fetch(`assets/${name}.wav`);if(!response.ok)throw new Error('Audio file missing');this.buffers[name]=await this.context.decodeAudioData(await response.arrayBuffer());}catch(error){console.info('Reference audio fallback:',error.message);}}));
    }
    await this.context.resume();await this.loading;
  }
  fadeGain(param,target,duration=.08){const t=this.context.currentTime;param.cancelScheduledValues(t);param.setValueAtTime(param.value,t);param.linearRampToValueAtTime(target,t+duration);}
  setVolume(volume){this.volume=volume;if(this.master)this.fadeGain(this.master.gain,this.enabled?volume:0);}
  setFanVolume(volume){this.fanVolume=Math.max(0,Math.min(1,volume));if(this.fan){this.fanGain.gain.cancelScheduledValues(this.context.currentTime);this.fanGain.gain.setTargetAtTime(this.fanVolume*.55,this.context.currentTime,.12);}}
  setEnabled(enabled){this.enabled=enabled;this.setVolume(this.volume);if(this.fanMaster)this.fadeGain(this.fanMaster.gain,enabled?1:0);}
  startFan(){
    if(!this.context||this.fan)return;
    const ctx=this.context;this.fanGain=ctx.createGain();this.fanGain.gain.setValueAtTime(0,ctx.currentTime);this.fanGain.gain.linearRampToValueAtTime(this.fanVolume*.55,ctx.currentTime+1.5);this.fanGain.connect(this.fanMaster);
    this.fan=ctx.createBufferSource();this.fan.buffer=this.buffers.fan||this.noiseFallback();this.fan.loop=true;
    this.fan.connect(this.fanGain);this.fan.start();
  }
  stopFan(){
    if(!this.fan)return;
    const fan=this.fan,gain=this.fanGain;this.fan=null;
    gain.gain.cancelScheduledValues(this.context.currentTime);gain.gain.setTargetAtTime(0,this.context.currentTime,.25);
    fan.stop(this.context.currentTime+1.5);fan.onended=()=>{fan.disconnect();gain.disconnect();};
  }
  click(){if(!this.context)return;const ctx=this.context;const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='triangle';osc.frequency.setValueAtTime(180,ctx.currentTime);osc.frequency.exponentialRampToValueAtTime(48,ctx.currentTime+.05);gain.gain.setValueAtTime(.04,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.07);osc.connect(gain);gain.connect(this.master);osc.start();osc.stop(ctx.currentTime+.08);osc.onended=()=>{osc.disconnect();gain.disconnect();};}
  noiseFallback(){
    const buffer=this.context.createBuffer(1,this.context.sampleRate*8,this.context.sampleRate),data=buffer.getChannelData(0);let seed=9137,low=0;
    for(let i=0;i<data.length;i++){seed=(1664525*seed+1013904223)>>>0;low+=.14*((seed/4294967296*2-1)-low);data[i]=low*.25;}
    const fade=Math.floor(this.context.sampleRate*.12);for(let i=0;i<fade;i++){const t=i/fade;data[i]=data[i]*t+data[data.length-fade+i]*(1-t);}
    return buffer;
  }
  advance(reverse=false,duration=1.5){
    if(!this.context)return;
    if(!this.buffers.advance){this.click();return;}
    const src=this.context.createBufferSource();src.buffer=this.buffers.advance;src.playbackRate.value=src.buffer.duration/duration;
    const lowpass=this.context.createBiquadFilter();lowpass.type='lowpass';lowpass.frequency.value=2200;lowpass.Q.value=.55;
    const shelf=this.context.createBiquadFilter();shelf.type='highshelf';shelf.frequency.value=1300;shelf.gain.value=-5;
    const gain=this.context.createGain();gain.gain.value=.84;src.connect(lowpass);lowpass.connect(shelf);shelf.connect(gain);gain.connect(this.master);src.start();this.active.add(src);
    src.onended=()=>{this.active.delete(src);src.disconnect();lowpass.disconnect();shelf.disconnect();gain.disconnect();};
  }
  stopAdvance(){for(const src of this.active){try{src.stop();}catch{}}this.active.clear();}
  suspend(){if(this.context)this.context.suspend();}
  resume(){if(this.context)this.context.resume().catch(()=>{});}
}
