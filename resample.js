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
