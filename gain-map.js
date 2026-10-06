import { processGainMapPixels } from './pixels.js';

function jpegHeaders(bytes,start=0){
  if(bytes[start]!==255||bytes[start+1]!==216)return null;
  const segments=[];let p=start+2;
  while(p+4<=bytes.length){
    if(bytes[p++]!==255)return null;while(bytes[p]===255)p++;
    const marker=bytes[p++];if(marker===218||marker===217)return segments;
    const length=(bytes[p]<<8)|bytes[p+1];if(length<2||p+length>bytes.length)return null;
    segments.push({marker,start:p-2,data:p+2,end:p+length});p+=length;
  }
  return null;
}
function mpfImages(bytes,segment){
  const start=segment.data+4,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),little=bytes[start]===73&&bytes[start+1]===73;
  if(!little&&!(bytes[start]===77&&bytes[start+1]===77))return null;
  const u16=p=>view.getUint16(p,little),u32=p=>view.getUint32(p,little);
  if(u16(start+2)!==42)return null;const ifd=start+u32(start+4);if(ifd+2>segment.end)return null;
  const count=u16(ifd);if(count>64||ifd+2+count*12>segment.end)return null;
  for(let i=0;i<count;i++){
    const p=ifd+2+i*12;if(u16(p)!==0xb002)continue;
    const size=u32(p+4),table=start+u32(p+8);if(size<32||size%16||table+size>segment.end)return null;
    return[{start:0,length:u32(table+4)},{start:start+u32(table+24),length:u32(table+20)}];
  }
  return null;
}
function xmp(bytes,headers){return headers.filter(s=>s.marker===225).map(s=>new TextDecoder().decode(bytes.subarray(s.data,s.end))).filter(s=>s.includes('http://ns.adobe.com/hdr-gain-map/1.0/')).join('\n');}
function field(text,name){
  const attribute=text.match(new RegExp(`hdrgm:${name}\\s*=\\s*["']([^"']+)["']`));if(attribute)return attribute[1];
  const element=text.match(new RegExp(`<hdrgm:${name}[^>]*>([\\s\\S]*?)</hdrgm:${name}>`));if(!element)return;
  const items=[...element[1].matchAll(/<rdf:li[^>]*>([^<]+)<\/rdf:li>/g)];return items.length?items.map(x=>x[1]):element[1].trim();
}
function channels(text,name,fallback){
  const raw=field(text,name)??fallback,values=(Array.isArray(raw)?raw:[raw]).map(Number);
  if(values.length!==1&&values.length!==3||values.some(v=>!Number.isFinite(v)))return null;
  return values.length===1?[values[0],values[0],values[0]]:values;
}
function profileSpace(bytes,headers){
  const segments=headers.filter(s=>s.marker===226&&new TextDecoder().decode(bytes.subarray(s.data,s.data+12))==='ICC_PROFILE\0').sort((a,b)=>bytes[a.data+12]-bytes[b.data+12]);
  if(!segments.length)return'srgb';
  if(segments.some((s,i)=>s.end-s.data<14||bytes[s.data+12]!==i+1||bytes[s.data+13]!==segments.length))return null;
  const profile=new Uint8Array(segments.reduce((n,s)=>n+s.end-s.data-14,0));let offset=0;
  for(const s of segments){profile.set(bytes.subarray(s.data+14,s.end),offset);offset+=s.end-s.data-14;}
  if(profile.length<132)return null;const view=new DataView(profile.buffer),count=view.getUint32(128);if(count>128||132+count*12>profile.length)return null;
  const primaries=[];
  for(const tag of ['rXYZ','gXYZ','bXYZ']){
    let values;
    for(let i=0;i<count;i++){const p=132+i*12;if(new TextDecoder().decode(profile.subarray(p,p+4))!==tag)continue;const at=view.getUint32(p+4);if(at+20>profile.length)return null;values=[0,1,2].map(c=>view.getInt32(at+8+c*4)/65536);break;}
    if(!values)return null;primaries.push(...values);
  }
  for(const [space,matrix]of [['srgb',[.436075,.222505,.013932,.385065,.716879,.097105,.14308,.060617,.714173]],['display-p3',[.515102,.241182,-.001049,.291965,.692236,.041882,.157153,.066582,.784378]]])if(primaries.every((value,i)=>Math.abs(value-matrix[i])<.003))return space;
  return null;
}
function orientation(bytes,headers){
  const exif=headers.find(s=>s.marker===225&&new TextDecoder().decode(bytes.subarray(s.data,s.data+6))==='Exif\0\0');if(!exif)return 1;
  try{const start=exif.data+6,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length),little=bytes[start]===73,ifd=start+view.getUint32(start+4,little),count=view.getUint16(ifd,little);if(count>256||ifd+2+count*12>exif.end)return 0;
    for(let i=0;i<count;i++){const p=ifd+2+i*12;if(view.getUint16(p,little)===274)return view.getUint16(p+8,little);}return 1;
  }catch{return 0;}
}

// Adobe HDR Gain Map 1.0 in JPEG/MPF. Unsupported profiles and metadata retain
// the browser's native display path rather than fabricating HDR highlights.
export function readGainMapJPEG(bytes){
  try{
    const primary=jpegHeaders(bytes);if(!primary)return null;
    const mpf=primary.find(s=>s.marker===226&&new TextDecoder().decode(bytes.subarray(s.data,s.data+4))==='MPF\0');if(!mpf)return null;
    const images=mpfImages(bytes,mpf);if(!images||images.some(s=>s.length<4||s.start+s.length>bytes.length||bytes[s.start+s.length-2]!==255||bytes[s.start+s.length-1]!==217))return null;
    const gain=jpegHeaders(bytes,images[1].start);if(!gain)return null;const text=xmp(bytes,primary)+'\n'+xmp(bytes,gain);
    if(field(text,'Version')!=='1.0'||/^true$/i.test(field(text,'BaseRenditionIsHDR')||'False'))return null;
    const minimum=channels(text,'GainMapMin',0),maximum=channels(text,'GainMapMax',1),gamma=channels(text,'Gamma',1),offsetSDR=channels(text,'OffsetSDR',1/64),offsetHDR=channels(text,'OffsetHDR',1/64);
    if(!minimum||!maximum||!gamma||!offsetSDR||!offsetHDR||gamma.some(v=>v<=0||v>16)||minimum.some((v,i)=>v>maximum[i]||Math.abs(v)>16)||maximum.some(v=>Math.abs(v)>16)||[...offsetSDR,...offsetHDR].some(v=>v<0||v>1))return null;
    const colorSpace=profileSpace(bytes,primary),rotate=orientation(bytes,primary);if(!colorSpace||rotate<1||rotate>8)return null;
    // Remove only the gain-map metadata and MPF link from the temporary base
    // decode. EXIF orientation and the original ICC profile are retained.
    const excluded=primary.filter(s=>s===mpf||s.marker===225&&new TextDecoder().decode(bytes.subarray(s.data,s.end)).includes('http://ns.adobe.com/hdr-gain-map/1.0/'));
    const pieces=[];let p=0;for(const s of excluded){pieces.push(bytes.subarray(p,s.start));p=s.end;}pieces.push(bytes.subarray(p,images[0].length));
    return{base:pieces,gain:bytes.subarray(images[1].start,images[1].start+images[1].length),metadata:{minimum,maximum,gamma,offsetSDR,offsetHDR},colorSpace,orientation:rotate};
  }catch{return null;}
}

export async function decodeGainMapTransition(file,image,viewport){
  if(!file||!/^image\/jpeg$/i.test(file.type)&&!/\.jpe?g$/i.test(file.name))return null;
  const parsed=readGainMapJPEG(new Uint8Array(await file.arrayBuffer()));if(!parsed)return null;
  let base,gain;
  try{
    // Decode a bounded preview at twice the output size, then filter the
    // reconstructed linear HDR values with the same Lanczos2 pixel worker.
    const scale=Math.min(1,viewport.width*2/image.naturalWidth,viewport.height*2/image.naturalHeight,Math.sqrt(3_000_000/(image.naturalWidth*image.naturalHeight)));
    const width=Math.max(1,Math.round(image.naturalWidth*scale)),height=Math.max(1,Math.round(image.naturalHeight*scale));
    const rotated=parsed.orientation>=5,rawWidth=rotated?height:width,rawHeight=rotated?width:height;
    base=await createImageBitmap(new Blob(parsed.base,{type:'image/jpeg'}),{resizeWidth:width,resizeHeight:height,resizeQuality:'high'});
    gain=await createImageBitmap(new Blob([parsed.gain],{type:'image/jpeg'}),{imageOrientation:'none',colorSpaceConversion:'none',resizeWidth:rawWidth,resizeHeight:rawHeight,resizeQuality:'high'});
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const context=canvas.getContext('2d',{colorSpace:parsed.colorSpace,willReadFrequently:true});context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(base,0,0,width,height);
    const pixels=context.getImageData(0,0,width,height).data;
    const gainCanvas=document.createElement('canvas');gainCanvas.width=width;gainCanvas.height=height;
    const gainContext=gainCanvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});gainContext.imageSmoothingEnabled=true;gainContext.imageSmoothingQuality='high';
    const transforms={1:[1,0,0,1,0,0],2:[-1,0,0,1,width,0],3:[-1,0,0,-1,width,height],4:[1,0,0,-1,0,height],5:[0,1,1,0,0,0],6:[0,1,-1,0,width,0],7:[0,-1,-1,0,width,height],8:[0,-1,1,0,0,height]};
    gainContext.setTransform(...transforms[parsed.orientation]);gainContext.drawImage(gain,0,0,rawWidth,rawHeight);gainContext.resetTransform();const gains=gainContext.getImageData(0,0,width,height).data;
    canvas.width=canvas.height=gainCanvas.width=gainCanvas.height=1;
    return await processGainMapPixels(pixels,gains,width,height,parsed.colorSpace,parsed.metadata,viewport);
  }catch{return null;}finally{base?.close();gain?.close();}
}
