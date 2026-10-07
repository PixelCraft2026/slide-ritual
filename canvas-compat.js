// Work around reported corruption in Android's accelerated float16 Canvas 2D
// presentation/bitmap path. CPU readback and API presence cannot qualify the
// compositor. Keep visible lighting on its previously working 8-bit path and
// retain floating precision in CPU-backed caches. Photo/native HDR is separate.
export function androidCanvasWorkaround(nav=globalThis.navigator){
  return nav?.userAgentData?.platform==='Android'||/\bAndroid\b/i.test(nav?.userAgent||'');
}
export function lightCanvasOptions({presentation=false,software=false,...options}={}){
  if(!androidCanvasWorkaround())return {colorType:'float16',...options};
  // Live SDR lights also rasterize on the CPU: even an 8-bit GPU target can
  // trigger a floating shared-image import when drawing the wall/beam cache.
  // Export byte layers retain acceleration; their inputs are already SDR.
  return presentation?{colorType:'unorm8',...options,...(software?{willReadFrequently:true}:{})}:{colorType:'float16',...options,willReadFrequently:true};
}
export function lightContext(canvas,options){return canvas.getContext('2d',lightCanvasOptions(options));}

// Fullscreen can reallocate Android's compositor surface. Keep all custom GPU
// presentation on a standard native format, even on HDR-capable devices. This
// controls presentation only: floating textures/linear-light filtering remain.
export function canvasPresentation(gpu=globalThis.navigator?.gpu,nav=globalThis.navigator){
  if(androidCanvasWorkaround(nav))return {format:gpu?.getPreferredCanvasFormat?.()==='bgra8unorm'?'bgra8unorm':'rgba8unorm',colorSpace:'srgb',floating:false};
  return {format:'rgba16float',colorSpace:'display-p3',floating:true};
}
