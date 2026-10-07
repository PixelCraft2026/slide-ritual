import { ExportFilter,exportPresentation } from './export-motion.js';

// During holds only dust changes. Cache the layers either side of the air;
// assemble them on the GPU without repeating SVG, blur and gradient painting.
export class HoldCompositor extends ExportFilter{
  constructor(width,height,gamma=1){
    super(`#version 300 es
      precision highp float;uniform sampler2D image;uniform sampler2D bottom;uniform sampler2D top;uniform sampler2D photo;uniform sampler2D glow;in vec2 uv;out vec4 color;
      ${exportPresentation}
      void main(){vec4 a=texture(image,uv),b=texture(bottom,uv),t=texture(top,uv),p=texture(photo,uv),s=texture(glow,uv);
        vec3 c=a.rgb*a.a+b.rgb*(1.-a.a);c=curve(s.rgb*s.a+c*(1.-s.a));
        c=p.rgb*p.a+c*(1.-p.a);c=curve(t.rgb)*t.a+c*(1.-t.a);color=vec4(rounding(c),1);}`);
    this.width=width;this.height=height;const g=this.gl;
    this.bottom=g.createTexture();this.top=g.createTexture();this.photo=g.createTexture();this.glow=g.createTexture();
    for(const [i,texture]of [this.bottom,this.top,this.photo,this.glow].entries()){
      g.activeTexture(g.TEXTURE1+i);g.bindTexture(g.TEXTURE_2D,texture);
      for(const axis of [g.TEXTURE_WRAP_S,g.TEXTURE_WRAP_T])g.texParameteri(g.TEXTURE_2D,axis,g.CLAMP_TO_EDGE);for(const filter of [g.TEXTURE_MIN_FILTER,g.TEXTURE_MAG_FILTER])g.texParameteri(g.TEXTURE_2D,filter,g.LINEAR);
    }
    g.uniform1i(this.location('bottom'),1);g.uniform1i(this.location('top'),2);g.uniform1i(this.location('photo'),3);g.uniform1i(this.location('glow'),4);g.uniform1f(this.location('gamma'),gamma);g.activeTexture(g.TEXTURE0);
  }
  layer(canvas,top=false){
    const g=this.gl,unit=top==='photo'?3:top==='glow'?4:top?2:1,texture=unit===3?this.photo:unit===4?this.glow:top?this.top:this.bottom;
    g.activeTexture(g.TEXTURE0+unit);g.bindTexture(g.TEXTURE_2D,texture);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,true);g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL,g.NONE);g.texImage2D(g.TEXTURE_2D,0,g.RGBA16F,g.RGBA,g.HALF_FLOAT,canvas);g.activeTexture(g.TEXTURE0);
  }
  render(air){this.gl.activeTexture(this.gl.TEXTURE0);this.upload(air,this.width,this.height,true);return this.draw();}
  dispose(){for(const texture of [this.bottom,this.top,this.photo,this.glow])this.gl.deleteTexture(texture);super.dispose();}
}
