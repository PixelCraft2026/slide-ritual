// Radiance RGBE decoder. Input remains scene-linear until display mapping.
export function decodeRadiance(buffer) {
  const bytes = new Uint8Array(buffer); let pos = 0;
  const line = () => {
    const start = pos;
    while (pos < bytes.length && bytes[pos] !== 10) pos++;
    if (pos === bytes.length) throw new Error('HDR 文件头不完整');
    return new TextDecoder().decode(bytes.subarray(start, pos++)).replace(/\r$/, '');
  };
  if (!/^#\?(RADIANCE|RGBE)$/.test(line())) throw new Error('不是 Radiance RGBE 文件');
  let format = '', value;
  do { value = line(); if (value.startsWith('FORMAT=')) format = value.slice(7); } while (value);
  if (format !== '32-bit_rle_rgbe') throw new Error('仅支持 RGBE 格式的 Radiance HDR');
  const res = line().match(/^([+-])Y\s+(\d+)\s+([+-])X\s+(\d+)$/);
  if (!res) throw new Error('不支持此 HDR 像素方向，请转换为 Y / X 顺序');
  const height = Number(res[2]), width = Number(res[4]);
  if (width < 1 || height < 1 || width * height > 16_777_216 || width > 32767) throw new Error('HDR 尺寸超过 1677 万像素上限');
  const pixels = new Uint8Array(width * height * 4);
  const need = n => { if (pos + n > bytes.length) throw new Error('HDR 像素数据不完整'); };
  const modern = width >= 8 && width <= 32767 && bytes[pos] === 2 && bytes[pos+1] === 2 && bytes[pos+2] < 128;
  if (modern) {
    const scan = new Uint8Array(width * 4);
    for (let y = 0; y < height; y++) {
      need(4);
      if (bytes[pos++] !== 2 || bytes[pos++] !== 2 || (bytes[pos++] << 8 | bytes[pos++]) !== width) throw new Error('HDR 扫描行尺寸不一致');
      for (let c = 0; c < 4; c++) {
        let x = 0;
        while (x < width) {
          need(1); const code = bytes[pos++];
          if (code === 0) throw new Error('HDR RLE 长度无效');
          const n = code > 128 ? code - 128 : code;
          if (x + n > width) throw new Error('HDR RLE 超出扫描行');
          if (code > 128) { need(1); const v = bytes[pos++]; for (let i=0;i<n;i++) scan[(x+i)*4+c]=v; }
          else { need(n); for (let i=0;i<n;i++) scan[(x+i)*4+c]=bytes[pos++]; }
          x += n;
        }
      }
      pixels.set(scan, y * width * 4);
    }
  } else {
    let p = 0, shift = 0;
    while (p < width * height) {
      need(4); const r=bytes[pos++],g=bytes[pos++],b=bytes[pos++],e=bytes[pos++];
      if (r === 1 && g === 1 && b === 1) {
        const n = e * 2**shift;
        if (!p || !n || shift > 24 || p+n > width*height) throw new Error('HDR 旧式 RLE 长度无效');
        const prior = pixels.slice((p-1)*4,p*4);
        for (let i=0;i<n;i++) pixels.set(prior, (p++)*4);
        shift += 8;
      } else { pixels.set([r,g,b,e],p++*4); shift=0; }
    }
  }
  const scale = Math.min(1, 2560 / Math.max(width,height), Math.sqrt(3_000_000/(width*height)));
  const w = Math.max(1, Math.floor(width*scale)), h = Math.max(1,Math.floor(height*scale));
  const data = new Float32Array(w*h*4); let peak = 0;
  for (let y=0;y<h;y++) for(let x=0;x<w;x++) {
    let sx=Math.min(width-1, Math.floor(x/scale)), sy=Math.min(height-1,Math.floor(y/scale));
    if(res[1]==='+') sy=height-1-sy; if(res[3]==='-') sx=width-1-sx;
    const i=(sy*width+sx)*4, o=(y*w+x)*4;
    const factor = pixels[i+3] ? 2**(pixels[i+3]-136) : 0;
    for(let c=0;c<3;c++) { const v = pixels[i+3] ? (pixels[i+c]+.5)*factor : 0; data[o+c]=Math.min(v,65504); peak=Math.max(peak,data[o+c]); }
    data[o+3]=1;
  }
  return { data, width:w, height:h, originalWidth:width, originalHeight:height, hdr:true, colorSpace:'srgb', peak };
}

export const srgbToLinear = v => Math.sign(v) * (Math.abs(v) <= .04045 ? Math.abs(v)/12.92 : ((Math.abs(v)+.055)/1.055)**2.4);
export const linearToSrgb = v => Math.sign(v) * (Math.abs(v) <= .0031308 ? Math.abs(v)*12.92 : 1.055*Math.abs(v)**(1/2.4)-.055);
export function expandSDR(luminance, peak=2) {
  const t=Math.max(0,Math.min(1,(luminance-.58)/.42));
  return luminance*(1+(peak-1)*t*t*(3-2*t));
}
// IEEE half conversion, including subnormals; typed-array bytes go straight to GPU.
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
export function toHalf(value) {
  f32[0] = value; const bits=u32[0], sign=(bits>>>16)&0x8000, exponent=((bits>>>23)&255)-127+15, mantissa=bits&0x7fffff;
  if(exponent>=31) return sign | (Number.isNaN(value) ? 0x7e00 : 0x7bff);
  if(exponent<=0) { if(exponent < -10) return sign; const m=(mantissa|0x800000) >>> (1-exponent); return sign | ((m+0x1000)>>>13); }
  const rounded=mantissa+0x1000;
  return sign | Math.min(0x7bff,(exponent<<10)+(rounded>>>13));
}

export function hasHDRMetadata(bytes) {
  // XMP markers indicate a candidate, not proof that the decoder retained HDR.
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length,1_048_576)));
  if(/hdrgm:|hdr-gain-map|urn:com:apple:photo:2020:aux:hdrgainmap|21496|HDRGainMap/i.test(header)) return true;
  for(let i=4;i<Math.min(bytes.length-10,1_048_576);i++) {
    // ISO BMFF nclx: primaries u16, transfer u16, matrix u16. PNG cICP: u8 values.
    if(bytes[i]===110&&bytes[i+1]===99&&bytes[i+2]===108&&bytes[i+3]===120) {
      const transfer=(bytes[i+6]<<8)|bytes[i+7]; if(transfer===16||transfer===18) return true;
    }
    if(bytes[i]===99&&bytes[i+1]===73&&bytes[i+2]===67&&bytes[i+3]===80 && (bytes[i+5]===16||bytes[i+5]===18)) return true;
  }
  return false;
}
