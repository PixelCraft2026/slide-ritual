import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(root, 'dist');
if (dirname(output) !== root || output === root) throw new Error('Invalid Pages output directory');
if (existsSync(output) && lstatSync(output).isSymbolicLink()) throw new Error('Pages output must not be a symbolic link');

const files = [
  'index.html', 'style.css', 'app.js', 'hdr.js', 'renderer.js',
  'scene.js', 'transition.js', 'atmosphere.js', 'machine-light.js', 'audio.js',
  'darkroom.html', 'vendor/three.module.js', 'vendor/LICENSE-three',
  'assets/favicon.svg', 'assets/alpine.jpg', 'assets/woodland.jpg', 'assets/evening.jpg',
  'assets/advance.wav', 'assets/fan.wav',
];

for (const file of files) {
  if (!lstatSync(join(root, file)).isFile()) throw new Error(`Missing regular file: ${file}`);
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
let bytes = 0;
for (const file of files) {
  const destination = join(output, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(root, file), destination);
  bytes += statSync(destination).size;
}
writeFileSync(join(output, '.nojekyll'), '');
console.log(`GitHub Pages: ${files.length + 1} files, ${(bytes / 1048576).toFixed(2)} MiB in dist/`);
