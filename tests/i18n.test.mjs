import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanguage, translate, createI18n } from '../i18n.js';

test('system language uses the first browser preference, supports Chinese variants and falls back to English',()=>{
  for(const locale of ['zh-CN','zh-TW','zh-HK','ZH-hans','zh'])assert.equal(resolveLanguage('auto',[locale,'en']),'zh-CN');
  for(const locale of ['en-US','en-GB','ja','fr',''])assert.equal(resolveLanguage('auto',[locale,'zh']),'en');
  assert.equal(resolveLanguage('en',['zh-CN']),'en');assert.equal(resolveLanguage('zh-CN',['en-US']),'zh-CN');
});
test('translated messages interpolate parameters while uploaded filenames pass through unchanged',()=>{
  assert.equal(translate('已装入 {count} 张照片','en',{count:9}),'Loaded 9 photos');
  assert.equal(translate('下 {value}%','zh-CN',{value:3}),'下 3%');
  assert.equal(translate('my-photo.jpg','en'),'my-photo.jpg');
});
test('language selection persists, auto reacts to system changes and unavailable storage remains usable',()=>{
  const events={},saved=new Map(),select={value:'auto',addEventListener(name,handler){events[name]=handler;}},navigator={languages:['en-US']};
  const document={documentElement:{lang:''},createTreeWalker(){return{nextNode(){return null;}};},querySelectorAll(){return[];},getElementById(){return select;}};
  const window={addEventListener(name,handler){events[name]=handler;}},storage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
  const i18n=createI18n({document,navigator,window,storage});assert.equal(document.documentElement.lang,'en');assert.equal(document.title,'Slide Ritual · Darkroom');
  select.value='zh-CN';events.change();assert.equal(i18n.language,'zh-CN');assert.equal(document.title,'虚拟放映室');assert.equal(saved.get('slide-ritual-language'),'zh-CN');
  navigator.languages=['fr'];events.languagechange();assert.equal(i18n.language,'zh-CN');
  i18n.setPreference('auto');navigator.languages=['zh-HK'];events.languagechange();assert.equal(i18n.language,'zh-CN');
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
  const offline=createI18n({document,navigator,window,storage:denied});offline.setPreference('en');assert.equal(offline.language,'en');
});
