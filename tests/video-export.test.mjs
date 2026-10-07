import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';
import { exportDimensions,exportTimeline,timelineAt,shutterSamples,mixAudioChunk,encoderBitrate } from '../export-model.js';
test('export bitrate selection preserves the requested target across dimensions and rates',()=>{
  assert.equal(encoderBitrate(1080,30),24_000_000);assert.equal(encoderBitrate(1080,60),36_000_000);
  assert.equal(encoderBitrate(2160,30),72_000_000);assert.equal(encoderBitrate(2160,60),108_000_000);
  for(const size of [1080,2160])for(const fps of [30,60])assert.equal(encoderBitrate(size,fps,'50'),50_000_000);
  assert.equal(encoderBitrate(1080,30,'2'),2_000_000);
  for(const invalid of [0,1.9,201,Infinity,NaN,'custom',''])assert.throws(()=>encoderBitrate(1080,30,invalid));
});

test('export dimensions cover both orientations without upscaling a preview',()=>{
  assert.deepEqual(exportDimensions('1080','landscape'),{width:1920,height:1080});
  assert.deepEqual(exportDimensions('1080','portrait'),{width:1080,height:1920});
  assert.deepEqual(exportDimensions('2160','landscape'),{width:3840,height:2160});
  assert.deepEqual(exportDimensions('2160','portrait'),{width:2160,height:3840});
  assert.throws(()=>exportDimensions('720','landscape'));
});
test('one pass includes the white field, first insertion, every full hold, and no wraparound',()=>{
  const timeline=exportTimeline(3,4000);
  assert.equal(timeline.duration,22400);
  assert.deepEqual(timeline.segments.filter(s=>s.kind==='hold').map(s=>[s.index,s.end-s.start]),[[0,4000],[1,4000],[2,4000]]);
  assert.deepEqual(timeline.sounds,[{start:5550,opening:true},{start:11400,opening:false},{start:16900,opening:false}]);
  assert.equal(timelineAt(timeline,5550).kind,'opening');
  assert.equal(timelineAt(timeline,22400).index,2);
  assert.equal(timelineAt(timeline,22400).kind,'hold');
});
test('180 degree shutter samples are centered, normalized, and contained in the video',()=>{
  for(const fps of [30,60]){
    const times=shutterSamples(10,fps,1000,8),center=10.5*1000/fps;
    assert.ok(Math.abs(times.reduce((a,b)=>a+b,0)/times.length-center)<1e-10);
    assert.ok(Math.abs((times.at(-1)-times[0])-(500/fps)*7/8)<1e-10);
    assert.ok(shutterSamples(0,fps,1000).every(t=>t>=0));
  }
});
test('sound events match transport, fan gain ramps, and mute produces silence',()=>{
  const buffer={sampleRate:48000,length:48000,duration:1,numberOfChannels:1,getChannelData:()=>new Float32Array(48000).fill(.2)};
  const timeline=exportTimeline(1,4000),settings={enabled:true,volume:.55,fanVolume:.18};
  assert.equal(mixAudioChunk({fan:buffer},timeline,settings,0,1)[0],0);
  const before=mixAudioChunk({fan:buffer},timeline,settings,5.5,1)[0];
  const during=mixAudioChunk({fan:buffer,'advance-startup':buffer},timeline,settings,5.55,1)[0];
  assert.ok(Math.abs(before-.2*.18*.55)<1e-7);
  assert.ok(Math.abs(during-(before+.2*.55*.785))<1e-7);
  assert.deepEqual([...mixAudioChunk({fan:buffer},timeline,{...settings,enabled:false},5.5,10)],Array(20).fill(0));
});
test('sound mixing preserves stereo channels and includes the opening switch click',()=>{
  const buffer={sampleRate:48000,length:4800,duration:.1,numberOfChannels:2,getChannelData:channel=>new Float32Array(4800).fill(channel?.1:.2)};
  const pcm=mixAudioChunk({click:buffer},exportTimeline(1,2000),{enabled:true,volume:.5,fanVolume:0},.02,2);
  assert.ok(Math.abs(pcm[0]-.1)<1e-7);assert.ok(Math.abs(pcm[1]-.05)<1e-7);
  assert.equal(mixAudioChunk({click:buffer},exportTimeline(1,2000),{enabled:true,volume:.5,fanVolume:0},.2,1)[0],0);
});
test('normal startup has only an on-demand import, and the browser bundle meets its download budget',()=>{
  const app=readFileSync('app.js','utf8'),html=readFileSync('index.html','utf8'),gzip=gzipSync(readFileSync('video-export.js'));
  assert.match(app,/await import\('\.\/video-export\.js'\)/);
  assert.doesNotMatch(app,/^import .*video-export/m);
  assert.doesNotMatch(html,/(?:preload|modulepreload)[^>]*video-export/);
  assert.ok(gzip.length<=200000);
});
test('export pause and restoration keep the slide, preferences, and remaining hold',async()=>{
  const source=readFileSync('app.js','utf8'),start=source.indexOf('const videoExportHost={'),end=source.indexOf("$('exportBtn').addEventListener",start);
  let scheduled,cleared=0,resumed=0,suspended=0;
  const context={state:{on:true,auto:true,busy:false,index:2},autoTimer:7,autoDeadline:8000,exportResume:null,
    performance:{now:()=>5000},audio:{suspend:()=>suspended++,resume:async()=>resumed++},air:{frame:9,schedule(){}},document:{hidden:false},
    clearTimeout(){cleared++;},cancelAnimationFrame(){},updateUI(){},scheduleAuto(){context.autoTimer=10;},setTimeout(fn,ms){scheduled={fn,ms};return 11;},nextIndex(){return 3;},stopAuto(){},goTo(){},delay(){},DOMException,
    t:x=>x,THREE:null,ProjectorScene:null,WallLight:null,AirLight:null,MachineLight:null,ProjectionRenderer:null,processRadiancePixels:null,processImagePixels:null,projectionLayout:null,projectionOptics:null,transitionAt:null,startupAt:null};
  vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.host=videoExportHost;',context);
  await context.host.pause();assert.equal(context.state.auto,false);assert.equal(context.state.exporting,true);assert.equal(context.state.index,2);assert.equal(suspended,1);
  await context.host.resume();assert.equal(context.state.auto,true);assert.equal(context.state.exporting,false);assert.equal(context.state.index,2);assert.equal(resumed,1);assert.equal(scheduled.ms,3000);assert.ok(cleared>=2);
  context.state.auto=false;await context.host.pause();await context.host.resume();assert.equal(context.state.auto,false);
});
