// Work around reported corruption in Android's accelerated float16 Canvas 2D
// presentation/bitmap path. CPU readback and API presence cannot qualify the
// compositor. Keep visible lighting on its previously working 8-bit path and
// retain floating precision in CPU-backed caches. Photo/native HDR is separate.
export function androidCanvasWorkaround(nav=globalThis.navigator){
  return nav?.userAgentData?.platform==='Android'||/\bAndroid\b/i.test(nav?.userAgent||'');
}
export function lightCanvasOptions({presentation=false,...options}={}){
  if(!androidCanvasWorkaround())return {colorType:'float16',...options};
  return presentation?{colorType:'unorm8',...options}:{colorType:'float16',...options,willReadFrequently:true};
}
export function lightContext(canvas,options){return canvas.getContext('2d',lightCanvasOptions(options));}
