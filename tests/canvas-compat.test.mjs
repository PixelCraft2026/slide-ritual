import test from 'node:test';
import assert from 'node:assert/strict';
import {androidCanvasWorkaround,lightCanvasOptions} from '../canvas-compat.js';
import {WallLight} from '../scene.js';
import {AirLight,snapshotLight} from '../atmosphere.js';

function android(run){
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mozilla/5.0 (Linux; Android 16; Xiaomi 15) AppleWebKit/537.36 Chrome/154.0.0.0 Mobile Safari/537.36'}});
  try{return run();}finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;}
}

test('Android Chrome, Edge and desktop-mode UA-CH select the light workaround; Windows and iPad retain precision',()=>{
  for(const userAgent of ['Android 16; Xiaomi 15 Chrome/154','Android 16; Xiaomi 15 EdgA/154'])assert.equal(androidCanvasWorkaround({userAgent}),true);
  assert.equal(androidCanvasWorkaround({userAgent:'Linux x86_64 Chrome/154',userAgentData:{platform:'Android'}}),true);
  for(const userAgent of ['Windows NT 10.0 Chrome/154','iPad; CPU OS 26_0 AppleWebKit/605.1.15','Macintosh; Intel Mac OS X AppleWebKit/605.1.15'])assert.equal(androidCanvasWorkaround({userAgent}),false);
});

test('all Android lighting canvases use byte storage, with CPU caches',()=>android(()=>{
  assert.equal(lightCanvasOptions({presentation:true}).colorType,'unorm8');
  assert.deepEqual(lightCanvasOptions(),{colorType:'unorm8',willReadFrequently:true});
}));

test('actual WallLight and AirLight constructors distinguish viewer from detached export',()=>android(()=>{
  const original=globalThis.matchMedia,originalDocument=globalThis.document;globalThis.document={addEventListener(){}};globalThis.matchMedia=()=>({addEventListener(){}});
  const canvas=()=>({getContext(type,options){this.options=options;return{};}});
  try{
    const viewer=canvas(),exported=canvas();new WallLight(viewer);new WallLight(exported,{presentation:false});
    assert.equal(viewer.options.colorType,'unorm8');assert.equal(viewer.options.willReadFrequently,true);assert.equal(exported.options.colorType,'unorm8');assert.equal(exported.options.willReadFrequently,true);
    const air=canvas();new AirLight(air,{manual:true});assert.equal(air.options.colorType,'unorm8');assert.equal(air.options.willReadFrequently,true);
    const liveAir=canvas(),live=new AirLight(liveAir);assert.equal(live.maxScale,.5);assert.equal(liveAir.options.colorType,'unorm8');assert.equal(liveAir.options.willReadFrequently,true);
    const exportAir=canvas(),exportedAir=new AirLight(exportAir,{manual:true,presentation:true});assert.equal(exportedAir.maxScale,1.25);assert.equal(exportAir.options.colorType,'unorm8');assert.equal(exportAir.options.willReadFrequently,undefined);
  }finally{globalThis.matchMedia=original;if(originalDocument)globalThis.document=originalDocument;else delete globalThis.document;}
}));

test('Android cache warming bypasses floating ImageBitmap creation',async()=>{
  const originals=new Map(['navigator','document','createImageBitmap'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  let snapshots=0,reads=0;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgentData:{platform:'Android'}}});
  globalThis.createImageBitmap=async()=>{snapshots++;return{};};
  globalThis.document={createElement:()=>({getContext:()=>({drawImage(){},getImageData(){reads++;}})})};
  try{const source={};assert.equal(await snapshotLight(source),source);assert.equal(snapshots,0);assert.equal(reads,1);}
  finally{for(const [key,value]of originals){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
});

test('software light routing is Android-only and leaves desktop context options intact',()=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  try{
    for(const userAgent of ['Windows NT 10.0','iPad; CPU OS 26_0','Macintosh; Intel Mac OS X']){
      Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent}});
      assert.deepEqual(lightCanvasOptions({presentation:true,software:true}),{colorType:'float16'});
    }
  }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;}
});
