import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { versionModuleUrls, versionHtmlUrls } from './asset-version.mjs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'dist');
if (dirname(output) !== root || output === root) throw new Error('Invalid Pages output directory');
if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error('Pages output must not be a symbolic link');

const files = [
  'index.html', 'style.css', 'app.js', 'hdr.js', 'renderer.js', 'photo-motion.js', 'canvas-compat.js', 'environment-gamma.js', 'resample.js', 'pixels.js',
  'scene.js', 'wall-diffusion.js', 'transition.js', 'atmosphere.js', 'machine-light.js', 'audio.js', 'native-projection.js', 'gain-map.js', 'i18n.js',
  'darkroom.html', 'video-export.js', 'vendor/three.module.js', 'vendor/LICENSE-three', 'vendor/LICENSE-mediabunny',
  'assets/favicon.svg', 'assets/ice lake.jpg', 'assets/fish lantern.jpg', 'assets/observatory.jpg',
  'assets/advance.mp3', 'assets/advance-startup.mp3', 'assets/fan.mp3',
];

for (const file of files) {
  if (!lstatSync(join(root, file)).isFile()) throw new Error(`Missing regular file: ${file}`);
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const hash = createHash('sha256');
for (const file of files.filter(file=>file.endsWith('.js')||file==='index.html'||file==='style.css')) hash.update(file).update('\0').update(readFileSync(join(root,file)));
hash.update(readFileSync(fileURLToPath(import.meta.url))).update(readFileSync(join(root,'tools/asset-version.mjs')));
const version = hash.digest('hex').slice(0,12);
let bytes = 0;
for (const file of files) {
  const destination = join(output, file);
  mkdirSync(dirname(destination), { recursive: true });
  if(file.endsWith('.js')) writeFileSync(destination,versionModuleUrls(readFileSync(join(root,file),'utf8'),version));
  else if(file==='index.html') writeFileSync(destination,versionHtmlUrls(readFileSync(join(root,file),'utf8'),version));
  else copyFileSync(join(root, file), destination);
  bytes += statSync(destination).size;
}
writeFileSync(join(output, '.nojekyll'), '');
console.log(`Release ${version}: GitHub Pages: ${files.length + 1} files, ${(bytes / 1048576).toFixed(2)} MiB in dist/`);
