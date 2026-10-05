import test from 'node:test';
import assert from 'node:assert/strict';
import { AirLight } from '../atmosphere.js';
import { projectionLayout } from '../transition.js';

test('beam meets the real photo lower edge at exactly its width, including portrait and mobile',()=>{
  for(const [w,h] of [[1440,960],[390,844]])for(const ratio of [1.5,2/3,1]){
    const layout=projectionLayout(w,h,ratio);
    const a=Object.assign(Object.create(AirLight.prototype),{w,h,sw:layout.width,sh:layout.height,lens:{x:w/2,y:h*.72}});
    const y=h*(w<600?.34:.31)+layout.height/2;
    const base=a.section(y),tip=a.section(a.lens.y);
    assert.equal(base.halfWidth*2,layout.width);assert.equal(base.x,w/2);assert.equal(base.wallY,y);
    assert.equal(tip.x,a.lens.x);assert.equal(tip.halfWidth,3);
    const masked=a.section(y,{shift:-.1,clipRight:.6});
    assert.ok(Math.abs(masked.halfWidth*2-layout.width*.4)<1e-9);
    assert.ok(Math.abs(masked.x-(w/2-layout.width*.4))<1e-9);
    assert.equal(a.section(y,{shift:0,clipRight:1}).halfWidth,0);
  }
});
