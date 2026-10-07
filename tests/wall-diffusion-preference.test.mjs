import test from 'node:test';
import assert from 'node:assert/strict';
import {createWallDiffusionPreference} from '../wall-diffusion.js';

const storage=()=>{const data=new Map();return{data,getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
test('old and current wall reference gains have independent defaults and saved values',()=>{
  const s=storage(),legacy=createWallDiffusionPreference(true,s),linear=createWallDiffusionPreference(false,s);
  assert.equal(legacy.defaultAmount,1);assert.equal(legacy.amount,1);assert.equal(linear.defaultAmount,2);assert.equal(linear.amount,2);
  linear.save(3.7);assert.equal(createWallDiffusionPreference(true,s).amount,1);
  legacy.save(.65);assert.equal(createWallDiffusionPreference(false,s).amount,3.7);assert.equal(createWallDiffusionPreference(true,s).amount,.65);
  legacy.save(0);assert.equal(createWallDiffusionPreference(true,s).amount,0);
});
test('invalid or inaccessible wall preferences preserve usable per-model defaults',()=>{
  const s=storage();for(const value of ['', ' ', 'NaN','Infinity','-1','6.1']){
    s.data.set('slide-ritual-wall-diffusion-legacy',value);assert.equal(createWallDiffusionPreference(true,s).amount,1);
    s.data.set('slide-ritual-wall-diffusion-linear',value);assert.equal(createWallDiffusionPreference(false,s).amount,2);
  }
  const denied={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};
  const legacy=createWallDiffusionPreference(true,denied);assert.equal(legacy.amount,1);assert.doesNotThrow(()=>legacy.save(1.1));
});
