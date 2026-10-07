import { readFileSync, writeFileSync } from 'node:fs';
const data=(file,mime)=>`data:${mime};base64,${readFileSync(file).toString('base64')}`;
let html=readFileSync('index.html','utf8');
html=html.replace('<link rel="stylesheet" href="style.css">',`<style>${readFileSync('style.css','utf8')}</style>`);
html=html.replace(/<link rel="(?:preload|modulepreload)"[^>]*>/g,'');
html=html.replace('href="assets/favicon.svg"',`href="${data('assets/favicon.svg','image/svg+xml')}"`).replace('href="./"','href="#"');
let js=['resample.js','hdr.js','pixels.js','transition.js','photo-motion.js', 'environment-gamma.js','renderer.js','audio.js','wall-diffusion.js','scene.js','atmosphere.js','machine-light.js','native-projection.js','gain-map.js','i18n.js','app.js'].map(file=>readFileSync(file,'utf8').replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'')).join('\n\n');
for(const name of ['ice lake','fish lantern','observatory'])js=js.replaceAll(`assets/${name}.jpg`,data(`assets/${name}.jpg`,'image/jpeg'));
const sounds={advance:data('assets/advance.mp3','audio/mpeg'),'advance-startup':data('assets/advance-startup.mp3','audio/mpeg'),fan:data('assets/fan.mp3','audio/mpeg')};
js=`import * as THREE from '${data('vendor/three.module.js','text/javascript')}';\nconst EMBEDDED_AUDIO=${JSON.stringify(sounds)};\n${js}`.replace('fetch(`assets/${name}.mp3`)','fetch(EMBEDDED_AUDIO[name])');
// Offline bytes are embedded, but the export module is parsed only on demand.
js=js.replace("import('./video-export.js')",`import('${data('video-export.js','text/javascript')}')`);
html=html.replace('<script type="module" src="app.js"></script>',`<script type="module">\n${js.replace(/<\/script/gi,'<\\/script')}\n</script>`);
writeFileSync('darkroom.html',html);
console.log(`darkroom.html: ${(Buffer.byteLength(html)/1048576).toFixed(2)} MB, images and audio embedded.`);
