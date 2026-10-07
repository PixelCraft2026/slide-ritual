import test from 'node:test';
import assert from 'node:assert/strict';
import {versionModuleUrls,versionHtmlUrls} from '../tools/asset-version.mjs';

test('a release uses one cache key for static, side-effect and lazy module imports',()=>{
  const source=`import {a} from './a.js'; import './boot.js'; const lazy=()=>import('./video-export.js'); export {a} from '../a.js';`;
  const output=versionModuleUrls(source,'abc123');
  for(const url of ['./a.js','./boot.js','./video-export.js','../a.js'])assert.ok(output.includes(url+'?v=abc123'));
  assert.ok(output.includes("()=>import('./video-export.js?v=abc123')"));
  assert.notEqual(output,versionModuleUrls(source,'def456'));
});
test('entry scripts and module preloads share the release key, with external and embedded URLs preserved',()=>{
  const html='<script src="app.js"></script><link rel="modulepreload" href="app.js"><link href="style.css"><img src="assets/a.jpg"><script src="https://example.com/a.js"></script>';
  const output=versionHtmlUrls(html,'abc123');
  assert.equal(output.match(/app\.js\?v=abc123/g).length,2);
  assert.ok(output.includes('style.css?v=abc123'));
  assert.ok(output.includes('src="assets/a.jpg"'));
  assert.ok(output.includes('src="https://example.com/a.js"'));
  const external=`import {a} from 'https://example.com/a.js'; import('data:text/javascript;base64,YQ=='); import('blob:example');`;
  assert.equal(versionModuleUrls(external,'abc123'),external);
});
