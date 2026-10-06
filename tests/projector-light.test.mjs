import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { ProjectorScene } from '../scene.js';

test('rolled casing edges have outward normals for either contour winding, without a raised cap',()=>{
  for(const winding of [1,-1]){
    const s=Object.assign(Object.create(ProjectorScene.prototype),{machine:new THREE.Group(),topSilver:new THREE.MeshPhysicalMaterial(),topMaterials:[],meshes:0});
    const shape=new THREE.Shape(),points=[[-1,-1],[1,-1],[1,1],[-1,1]];
    if(winding<0)points.reverse();shape.moveTo(...points[0]);for(const point of points.slice(1))shape.lineTo(...point);shape.closePath();
    const mesh=s.rolledEdge(shape,.953,.042,.095,'casing'),p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
    assert.equal(mesh.children.length,0);assert.equal(mesh.material.side,THREE.FrontSide);
    for(let i=0;i<p.count;i++)assert.ok(p.getY(i)<=.953+1e-6,'no crown rises above the original top');
    for(let i=0;i<p.count;i+=10){
      assert.ok(n.getY(i)>.97,'top normals face upward');
      const radial=new THREE.Vector3(p.getX(i+9)-p.getX(i),0,p.getZ(i+9)-p.getZ(i)).normalize();
      assert.ok(radial.dot(new THREE.Vector3(n.getX(i+9),n.getY(i+9),n.getZ(i+9)))>.97,'skirt normals face outward');
    }
  }
});

function housing(){
  const s=Object.assign(Object.create(ProjectorScene.prototype),{machine:new THREE.Group(),scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera(),canvas:{dataset:{}},pitch:0});
  s.scene.add(s.machine);s.bounce=new THREE.DirectionalLight();s.bounce.position.set(0,4,-6);s.scene.add(s.bounce);
  s.cover=new THREE.Mesh(new THREE.BoxGeometry(2,.1,2),new THREE.MeshStandardMaterial());s.cover.name='cover';s.machine.add(s.cover);
  s.carriage=new THREE.Group();s.carriage.add(s.cover.clone());s.carriage.children[0].castShadow=true;s.machine.add(s.carriage);
  for(const name of ['magazine','activeSlide','incomingSlide','vents']){s[name]=new THREE.Group();s[name].add(s.cover.clone());s.machine.add(s[name]);}
  const window=new THREE.Mesh(new THREE.PlaneGeometry(),new THREE.MeshStandardMaterial({transparent:true}));s.machine.add(window);
  s.buildWallReturn();return s;
}

test('wall return uses static opaque casing occlusion while leaving live mechanism casters independent',()=>{
  const s=housing(),copies=[];s.wallOccluders.traverse(o=>{if(o.isMesh)copies.push(o);});
  assert.equal(copies.length,1);assert.equal(copies[0].geometry,s.cover.geometry);
  assert.notEqual(copies[0].material,s.cover.material);assert.equal(copies[0].material.colorWrite,false);
  assert.equal(s.cover.material.colorWrite,true);assert.equal(s.cover.castShadow,false);assert.equal(s.cover.receiveShadow,true);
  assert.equal(s.carriage.children[0].castShadow,true);assert.equal(s.bounce.shadow.autoUpdate,false);
  const source=s.wallShadowScene.children.find(o=>o.isDirectionalLight);assert.equal(source.shadow,s.bounce.shadow);
  assert.ok(s.bounce.position.z<0,'return light stays on the projection-wall side');
});

test('wall return favours wall-facing curved normals at both ends under the actual viewing angle',()=>{
  const s=housing();s.camera.position.set(.58,3.5,6.2);
  const light=s.bounce.position.clone().sub(s.bounce.target.position).normalize(),angle=10*Math.PI/180;
  const farNormal=new THREE.Vector3(0,Math.cos(angle),-Math.sin(angle)),nearNormal=new THREE.Vector3(0,Math.cos(angle),Math.sin(angle));
  for(const z of [-1.475,1.475]){
    const view=s.camera.position.clone().sub(new THREE.Vector3(0,.953,z)).normalize(),half=light.clone().add(view).normalize();
    assert.ok(half.z<0,'the specular half-vector points toward the wall rather than the viewer');
    assert.ok(farNormal.dot(light)>nearNormal.dot(light),'the wall-facing edge receives more diffuse light');
    assert.ok(farNormal.dot(half)>nearNormal.dot(half),'the wall-facing edge also aligns better with the reflection direction');
  }
});

test('wall occlusion is rebuilt for a changed pitch and reused throughout mechanical movement',()=>{
  const s=housing();let depthPasses=0,visiblePasses=0;
  s.renderer={render(scene){if(scene===s.wallShadowScene){depthPasses++;s.bounce.shadow.needsUpdate=false;}else visiblePasses++;}};
  s.draw();assert.equal(depthPasses,1);
  for(let i=0;i<90;i++){s.carriage.position.x=Math.sin(i);s.machine.rotation.z=Math.sin(i)*.0018;s.draw();}
  assert.equal(depthPasses,1);assert.equal(visiblePasses,91);
  s.setPitch(12);assert.equal(depthPasses,2);assert.equal(s.wallOccluders.rotation.x,s.machine.rotation.x);
  s.setPitch(12);assert.equal(depthPasses,2);
  s.setPitch(-12);assert.equal(depthPasses,3);
});

test('projected-photo return vanishes with a closed shutter, while ambient room light stays independent',()=>{
  const s=housing();s.ambient=new THREE.HemisphereLight();s.vents.visible=false;s.glowMaterial={opacity:0};s.updateSideLight=()=>{};s.draw=()=>{};
  s.illuminate(1,1,[.8,.3,.1]);const ambient=s.ambient.intensity;assert.equal(s.bounce.intensity,.52);
  s.illuminate(1,0);assert.equal(s.bounce.intensity,0);assert.equal(s.ambient.intensity,ambient);
  s.illuminate(0,0);assert.equal(s.bounce.intensity,0);assert.equal(s.ambient.intensity,ambient);
});
