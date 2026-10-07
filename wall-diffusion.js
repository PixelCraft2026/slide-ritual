import {lightContext} from './canvas-compat.js';
import {blurLightPixels} from './atmosphere.js';

// Image irradiance, integrated in linear light on a small grid. Two broad
// separable lobes model local diffuse return and the wider room bounce. Only
// photo/layout preparation uses this work; transport just moves the cache.
const wallEncode=v=>v<=.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-.055;
export function wallSamples(source,size=16){
  const data=new Float32Array(size*size*3),sum=[0,0,0];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const out=(y*size+x)*3;
    for(let j=0;j<4;j++)for(let i=0;i<4;i++){
      const sx=Math.min(source.width-1,Math.floor((x+(i+.5)/4)*source.width/size)),sy=Math.min(source.height-1,Math.floor((y+(j+.5)/4)*source.height/size)),at=(sy*source.width+sx)*4;
      let r=Math.max(0,source.data[at]),g=Math.max(0,source.data[at+1]),b=Math.max(0,source.data[at+2]);
      if(source.colorSpace==='display-p3'){const sr=1.22494018*r-.22494018*g,sg=-.04205695*r+1.04205695*g,sb=-.01963755*r-.07863605*g+1.09827360*b;r=Math.max(0,sr);g=Math.max(0,sg);b=Math.max(0,sb);}
      const gain=Math.max(0,Math.min(1,source.data[at+3]??1))/(1+Math.max(0,.2126*r+.7152*g+.0722*b-1));
      for(const [k,v]of [r,g,b].entries())data[out+k]+=Math.min(2,v*gain)/16;
    }
    for(let k=0;k<3;k++)sum[k]+=data[out+k];
  }
  return{size,data,color:sum.map(v=>wallEncode(v/(size*size)))};
}
export function wallField(sample,layout,maxSize=480){
  const scale=Math.min(.5,800/layout.w,600/layout.h),vw=Math.ceil(layout.w*scale),vh=Math.ceil(layout.h*scale),ratio=Math.min(1,maxSize/Math.max(vw*3,vh*3));
  const width=Math.max(1,Math.ceil(vw*3*ratio)),height=Math.max(1,Math.ceil(vh*3*ratio)),sx=layout.sw*scale*ratio,sy=layout.sh*scale*ratio,cx=vw*1.5*ratio,cy=(vh+layout.centerY*scale)*ratio;
  const n=sample.size,result=new Float32Array(width*height*3);
  for(const [radius,weight]of [[.38,.58],[.95,.42]]){
    const sigmaX=Math.max(2,sx*radius),sigmaY=Math.max(2,sy*radius),kx=new Float32Array(width*n),ky=new Float32Array(height*n),rows=new Float32Array(width*n*3);
    for(let x=0;x<width;x++)for(let i=0;i<n;i++){const d=(x+.5-cx-sx*((i+.5)/n-.5))/sigmaX;kx[x*n+i]=Math.exp(-.5*d*d)*sx/n/(Math.sqrt(2*Math.PI)*sigmaX);}
    for(let y=0;y<height;y++)for(let j=0;j<n;j++){const d=(y+.5-cy-sy*((j+.5)/n-.5))/sigmaY;ky[y*n+j]=Math.exp(-.5*d*d)*sy/n/(Math.sqrt(2*Math.PI)*sigmaY);}
    for(let j=0;j<n;j++)for(let x=0;x<width;x++){
      let r=0,g=0,b=0;for(let i=0;i<n;i++){const at=(j*n+i)*3,v=kx[x*n+i];r+=sample.data[at]*v;g+=sample.data[at+1]*v;b+=sample.data[at+2]*v;}
      const at=(j*width+x)*3;rows[at]=r;rows[at+1]=g;rows[at+2]=b;
    }
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      let r=0,g=0,b=0;for(let j=0;j<n;j++){const at=(j*width+x)*3,v=ky[y*n+j]*weight;r+=rows[at]*v;g+=rows[at+1]*v;b+=rows[at+2]*v;}
      const at=(y*width+x)*3;result[at]+=r;result[at+1]+=g;result[at+2]+=b;
    }
  }
  return{width,height,data:result};
}
export function wallPixels(field,float=false){
  const data=float?new Float16Array(field.width*field.height*4):new Uint8ClampedArray(field.width*field.height*4);
  for(let i=0;i<field.width*field.height;i++){
    const r=wallEncode(field.data[i*3]*.14),g=wallEncode(field.data[i*3+1]*.14),b=wallEncode(field.data[i*3+2]*.14),alpha=Math.max(r,g,b),unit=float?1:255;
    // Store the faint return as premultiplied encoded light. Float alpha avoids
    // the old byte-alpha rings and hue jumps when the light becomes very dim.
    const noise=float?0:((Math.imul(i%field.width,1597)+Math.imul(Math.floor(i/field.width),5171))&255)/255-.5;
    data[i*4]=alpha>0?r/alpha*unit:0;data[i*4+1]=alpha>0?g/alpha*unit:0;data[i*4+2]=alpha>0?b/alpha*unit:0;
    data[i*4+3]=float?alpha:Math.max(0,alpha*255+noise*Math.min(1,alpha*255));
  }
  return data;
}

// Android compatibility: the pre-diffusion-update 48px sample and three blurred
// image lobes. Use its bounded CPU fallback at preparation time, so neither a
// float Canvas nor a GPU Canvas filter participates in the wall-light cache.
export function legacyWallSamples(source){
  const canvas=document.createElement('canvas');canvas.width=canvas.height=48;
  const ctx=lightContext(canvas),image=ctx.createImageData(48,48),sum=[0,0,0];
  for(let y=0;y<48;y++)for(let x=0;x<48;x++){
    const sx=Math.min(source.width-1,Math.floor((x+.5)/48*source.width)),sy=Math.min(source.height-1,Math.floor((y+.5)/48*source.height)),at=(sy*source.width+sx)*4,out=(y*48+x)*4;
    for(let k=0;k<3;k++){const linear=Math.max(0,source.data[at+k]),v=Math.pow(Math.min(linear,2)/(1+Math.max(0,linear-1)),1/2.2);image.data[out+k]=v*255;sum[k]+=v;}
    image.data[out+3]=255;
  }
  ctx.putImageData(image,0,0);return{source:canvas,color:sum.map(v=>v/2304)};
}
export function legacyWallBuffer(source,layout){
  const scale=Math.min(.5,800/layout.w,600/layout.h),w=Math.ceil(layout.w*scale),h=Math.ceil(layout.h*scale),resolution=Math.min(1,512/Math.max(w*3,h*3));
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(w*3*resolution);canvas.height=Math.ceil(h*3*resolution);const ctx=lightContext(canvas);
  const sw=layout.sw*scale*resolution,sh=layout.sh*scale*resolution,cx=w*1.5*resolution,cy=(h+layout.centerY*scale)*resolution;
  for(const [size,blur,opacity]of [[2.4,sw*.28,.28],[1.45,sw*.10,.22],[1.03,sw*.028,.18]]){
    const layer=document.createElement('canvas');layer.width=canvas.width;layer.height=canvas.height;const lc=lightContext(layer);
    lc.drawImage(source,cx-sw*size/2,cy-sh*size/2,sw*size,sh*size);const pixels=lc.getImageData(0,0,layer.width,layer.height);
    blurLightPixels(pixels.data,layer.width,layer.height,Math.max(4*resolution,blur));lc.putImageData(pixels,0,0);
    ctx.globalAlpha=opacity;ctx.drawImage(layer,0,0);
  }
  ctx.globalAlpha=1;return canvas;
}
