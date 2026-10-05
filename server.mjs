import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = resolve(fileURLToPath(new URL('.', import.meta.url)));
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.png':'image/png', '.wav':'audio/wav', '.mp4':'video/mp4', '.hdr':'application/octet-stream', '.json':'application/json' };
http.createServer((req, res) => {
  let path;
  try { path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname)); }
  catch { res.writeHead(400).end(); return; }
  if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  if (path.slice(root.length).split(/[\\/]/).some(part => part.startsWith('.'))) { res.writeHead(403).end(); return; }
  try {
    if (statSync(path).isDirectory()) path = resolve(path, 'index.html');
    const size = statSync(path).size;
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
      if (start > end || start >= size) { res.writeHead(416).end(); return; }
      res.writeHead(206, { 'Content-Range':`bytes ${start}-${end}/${size}`, 'Content-Length':end-start+1 });
      createReadStream(path, { start, end }).pipe(res);
    } else { res.writeHead(200, { 'Content-Length':size }); createReadStream(path).pipe(res); }
  } catch { res.writeHead(404).end('Not found'); }
}).listen(8790, '127.0.0.1', () => console.log('暗室 · http://127.0.0.1:8790'));
