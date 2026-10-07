import test from 'node:test';
import assert from 'node:assert/strict';
import {photoMotion,photoPadding,PHOTO_MOTION_SAMPLES} from '../photo-motion.js';
import {transitionAt,startupAt} from '../transition.js';
import {WallLight} from '../scene.js';

test('dense paths stay within the padded source and respect the shutter and sample budget',()=>{
  for(const opening of [false,true])for(const travel of [250,700,2400])for(let time=0;time<(opening?1850:1500);time++){
    const frame=(opening?startupAt:transitionAt)(time),profile=photoMotion(frame,{time,opening,travel,scale:2});
    if(!profile)continue;
    assert.equal(profile.shutter,500/60);assert.ok(profile.count>=16&&profile.count<=PHOTO_MOTION_SAMPLES);
    for(let i=0;i<profile.count;i++)assert.ok(Math.abs(profile.data[i*4])<=photoPadding(travel)*2);
  }
});
test('hold, dark and reduced motion skip sampling; shutter crossings never mix different photos',()=>{
  for(const time of [200,600,966,1300,1500])assert.equal(photoMotion(transitionAt(time),{time}),null);
  assert.equal(photoMotion({...transitionAt(100),velocity:0},{time:100,travel:700}),null);
  const profile=photoMotion(transitionAt(199),{time:199,travel:700});
  assert.ok(profile.data.subarray(0,profile.count*4).some((v,i)=>i%4===3&&v===0));
  const data=new Float32Array(512),hdr=photoMotion(transitionAt(100),{time:100,travel:700,neutralGain:true},data);
  assert.equal(hdr.data,data);for(let i=0;i<hdr.count;i++)assert.equal(hdr.data[i*4+2],1);
});
test('wall gain keeps increasing through 200 and 600 percent while reusing the same cache',()=>{
  const draws=[],ctx={clearRect(){},save(){},restore(){},drawImage(image){draws.push({image,alpha:this.globalAlpha,operation:this.globalCompositeOperation});}};
  const wall=new WallLight({width:100,height:100,getContext(){return ctx;}}),buffer={};wall.buffer=buffer;
  assert.equal(wall.amount,2);
  for(const amount of [0,1,2,6]){wall.amount=amount;draws.length=0;wall.draw(1);assert.ok(Math.abs(draws.reduce((sum,x)=>sum+x.alpha,0)-amount*.82)<1e-12);assert.ok(draws.every(x=>x.image===buffer&&x.operation==='lighter'));}
});
