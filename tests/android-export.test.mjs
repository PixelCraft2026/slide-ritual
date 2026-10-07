import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadExportTexture,ExportFilter} from '../export-motion.js';
import {HoldCompositor} from '../export-compositor.js';
import {ExportRenderer} from '../export-renderer.js';
import {WallLight} from '../scene.js';
import {AirLight} from '../atmosphere.js';

function context(){
  const uploads=[],uniforms=[],shaders=[],stores=new Map();
  const names=['TEXTURE_2D','RGBA16F','RGBA','HALF_FLOAT','UNSIGNED_BYTE','UNPACK_FLIP_Y_WEBGL','UNPACK_COLORSPACE_CONVERSION_WEBGL','UNPACK_PREMULTIPLY_ALPHA_WEBGL','NONE','VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','TEXTURE_WRAP_S','TEXTURE_WRAP_T','CLAMP_TO_EDGE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','LINEAR','TEXTURE0','TEXTURE1'];
  const g=Object.fromEntries(names.map((n,i)=>[n,i+100]));Object.assign(g,{createShader:()=>({}),shaderSource(s,code){shaders.push(code);},compileShader(){},getShaderParameter:()=>true,createProgram:()=>({}),attachShader(){},linkProgram(){},deleteShader(){},getProgramParameter:()=>true,useProgram(){},createTexture:()=>({}),bindTexture(){},texParameteri(){},activeTexture(){},getUniformLocation:(p,n)=>n,uniform1i(n,v){uniforms.push([n,v]);},uniform1f(){},pixelStorei(n,v){stores.set(n,v);},texImage2D(...args){uploads.push({args,flipped:stores.get(g.UNPACK_FLIP_Y_WEBGL)});},isContextLost:()=>false,viewport(){},drawArrays(){}});
  return{g,uploads,uniforms,shaders};
}
function floating(){
  const data=new Float16Array([1,0,0,1,0,0,1,.25]);let reads=0;
  const canvas={width:1,height:2,getContext:()=>({getContextAttributes:()=>({colorType:'float16'}),getImageData(){reads++;return{data};}})};
  return{canvas,data,reads:()=>reads};
}
function byteCanvas(){return{width:64,height:32,getContext:()=>({getContextAttributes:()=>({colorType:'unorm8'}),getImageData(){assert.fail('SDR DOM layers must not require CPU readback');}})};}
function globals(values,run){
  const original=new Map(Object.keys(values).map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{configurable:true,value});
  try{return run();}finally{for(const[key,value]of original){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}}
}

test('Android floating wall cache crosses WebGL as raw half pixels with explicit row orientation',()=>{
  const {g,uploads}=context(),{canvas,data,reads}=floating();
  assert.equal(uploadExportTexture(g,canvas,{floating:true,standard:true}),true);
  const {args,flipped}=uploads[0];assert.equal(args.length,9);assert.equal(args[2],g.RGBA16F);assert.equal(args[3],1);assert.equal(args[4],2);assert.equal(args[7],g.HALF_FLOAT);
  assert.ok(args[8] instanceof Uint16Array);assert.equal(args[8].buffer,data.buffer);assert.equal(flipped,false);assert.equal(reads(),1);
});
test('ordinary Android SDR layers keep native byte texture uploads without readback',()=>{
  const {g,uploads}=context(),canvas=byteCanvas();assert.equal(uploadExportTexture(g,canvas,{floating:true,standard:true}),false);
  assert.equal(uploads[0].args.length,6);assert.equal(uploads[0].args[2],g.RGBA);assert.equal(uploads[0].args[4],g.UNSIGNED_BYTE);assert.equal(uploads[0].args[5],canvas);assert.equal(uploads[0].flipped,true);
});
test('Windows and Apple retain their original floating DOM upload path',()=>{
  const {g,uploads}=context(),{canvas,reads}=floating();assert.equal(uploadExportTexture(g,canvas,{floating:true,standard:false}),false);
  assert.equal(reads(),0);assert.equal(uploads[0].args.length,6);assert.equal(uploads[0].args[2],g.RGBA16F);assert.equal(uploads[0].args[4],g.HALF_FLOAT);assert.equal(uploads[0].args[5],canvas);
});
test('an older readback API falls back to typed byte rows without a floating DOM upload',()=>{
  const {g,uploads}=context();let requests=0;const canvas={width:1,height:1,getContext:()=>({getContextAttributes:()=>({colorType:'float16'}),getImageData(...args){requests++;if(args.length===5)throw new Error('Unsupported float read');return{data:new Uint8ClampedArray([1,2,3,4])};}})};
  assert.equal(uploadExportTexture(g,canvas,{floating:true,standard:true}),true);assert.equal(requests,2);assert.equal(uploads[0].args[7],g.UNSIGNED_BYTE);assert.ok(uploads[0].args[8] instanceof Uint8ClampedArray);
});
test('the actual Android compositor flips typed bottom rows and requests high-precision samplers',()=>{
  const {g,uniforms,shaders}=context();globals({navigator:{userAgent:'Android 16'},document:{createElement:()=>({getContext:()=>g})}},()=>{
    const c=new HoldCompositor(1920,1080,2);c.layer(floating().canvas);assert.ok(uniforms.some(([n,v])=>n==='bottomFlipped'&&v===true));
    c.render(byteCanvas());assert.ok(uniforms.some(([n,v])=>n==='imageFlipped'&&v===false));assert.ok(shaders.some(s=>s.includes('precision highp sampler2D;')));
  });
});
test('4K Android export bounds the CPU wall surface and keeps all full-sized staging layers SDR',()=>{
  for(const userAgent of ['Android 16; Xiaomi 15','Windows NT 10.0','iPad; CPU OS 26_0']){
    const {g}=context(),canvas=()=>({width:1,height:1,getContext(type,options={}){if(type==='webgl2')return g;this.options=options;return{getContextAttributes:()=>options,scale(){},createRadialGradient:()=>({addColorStop(){}}),fillRect(){}};}});
    const Scene=class{constructor(){this.renderer={setPixelRatio(){},setSize(){}};}setPitch(){}setTopReflectance(){}setEmitterAmount(){}};
    const Projection=class{constructor(){this.params={};}};
    const Machine=class{constructor(){this.renderer={params:{}};}};
    globals({navigator:{userAgent},document:{createElement:canvas},matchMedia:()=>({addEventListener(){}})},()=>{
      const r=new ExportRenderer({ProjectorScene:Scene,WallLight,AirLight,MachineLight:Machine,ProjectionRenderer:Projection},{settings:{depth:4,projectorY:-5,projectorPitch:0,topReflectance:.7,machineLights:1,diffusion:2,airAmount:1.4,brightness:1,focus:0,texture:.22}},3840,2160);
      if(userAgent.includes('Android')){
        assert.equal(r.ctx.getContextAttributes().colorType,'unorm8');assert.equal(r.air.ctx.getContextAttributes().colorType,'unorm8');assert.equal(r.wall.ctx.getContextAttributes().colorType,'float16');assert.equal(r.wall.ctx.getContextAttributes().willReadFrequently,true);
        assert.equal(r.environmentCanvas.width,960);assert.equal(r.environmentCanvas.height,540);assert.equal(r.environmentContext.getContextAttributes().willReadFrequently,true);
      }else{assert.equal(r.ctx.getContextAttributes().colorType,'float16');assert.equal(r.air.ctx.getContextAttributes().colorType,'float16');assert.equal(r.environmentCanvas,undefined);assert.equal(r.background.width,3840);}
    });
  }
});
