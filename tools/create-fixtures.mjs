import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('tests/fixtures',{recursive:true});
const w=128,h=64;
const header=Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`),rows=[];
for(let y=0;y<h;y++){
  const row=new Uint8Array(w*4);
  for(let x=0;x<w;x++){
    const v=Math.pow(x/(w-1),2)*6+.01;
    const rgb=[v,v*(.3+.7*(1-y/h)),v*(.15+.85*y/h)],m=Math.max(...rgb),e=Math.ceil(Math.log2(m))+128,scale=256/2**(e-128);
    row.set([...rgb.map(c=>Math.min(255,Math.floor(c*scale))),e],x*4);
  }
  rows.push(Buffer.from([2,2,0,w]));
  for(let c=0;c<4;c++){rows.push(Buffer.from([128]));rows.push(Buffer.from(Array.from({length:w},(_,x)=>row[x*4+c])));}
}
writeFileSync('tests/fixtures/highlights.hdr',Buffer.concat([header,...rows]));
writeFileSync('tests/fixtures/broken.hdr',Buffer.from('not a Radiance file'));
writeFileSync('tests/fixtures/unsupported.heic',Buffer.from('unsupported fixture'));
