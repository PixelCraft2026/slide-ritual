// Integrate each destination pixel's full source footprint in linear light.
// Tiled input bounds decode memory without reducing the filter's support.
export class AreaResampler {
  constructor(sourceWidth,sourceHeight,width,height){
    if(![sourceWidth,sourceHeight,width,height].every(v=>Number.isInteger(v)&&v>0)||width>sourceWidth||height>sourceHeight)throw new Error('Invalid downsampling dimensions');
    this.sourceWidth=sourceWidth;this.sourceHeight=sourceHeight;this.width=width;this.height=height;
    this.scaleX=sourceWidth/width;this.scaleY=sourceHeight/height;this.data=new Float32Array(width*height*4);
  }
  addTile(data,left,top,width,height){
    if(![left,top,width,height].every(Number.isInteger)||left<0||top<0||width<1||height<1||left+width>this.sourceWidth||top+height>this.sourceHeight||data.length<width*height*4)throw new Error('Invalid resampling tile');
    if(this.width===this.sourceWidth&&this.height===this.sourceHeight){
      for(let y=0;y<height;y++)this.data.set(data.subarray(y*width*4,(y+1)*width*4),((top+y)*this.width+left)*4);
      return;
    }
    const xFirst=Math.floor(left/this.scaleX),xLast=Math.min(this.width,Math.ceil((left+width)/this.scaleX));
    const yFirst=Math.floor(top/this.scaleY),yLast=Math.min(this.height,Math.ceil((top+height)/this.scaleY));
    const normalization=1/(this.scaleX*this.scaleY);
    for(let y=yFirst;y<yLast;y++){
      const y0=y*this.scaleY,y1=(y+1)*this.scaleY;
      const syFirst=Math.max(top,Math.floor(y0)),syLast=Math.min(top+height,Math.ceil(y1));
      for(let x=xFirst;x<xLast;x++){
        const x0=x*this.scaleX,x1=(x+1)*this.scaleX;
        const sxFirst=Math.max(left,Math.floor(x0)),sxLast=Math.min(left+width,Math.ceil(x1));
        let r=0,g=0,b=0,a=0;
        for(let sy=syFirst;sy<syLast;sy++){
          const wy=(Math.min(y1,sy+1)-Math.max(y0,sy))*normalization;
          for(let sx=sxFirst;sx<sxLast;sx++){
            const weight=(Math.min(x1,sx+1)-Math.max(x0,sx))*wy,i=((sy-top)*width+sx-left)*4;
            r+=data[i]*weight;g+=data[i+1]*weight;b+=data[i+2]*weight;a+=data[i+3]*weight;
          }
        }
        const o=(y*this.width+x)*4;this.data[o]+=r;this.data[o+1]+=g;this.data[o+2]+=b;this.data[o+3]+=a;
      }
    }
  }
}

export function resampleArea(data,sourceWidth,sourceHeight,width,height){
  const filter=new AreaResampler(sourceWidth,sourceHeight,width,height);
  filter.addTile(data,0,0,sourceWidth,sourceHeight);
  return filter.data;
}

// Scale the Lanczos2 support with the reduction ratio. Four fixed taps would
// reconstruct an image, but would not remove aliasing during a large reduction.
export function lanczos2(x){
  x=Math.abs(x);if(x<1e-8)return 1;if(x>=2)return 0;
  const p=Math.PI*x;return Math.sin(p)*Math.sin(p/2)/(p*p/2);
}

export function lanczosAxis(input,output){
  const scale=input/output,support=Math.max(1,scale),taps=Math.ceil(4*support)+1;
  const indices=new Int32Array(output*taps),weights=new Float32Array(output*taps),counts=new Uint32Array(output);
  for(let x=0;x<output;x++){
    const center=(x+.5)*scale-.5,first=Math.ceil(center-2*support),last=Math.floor(center+2*support);
    let sum=0,count=0;
    for(let i=first;i<=last;i++){
      const weight=lanczos2((i-center)/support);if(Math.abs(weight)<1e-8)continue;
      const p=x*taps+count++;indices[p]=Math.max(0,Math.min(input-1,i));weights[p]=weight;sum+=weight;
    }
    for(let i=0;i<count;i++)weights[x*taps+i]/=sum;
    counts[x]=count;
  }
  return{indices,weights,counts,taps};
}

// Shared row kernel for synchronous worker processing and cooperative fallback.
export function filterLanczosRows(data,inputWidth,output,width,height,axis,vertical,start,end){
  const {indices,weights,counts,taps}=axis;
  for(let y=start;y<end;y++)for(let x=0;x<width;x++){
    const cell=vertical?y:x,offset=cell*taps;let r=0,g=0,b=0,a=0;
    for(let k=0;k<counts[cell];k++){
      const i=vertical?(indices[offset+k]*inputWidth+x)*4:(y*inputWidth+indices[offset+k])*4,w=weights[offset+k];
      r+=data[i]*w;g+=data[i+1]*w;b+=data[i+2]*w;a+=data[i+3]*w;
    }
    const o=(y*width+x)*4;output[o]=r;output[o+1]=g;output[o+2]=b;output[o+3]=a;
  }
}

export function resampleLanczos2(data,sourceWidth,sourceHeight,width,height){
  if(![sourceWidth,sourceHeight,width,height].every(v=>Number.isInteger(v)&&v>0)||width>sourceWidth||height>sourceHeight||data.length!==sourceWidth*sourceHeight*4)throw new Error('Invalid downsampling dimensions');
  let horizontal=data;
  if(width!==sourceWidth){horizontal=new Float32Array(width*sourceHeight*4);filterLanczosRows(data,sourceWidth,horizontal,width,sourceHeight,lanczosAxis(sourceWidth,width),false,0,sourceHeight);}
  if(height===sourceHeight)return horizontal;
  const output=new Float32Array(width*height*4);filterLanczosRows(horizontal,width,output,width,height,lanczosAxis(sourceHeight,height),true,0,height);return output;
}
