const audioSettled=(work,timeout)=>new Promise(resolve=>{
  const timer=setTimeout(()=>resolve(false),timeout);
  Promise.resolve(work).then(()=>{clearTimeout(timer);resolve(true);},()=>{clearTimeout(timer);resolve(false);});
});
export class ProjectorAudio {
  constructor(){this.volume=.55;this.fanVolume=.18;this.enabled=true;this.buffers={};this.files={};this.active=new Set();this.fanWanted=false;this.background=false;this.needsRecovery=false;this.lifecycle=0;this.resumeTimeout=600;this.probeDelay=80;}
  async loadFile(name){
    this.files[name]??=(async()=>{const response=await fetch(`assets/${name}.mp3`);if(!response.ok)throw new Error('Audio file missing');return response.arrayBuffer();})();
    try{return await this.files[name];}catch(error){delete this.files[name];throw error;}
  }
  preload(){return Promise.all(['advance','fan'].map(name=>this.loadFile(name).catch(()=>null)));}
  createContext(){
    const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return null;
    this.dropContext();
    try{
      const ctx=this.context=new AudioCtx();this.lifecycle++;this.needsRecovery=false;
      this.master=ctx.createGain();this.master.gain.value=this.enabled?this.volume:0;this.master.connect(ctx.destination);
      this.fanMaster=ctx.createGain();this.fanMaster.gain.value=this.enabled?1:0;this.fanMaster.connect(ctx.destination);
      this.fanLoading=!this.buffers.fan;
      this.loading=Promise.all(['advance','fan'].map(async name=>{
        try{
          if(!this.buffers[name])this.buffers[name]=await ctx.decodeAudioData((await this.loadFile(name)).slice(0));
        }catch(error){console.info('Reference audio fallback:',error.message);}
        finally{if(name==='fan'&&this.context===ctx){this.fanLoading=false;if(this.fanWanted)this.startFan();}}
      }));return ctx;
    }catch{this.needsRecovery=true;return null;}
  }
  async unlock({rebuild=false}={}){
    if((rebuild||!this.context)&&!this.createContext())return false;
    // resume is invoked synchronously in the gesture, before loading awaits.
    const ready=await this.resume({gesture:true});
    if(ready&&this.fanWanted)this.startFan();return ready;
  }
  dropContext(){
    const old=this.context;if(!old)return;
    this.stopAdvance();this.stopFanNode(true);this.master?.disconnect();this.fanMaster?.disconnect();
    this.context=null;this.master=null;this.fanMaster=null;this.recovery=null;
    try{old.close().catch(()=>{});}catch{/* Already closed. */}
  }
  fadeGain(param,target,duration=.08){const t=this.context.currentTime;param.cancelScheduledValues(t);param.setValueAtTime(param.value,t);param.linearRampToValueAtTime(target,t+duration);}
  setVolume(volume){this.volume=volume;if(this.master)this.fadeGain(this.master.gain,this.enabled?volume:0);}
  setFanVolume(volume){this.fanVolume=Math.max(0,Math.min(1,volume));if(this.fan){this.fanGain.gain.cancelScheduledValues(this.context.currentTime);this.fanGain.gain.setTargetAtTime(this.fanVolume*.55,this.context.currentTime,.12);}}
  setEnabled(enabled){this.enabled=enabled;this.setVolume(this.volume);if(this.fanMaster)this.fadeGain(this.fanMaster.gain,enabled?1:0);if(!enabled)this.stopFanNode(true);}
  startFan(){
    this.fanWanted=true;if(!this.context||this.fan||this.fanLoading||!this.enabled||this.background||this.context.state!=='running')return;
    const ctx=this.context;this.fanGain=ctx.createGain();this.fanGain.gain.setValueAtTime(0,ctx.currentTime);this.fanGain.gain.linearRampToValueAtTime(this.fanVolume*.55,ctx.currentTime+1.5);this.fanGain.connect(this.fanMaster);
    this.fan=ctx.createBufferSource();this.fan.buffer=this.buffers.fan||this.noiseFallback();this.fan.loop=true;
    this.fan.connect(this.fanGain);this.fan.start();
  }
  stopFan(){
    this.fanWanted=false;this.stopFanNode();
  }
  stopFanNode(immediate=false){
    if(!this.fan)return;
    const fan=this.fan,gain=this.fanGain;this.fan=null;this.fanGain=null;let cleaned=false;
    const clean=()=>{if(!cleaned){cleaned=true;fan.disconnect();gain.disconnect();}};fan.onended=clean;
    try{
      if(immediate){fan.stop();clean();}
      else{gain.gain.cancelScheduledValues(this.context.currentTime);gain.gain.setTargetAtTime(0,this.context.currentTime,.25);fan.stop(this.context.currentTime+1.5);}
    }catch{clean();}
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
    // Calibrated against the previous recording through this filter chain.
    const gain=this.context.createGain();gain.gain.value=2.37;src.connect(lowpass);lowpass.connect(shelf);shelf.connect(gain);gain.connect(this.master);src.start();this.active.add(src);
    src.onended=()=>{this.active.delete(src);src.disconnect();lowpass.disconnect();shelf.disconnect();gain.disconnect();};
  }
  stopAdvance(){for(const src of this.active){try{src.stop();}catch{}}this.active.clear();}
  suspend(){
    this.background=true;this.needsRecovery=Boolean(this.context);this.lifecycle++;this.recovery=null;
    // Retain intent, but retire old sources so sounds are not replayed later.
    this.stopAdvance();this.stopFanNode(true);
    if(this.context)try{this.context.suspend().catch(()=>{});}catch{/* System interruption. */}
  }
  async resume({gesture=false}={}){
    if(globalThis.document?.hidden)return false;this.background=false;
    if(!this.context||!this.enabled)return false;
    if(this.context.state==='closed'||(gesture&&(this.needsRecovery||this.context.state==='interrupted'))){
      if(!gesture){this.needsRecovery=true;return false;}
      // Rebuild in this gesture. A timed-out resume cannot consume the tap or
      // leave the sound switch permanently waiting for Safari's old promise.
      if(!this.createContext())return false;
    }
    const ctx=this.context,epoch=this.lifecycle;
    if(this.recovery?.context===ctx&&this.recovery.epoch===epoch)return this.recovery.pending;
    const pending=(async()=>{
      let resumed=false;try{resumed=await audioSettled(ctx.resume(),this.resumeTimeout);}catch{/* Rebuild on a later gesture. */}
      const clock=ctx.currentTime;
      if(resumed)await new Promise(resolve=>setTimeout(resolve,this.probeDelay));
      if(this.context!==ctx||this.lifecycle!==epoch||this.background)return false;
      // Safari can report running while its audio clock is frozen.
      const healthy=resumed&&ctx.state==='running'&&ctx.currentTime>clock;
      this.needsRecovery=!healthy;if(healthy&&this.enabled&&this.fanWanted)this.startFan();return healthy;
    })();
    this.recovery={context:ctx,epoch,pending};
    try{return await pending;}finally{if(this.recovery?.pending===pending)this.recovery=null;}
  }
}
