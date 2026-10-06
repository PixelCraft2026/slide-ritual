import * as THREE from './vendor/three.module.js';
import { mechanismAt, SLIDE_PITCH, GATE_Z, CHANGE_MS } from './transition.js';
import { snapshotLight, supportsCanvasBlur, blurLightPixels } from './atmosphere.js';

// Rear view reconstructed from the P150 photographs, including back.JPG.
// The projection and its HDR surface stay outside this SDR geometry pass.
export class ProjectorScene {
  constructor(canvas) {
    this.canvas=canvas;this.power=0;this.light=0;this.time=0;this.dirty=true;this.emitterAmount=1;
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'low-power'});
    this.renderer.setClearColor(0x000000,0);this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=.8;
    this.renderer.localClippingEnabled=true;
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(33,1,.1,40);
    // Look straight along the lens axis, so its horizontal position is exactly
    // the same as the centre of every portrait and landscape projection.
    this.camera.position.set(.58,3.5,6.2);this.camera.lookAt(.58,.48,0);
    this.machine=new THREE.Group();this.scene.add(this.machine);
    const surface=this.makeTexture();
    this.silver=new THREE.MeshStandardMaterial({color:0x9c9b90,roughness:.46,metalness:.24,bumpMap:surface,bumpScale:.006});
    this.topBaseColor=this.silver.color.clone();
    this.topSilver=new THREE.MeshPhysicalMaterial({color:this.topBaseColor,roughness:.60,metalness:.12,specularIntensity:.60,bumpMap:surface,bumpScale:.006});
    this.topMaterials=[this.topSilver];
    this.black=new THREE.MeshStandardMaterial({color:0x141515,roughness:.72,metalness:.06,bumpMap:surface,bumpScale:.012});
    this.dark=new THREE.MeshStandardMaterial({color:0x080909,roughness:.48,metalness:.16});
    // Keep the old left transport housing finish for the narrow front trims.
    // Match the rear control panel's black plastic on the transport housing.
    this.frontTrimMaterial=this.dark.clone();
    this.frontTrimMaterial.polygonOffset=true;this.frontTrimMaterial.polygonOffsetFactor=-1;this.frontTrimMaterial.polygonOffsetUnits=-1;
    this.transportPlastic=this.black.clone();
    this.gray=new THREE.MeshStandardMaterial({color:0x79766b,roughness:.65,metalness:.02});
    this.cream=new THREE.MeshStandardMaterial({color:0xc6bd9e,roughness:.76});
    this.meshes=0;this.buildBody();this.buildMagazine();this.buildSideLight();this.setTopReflectance(.70);this.pitch=0;
    this.ambient=new THREE.HemisphereLight(0xb8c5d5,0x100b07,.10);this.scene.add(this.ambient);
    this.bounce=new THREE.DirectionalLight(0xffe6c7,.8);this.scene.add(this.bounce,this.bounce.target);
    this.buildWallReturn();
    this.resize();canvas.dataset.scene='three-p150';canvas.dataset.meshes=this.meshes;
  }
  makeTexture(){const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),im=ctx.createImageData(128,128);let seed=431;for(let i=0;i<im.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const v=118+(seed%32);im.data.set([v,v,v,255],i);}ctx.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(7,7);return t;}
  roundedShape(w,h,r){const x=-w/2,y=-h/2,s=new THREE.Shape();s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;}
  roundContour(shape,radius){
    const p=shape.getPoints().filter((v,i,a)=>i===0||v.distanceTo(a[i-1])>1e-6);if(p[0].distanceTo(p.at(-1))<1e-6)p.pop();
    const corners=p.map((v,i)=>{const a=p[(i+p.length-1)%p.length].clone().sub(v),b=p[(i+1)%p.length].clone().sub(v),r=Math.min(radius,a.length()*.22,b.length()*.22);return {v,a:a.normalize().multiplyScalar(r).add(v),b:b.normalize().multiplyScalar(r).add(v)};});
    const out=new THREE.Shape();out.moveTo(corners[0].a.x,corners[0].a.y);for(const c of corners){out.lineTo(c.a.x,c.a.y);out.quadraticCurveTo(c.v.x,c.v.y,c.b.x,c.b.y);}out.closePath();out.holes=shape.holes;return out;
  }
  buildWallReturn(){
    // The wall return reaches the top at a grazing angle. A high light aimed
    // at the floor acted as an overhead key and favoured the viewer-side rim.
    this.bounce.position.set(0,2.2,-6);this.bounce.target.position.set(0,.953,0);
    // Wall return must be occluded by the casing, rather than lighting rear
    // lips through the lamp cover. Share the static geometry in a depth-only
    // scene so this shadow does not add a casing pass to the live slot light.
    const omitted=new Set([this.carriage,this.magazine,this.activeSlide,this.incomingSlide,this.vents]);
    const depthMaterials=new Map();
    const depthMaterial=material=>{
      if(!depthMaterials.has(material)){const depth=material.clone();depth.colorWrite=false;depthMaterials.set(material,depth);}
      return depthMaterials.get(material);
    };
    const copy=node=>{
      if(omitted.has(node)||node.userData.flushSurface)return null;
      let out;
      if(node.isMesh){
        const materials=Array.isArray(node.material)?node.material:[node.material];
        if(materials.some(m=>m.transparent||!m.isMeshStandardMaterial))return null;
        out=new THREE.Mesh(node.geometry,Array.isArray(node.material)?materials.map(depthMaterial):depthMaterial(node.material));out.castShadow=true;
      }else if(node.isGroup)out=new THREE.Group();else return null;
      out.name=node.name;out.position.copy(node.position);out.quaternion.copy(node.quaternion);out.scale.copy(node.scale);
      for(const child of node.children){const next=copy(child);if(next)out.add(next);}
      return out;
    };
    this.wallOccluders=copy(this.machine);this.wallShadowScene=new THREE.Scene();this.wallShadowScene.add(this.wallOccluders);
    this.machine.traverse(o=>{if(o.isMesh)o.receiveShadow=true;});
    this.bounce.castShadow=true;const shadow=this.bounce.shadow;
    shadow.mapSize.set(1024,1024);Object.assign(shadow.camera,{left:-2.1,right:2.1,top:2.1,bottom:-2.1,near:.5,far:12});
    shadow.camera.updateProjectionMatrix();shadow.bias=-.0003;shadow.normalBias=.008;
    // Light colour/intensity changes do not change occlusion. Only a new
    // physical pitch needs this map rebuilt; the slot retains live shadows.
    shadow.autoUpdate=false;shadow.needsUpdate=true;
    const source=this.bounce.clone();source.shadow=shadow;this.wallShadowScene.add(source,source.target);
  }
  rolledEdge(shape,y,r,depth,name,group=this.machine){
    // Quarter-round normals turn smoothly from the top into a vertical skirt.
    // This creates a reflection on a real curved edge, not an emissive stripe.
    const p=shape.getSpacedPoints(220);p.pop();let area=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];area+=a.x*b.y-b.x*a.y;}
    const pos=[],indices=[],steps=9;
    for(let i=0;i<p.length;i++){
      const tangent=p[(i+1)%p.length].clone().sub(p[(i+p.length-1)%p.length]).normalize();const n=new THREE.Vector2(tangent.y,-tangent.x).multiplyScalar(Math.sign(area));
      for(let j=0;j<=steps;j++){const a=Math.min(j,steps-1)/(steps-1)*Math.PI/2,d=r*Math.sin(a),drop=j===steps?depth:r*(1-Math.cos(a));pos.push(p[i].x+n.x*d,y-drop,-p[i].y-n.y*d);}
    }
    for(let i=0;i<p.length;i++)for(let j=0;j<steps;j++){const a=i*(steps+1)+j,b=((i+1)%p.length)*(steps+1)+j;indices.push(...(area<0?[a,b,a+1,b,b+1,a+1]:[a,a+1,b,b,a+1,b+1]));}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(indices);g.computeVertexNormals();
    // Both contour windings produce outward normals. The original quarter
    // round is the only surface: no raised crown or overlapping highlight cap.
    const mat=this.topSilver.clone();this.topMaterials.push(mat);const mesh=new THREE.Mesh(g,mat);mesh.name=name;group.add(mesh);this.meshes++;return mesh;
  }
  frontTrim(shape,y,name,curveSegments=16,edge){
    // Inlay the finish into the complete front footprint, including both
    // rounded ends. Polygon offset separates coplanar paint, not geometry.
    const outline=shape.getPoints(curveSegments);if(outline[0].distanceTo(outline.at(-1))<1e-6)outline.pop();
    const cutoff=Math.max(...outline.map(p=>p.y))-.0275,band=[];
    for(let i=0;i<outline.length;i++){
      const a=outline[i],b=outline[(i+1)%outline.length],insideA=a.y>=cutoff,insideB=b.y>=cutoff;
      if(insideA)band.push(a.clone());
      if(insideA!==insideB)band.push(a.clone().lerp(b,(cutoff-a.y)/(b.y-a.y)));
    }
    const patch=new THREE.Shape(band),flat=new THREE.ShapeGeometry(patch);flat.rotateX(-Math.PI/2);
    // Continue the same finish over the existing quarter-round. Clip its
    // triangles at the band boundary; all vertices remain on the casing.
    let geometry=flat;
    if(edge){
      const face=flat.toNonIndexed(),positions=Array.from(face.attributes.position.array),normals=Array.from(face.attributes.normal.array);
      const p=edge.geometry.attributes.position,n=edge.geometry.attributes.normal,indices=edge.geometry.index.array;
      for(let i=0;i<indices.length;i+=3){
        const triangle=Array.from(indices.slice(i,i+3),j=>({p:new THREE.Vector3(p.getX(j),p.getY(j)-y,p.getZ(j)),n:new THREE.Vector3(n.getX(j),n.getY(j),n.getZ(j))})),clipped=[];
        for(let j=0;j<3;j++){
          const a=triangle[j],b=triangle[(j+1)%3],insideA=a.p.z<=-cutoff,insideB=b.p.z<=-cutoff;
          if(insideA)clipped.push(a);
          if(insideA!==insideB){const t=(-cutoff-a.p.z)/(b.p.z-a.p.z);clipped.push({p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t).normalize()});}
        }
        for(let j=1;j<clipped.length-1;j++)for(const vertex of [clipped[0],clipped[j],clipped[j+1]]){positions.push(...vertex.p.toArray());normals.push(...vertex.n.toArray());}
      }
      geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));flat.dispose();face.dispose();
    }
    const trim=new THREE.Mesh(geometry,this.frontTrimMaterial);trim.position.y=y;trim.name=name;trim.userData.flushSurface=true;
    this.machine.add(trim);this.meshes++;return trim;
  }
  box(w,h,d,x,y,z,material=this.black,group=this.machine,r=.025){
    r=Math.max(0,Math.min(r,w/4,h/4,d/4));
    const shape=this.roundedShape(w-r*2,h-r*2,r);
    const geo=new THREE.ExtrudeGeometry(shape,{depth:Math.max(.002,d-r*2),bevelEnabled:r>0,bevelSegments:3,steps:1,bevelSize:r,bevelThickness:r,curveSegments:5});
    geo.translate(0,0,-(d-r*2)/2);const m=new THREE.Mesh(geo,material);m.position.set(x,y,z);group.add(m);this.meshes++;return m;
  }
  cylinder(radius,height,x,y,z,mat,group=this.machine){const m=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,height,48),mat);m.position.set(x,y,z);group.add(m);this.meshes++;return m;}
  dullViewerRim(mesh){
    // Suppress only the two viewer-side end highlights, preserving their
    // rounded geometry and the reflective finishes toward the wall.
    mesh.updateWorldMatrix(true,false);const geometry=mesh.geometry,p=geometry.attributes.position;
    const indices=geometry.index?.array??Array.from({length:p.count},(_,i)=>i),normal=[],matte=[];
    for(let i=0;i<indices.length;i+=3){
      const center=new THREE.Vector3();for(let j=0;j<3;j++)center.add(new THREE.Vector3().fromBufferAttribute(p,indices[i+j]));center.multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld);
      (center.z>1.40&&center.y>.92?matte:normal).push(indices[i],indices[i+1],indices[i+2]);
    }
    const source=mesh.material,finish=new THREE.MeshPhysicalMaterial({color:source.color.clone(),roughness:1,metalness:0,specularIntensity:0,bumpMap:source.bumpMap,bumpScale:source.bumpScale});
    finish.userData.diffuseOnly=true;if(this.topMaterials.includes(source))this.topMaterials.push(finish);
    geometry.setIndex([...normal,...matte]);geometry.clearGroups();geometry.addGroup(0,normal.length,0);geometry.addGroup(normal.length,matte.length,1);mesh.material=[source,finish];
  }
  buildBody(){
    // Leave a real, narrow opening through the right shell at the film gate.
    this.box(2.00,.41,2.95,-.08,.25,0,this.black,undefined,.08).name='chassis-base';
    for(const [front,back] of [[-1.475,GATE_Z-.075],[GATE_Z+.075,1.475]])this.box(.16,.41,back-front,1,.25,(front+back)/2,this.black,undefined,.025);
    this.box(.16,.245,.15,1,.1675,GATE_Z,this.black,undefined,.009);
    this.box(2.09,.045,2.99,-.05,.49,0,this.dark,undefined,.012);
    this.box(2.10,.035,2.87,-.05,.875,-.055,this.topSilver,undefined,.008);
    for(const [front,back] of [[-1.495,GATE_Z-.075],[GATE_Z+.075,1.495]])this.box(.10,.045,back-front,1.045,.49,(front+back)/2,this.dark,undefined,.008);
    for(const [front,back] of [[-1.49,GATE_Z-.075],[GATE_Z+.075,1.38]])this.box(.10,.035,back-front,1.05,.875,(front+back)/2,this.topSilver,undefined,.006);
    this.box(.08,.38,2.98,-1.055,.69,0,this.silver,undefined,.018);
    for(const [front,back] of [[-1.49,GATE_Z-.075],[GATE_Z+.075,1.49]])this.box(.08,.38,back-front,1.055,.69,(front+back)/2,this.silver,undefined,.012);
    this.box(2.17,.38,.08,0,.69,-1.44,this.silver,undefined,.018);
    // Rear wall has the curved finger notch below the removable control cover.
    const rear=new THREE.Shape();rear.moveTo(-1.06,.50);rear.lineTo(1.06,.50);rear.lineTo(1.06,1.047);
    rear.lineTo(.93,1.047);rear.lineTo(.93,.900);rear.lineTo(-.13,.900);rear.quadraticCurveTo(-.29,.69,-.45,.900);
    rear.lineTo(-.55,.900);rear.lineTo(-.55,1.047);rear.lineTo(-.72,1.047);rear.lineTo(-.72,.927);rear.lineTo(-1.06,.927);rear.closePath();
    const rearMesh=new THREE.Mesh(new THREE.ExtrudeGeometry(rear,{depth:.045,bevelEnabled:true,bevelSize:.008,bevelThickness:.008,bevelSegments:3,steps:1}),this.silver);
    rearMesh.position.z=1.44;rearMesh.name='rear-finger-notch';this.machine.add(rearMesh);this.meshes++;
    // Rectified from the red outlines in back-line.jpg: one L-shaped outer
    // shell surrounding the lower rear lamp cover. Coordinates are model units.
    const outer=new THREE.Shape();outer.moveTo(-1.10,1.475);outer.lineTo(1.10,1.475);outer.lineTo(1.10,.51);
    outer.lineTo(-.73,.51);outer.lineTo(-.73,-1.475);outer.lineTo(-1.10,-1.475);outer.closePath();
    const outerRounded=this.roundContour(outer,.07);
    const outerGeo=new THREE.ExtrudeGeometry(outerRounded,{depth:.035,bevelEnabled:false,steps:1,curveSegments:16});outerGeo.rotateX(-Math.PI/2);
    const outerShell=new THREE.Mesh(outerGeo,this.topSilver);outerShell.position.y=.918;outerShell.name='top-l-shaped-shell';this.machine.add(outerShell);this.meshes++;
    const chassisEdge=this.rolledEdge(outerRounded,.953,.042,.095,'chassis-rounded-edge');
    this.box(.27,.012,.15,.27,.962,-1.40,this.black,undefined,.002).name='front-top-recess';
    this.frontTrim(outerRounded,.953,'chassis-front-reflective-trim',16,chassisEdge);
    const chamberStart=this.machine.children.length;
    this.box(1.81,.010,1.97,.18,.892,.486,this.dark,undefined,.002);
    // back-line(1).jpg: an open rear recess receives the remote. Its top face
    // is flush with the hatch; its lower front lip drops into the rear wall.
    const hatch=new THREE.Shape();hatch.moveTo(-.90,-.98);hatch.lineTo(-.73,-.98);hatch.lineTo(-.73,-.50);
    hatch.lineTo(.75,-.50);hatch.lineTo(.75,-.98);hatch.lineTo(.90,-.98);
    // Open right-hand slot: the single sliding rod lives inside this cavity.
    hatch.lineTo(.90,.606);hatch.lineTo(-.31,.606);hatch.lineTo(-.31,.812);hatch.lineTo(.90,.812);
    hatch.lineTo(.90,.98);hatch.lineTo(-.90,.98);hatch.closePath();
    for(let i=0;i<5;i++){
      const points=this.roundedShape(.074,.99,.032).getPoints(16).map(v=>v.add(new THREE.Vector2(-.508+i*.095,.051)));hatch.holes.push(new THREE.Path(points));
    }
    hatch.holes.push(new THREE.Path(this.roundedShape(.666,1.016,.015).getPoints(16).map(v=>v.add(new THREE.Vector2(.445,.088)))));
    const hatchRounded=this.roundContour(hatch,.036);
    const hgeo=new THREE.ExtrudeGeometry(hatchRounded,{depth:.023,bevelEnabled:true,bevelSize:.005,bevelThickness:.004,bevelSegments:3,curveSegments:12});
    hgeo.rotateX(-Math.PI/2);const cover=new THREE.Mesh(hgeo,this.topSilver);cover.position.set(.18,.902,.486);cover.name='vented-lamp-cover';this.machine.add(cover);this.meshes++;
    const chamberEdge=this.rolledEdge(hatchRounded,.929,.018,.15,'lamp-chamber-rounded-edge');chamberEdge.position.set(.18,0,.486);
    const chamberTrim=this.frontTrim(hatchRounded,.929,'lamp-chamber-front-reflective-trim',12,chamberEdge);chamberTrim.position.set(.18,.929,.486);
    this.vents=new THREE.Group();this.vents.name='five-recessed-vent-emitters';this.machine.add(this.vents);
    // light.png: five triangular hot regions and irregular oval reflections.
    // Softness is inside the cavity texture; the silver lips occlude its edges.
    const ovals=[[[.70,.075]],[[.59,.07],[.86,.10]],[[.76,.10]],[[.66,.06],[.88,.07]],[[.84,.10]]];
    for(let i=0;i<5;i++){
      const c=document.createElement('canvas');c.width=96;c.height=640;const ctx=c.getContext('2d');
      const wash=ctx.createLinearGradient(0,0,96,0);wash.addColorStop(0,'#9b763d');wash.addColorStop(.35,'#c8ac77');wash.addColorStop(.63,'#c2a16a');wash.addColorStop(1,'#95703c');ctx.fillStyle=wash;ctx.fillRect(0,0,96,640);
      const hot=document.createElement('canvas');hot.width=96;hot.height=640;const hctx=hot.getContext('2d');hctx.fillStyle='#f6e8c5';
      hctx.beginPath();hctx.moveTo(49,125+i*4);hctx.lineTo(6,329+i*3);hctx.quadraticCurveTo(46,345+i*3,90,326+i*3);hctx.closePath();hctx.fill();
      for(const [y,r] of ovals[i]){hctx.beginPath();hctx.ellipse(47+(i%2)*6,y*640,22,r*640,.12,0,Math.PI*2);hctx.fill();}
      // Blur the light distribution itself, then composite into the continuously
      // luminous window; no separate white shapes sit on the dark glass.
      ctx.filter='blur(11px)';ctx.drawImage(hot,0,0);ctx.filter='none';
      const texture=new THREE.CanvasTexture(c);texture.colorSpace=THREE.SRGBColorSpace;
      const material=new THREE.MeshBasicMaterial({map:texture,color:new THREE.Color().setRGB(1.15,1.15,1.15),toneMapped:false});
      const emitter=new THREE.Mesh(new THREE.PlaneGeometry(.072,.973),material);emitter.rotation.x=-Math.PI/2;emitter.position.set(-.328+i*.095,.918,.435);emitter.name='vent-triangle-and-ovals-'+(i+1);this.vents.add(emitter);this.meshes++;
      emitter.userData.highlights={triangle:[[49,125+i*4],[6,329+i*3],[46,345+i*3],[90,326+i*3]],ovals:ovals[i]};
    }
    this.vents.visible=false;
    this.box(1.48,.012,.48,.19,.778,1.226,this.dark,undefined,.003).name='remote-recess-floor';
    this.box(1.43,.140,.460,.19,.859,1.226,this.black,undefined,.014).name='rear-control-panel';
    this.box(1.38,.006,.005,.19,.813,1.459,this.dark,undefined,.001);
    this.cylinder(.116,.035,-.31,.9465,1.23,new THREE.MeshStandardMaterial({color:0x258b43,roughness:.46}));
    this.cylinder(.083,.026,-.005,.942,1.23,this.dark);
    for(let i=0;i<28;i++){const a=i*Math.PI/14;this.box(.009,.019,.013,-.005+Math.cos(a)*.081,.953,1.23+Math.sin(a)*.081,this.black,undefined,.002);}
    this.cylinder(.071,.002,.70,.930,1.23,new THREE.MeshBasicMaterial({color:0x0b0e0d})).name='rear-recessed-button';
    const buttonRim=new THREE.Mesh(new THREE.TorusGeometry(.074,.003,8,40),this.black);buttonRim.rotation.x=Math.PI/2;buttonRim.position.set(.70,.932,1.23);this.machine.add(buttonRim);
    // The focus inset and grille have nearly equal depth in the marked photo.
    this.box(.67,.008,1.035,.625,.914,.391,this.dark,undefined,.002).name='focus-inset-border';
    const focusBase=new THREE.Shape();focusBase.moveTo(-.3275,-.51);focusBase.lineTo(.3275,-.51);focusBase.lineTo(.3275,.51);
    focusBase.lineTo(.32,.51);focusBase.lineTo(.32,.438);focusBase.lineTo(-.32,.438);focusBase.lineTo(-.32,.51);focusBase.lineTo(-.3275,.51);focusBase.closePath();
    const focusGeo=new THREE.ExtrudeGeometry(focusBase,{depth:.010,bevelEnabled:false,steps:1});focusGeo.rotateX(-Math.PI/2);
    const focusPlate=new THREE.Mesh(focusGeo,this.topSilver);focusPlate.position.set(.625,.915,.391);focusPlate.name='focus-base-with-leak-notch';this.machine.add(focusPlate);this.meshes++;
    this.box(.582,.010,.414,.625,.920,.155,this.topSilver,undefined,.002).name='focus-silver-pad';
    // The old pad top coincided exactly with its silver backing. Separate the
    // surfaces and use filtered relief for the grooves instead of tiny coplanar
    // strips, which flickered as the camera and reflected lighting changed.
    const grooves=document.createElement('canvas');grooves.width=64;grooves.height=512;const gc=grooves.getContext('2d');
    for(let y=0;y<512;y++){const v=Math.round(128+40*Math.cos(y/512*24*Math.PI*2));gc.fillStyle=`rgb(${v},${v},${v})`;gc.fillRect(0,y,64,1);}
    const grooveMap=new THREE.CanvasTexture(grooves);grooveMap.anisotropy=Math.min(4,this.renderer.capabilities.getMaxAnisotropy());
    this.focusPanelMaterial=new THREE.MeshStandardMaterial({color:0x111313,roughness:.86,metalness:.04,bumpMap:grooveMap,bumpScale:.001});
    this.box(.582,.018,.466,.625,.938,.600,this.focusPanelMaterial,undefined,.002).name='focus-black-pad';
    this.box(.052,.004,.003,.625,.950,.418,this.gray,undefined,.0007).rotation.y=-.5;
    this.box(1.23,.052,.202,.485,.901,GATE_Z,this.transportPlastic,undefined,.004).name='fixed-transport-throat';
    this.transportLeakMaterial=new THREE.MeshBasicMaterial({color:0xffe2aa,transparent:true,opacity:0,toneMapped:false});
    this.box(.64,.014,.065,.625,.913,-.086,this.transportLeakMaterial,undefined,.002).name='transport-underarm-light-slit';
    this.carriage=new THREE.Group();this.carriage.name='sliding-pull-push-arm';this.machine.add(this.carriage);
    // Red annotation: fixed throat. Cyan annotation: moving rail, completely
    // occluded to the left of the machine's side wall even when viewed above.
    this.armClip=new THREE.Plane(new THREE.Vector3(1,0,0),-1.105);
    const armMat=this.transportPlastic.clone();armMat.clippingPlanes=[this.armClip];
    const ribMat=this.transportPlastic.clone();ribMat.clippingPlanes=[this.armClip];
    this.box(2.00,.100,.130,.58,.885,GATE_Z,armMat,this.carriage,.007).name='single-internal-slide-rod';
    for(let i=0;i<4;i++)for(const sign of [-1,1]){const rib=this.box(.485,.011,.008,-.14+i*.48,.885,GATE_Z+.067,ribMat,this.carriage,.002);rib.rotation.z=sign*Math.atan2(.073,.48);}
    const grip=this.box(.35,.100,.205,1.55,.929,GATE_Z,this.black,this.carriage,.020);grip.name='ribbed-end-grip';
    const armFrame=this.roundedShape(.61,.455,.045);const hole=new THREE.Path();hole.moveTo(-.23,.16);hole.lineTo(.18,.16);hole.lineTo(.18,.047);hole.lineTo(.055,.047);hole.lineTo(-.002,-.083);hole.lineTo(-.17,-.145);hole.closePath();armFrame.holes.push(hole);
    const frameGeo=new THREE.ExtrudeGeometry(armFrame,{depth:.070,bevelEnabled:true,bevelSize:.006,bevelThickness:.004,bevelSegments:4,curveSegments:12,steps:1});
    const frame=new THREE.Mesh(frameGeo,this.dark);frame.position.set(1.42,.71,GATE_Z-.035);frame.name='sculpted-arm-end-frame';this.carriage.add(frame);this.meshes++;
    const knob=this.cylinder(.093,.018,1.60,.633,GATE_Z+.048,this.black,this.carriage);knob.rotation.x=Math.PI/2;
    for(let i=0;i<7;i++)this.box(.012,.049,.003,1.45+i*.029,.917,GATE_Z+.104,this.gray,this.carriage,.002);
    const label=document.createElement('canvas');label.width=128;label.height=80;const lc=label.getContext('2d');lc.strokeStyle='#d0c56e';lc.lineWidth=6;lc.lineJoin='round';lc.beginPath();lc.moveTo(14,67);lc.lineTo(45,13);lc.lineTo(73,67);lc.closePath();lc.stroke();lc.beginPath();lc.moveTo(44,34);lc.lineTo(44,49);lc.moveTo(44,56);lc.lineTo(44,59);lc.stroke();for(let i=0;i<3;i++){lc.beginPath();lc.moveTo(88+i*12,66);lc.bezierCurveTo(70+i*12,50,88+i*12,39,77+i*12,23);lc.stroke();}
    const labelTex=new THREE.CanvasTexture(label);labelTex.colorSpace=THREE.SRGBColorSpace;const decal=new THREE.Mesh(new THREE.PlaneGeometry(.155,.097),new THREE.MeshBasicMaterial({map:labelTex,transparent:true,depthWrite:false,opacity:.72}));decal.position.set(1.38,.578,GATE_Z+.041);this.carriage.add(decal);
    // Raise the whole chamber, keeping its remote and optical details flush.
    const chamberParts=this.machine.children.slice(chamberStart);this.lampChamber=new THREE.Group();this.lampChamber.name='raised-lamp-chamber';this.machine.add(this.lampChamber);for(const part of chamberParts)this.lampChamber.add(part);this.lampChamber.position.y=.12;
    for(const part of [rearMesh,cover,chamberEdge])this.dullViewerRim(part);
    // Front lens points away from the viewer; only its upper rim is visible.
    const lens=this.cylinder(.30,.34,.58,.64,-1.63,this.black);lens.rotation.x=Math.PI/2;
    for(let i=0;i<4;i++){const ring=this.cylinder(.31,.012,.58,.64,-1.48-i*.065,this.dark);ring.rotation.x=Math.PI/2;}
    this.box(.18,.105,.012,-.74,.25,1.488,this.dark,undefined,.011);
    this.box(.07,.065,.025,-.76,.25,1.502,this.gray,undefined,.008);
    const socket=this.box(.115,.072,.021,-.76,.25,1.52,this.black,undefined,.004);socket.rotation.x=.06;
    this.box(.005,.018,.002,-.782,.253,1.533,this.gray,undefined,.0004);
    const off=new THREE.Mesh(new THREE.TorusGeometry(.009,.0016,6,20),this.gray);off.position.set(-.738,.253,1.534);this.machine.add(off);
    for(const x of [-.92,.91]){const screw=this.cylinder(.018,.008,x,.54,1.495,this.dark);screw.rotation.x=Math.PI/2;this.box(.018,.002,.002,x,.54,1.502,this.gray,undefined,.0004);}
    const points=[new THREE.Vector3(-.85,.15,1.45),new THREE.Vector3(-1.3,.04,1.65),new THREE.Vector3(-1.6,-.02,2.2),new THREE.Vector3(-1.2,-.08,3.1)];
    this.machine.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),40,.027,8,false),this.dark));
    // Small side-slot bloom is independent of the projection shutter.
    const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(64,64,1,64,64,64);g.addColorStop(0,'rgba(255,224,167,.35)');g.addColorStop(.28,'rgba(255,210,143,.10)');g.addColorStop(1,'rgba(255,196,119,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
    this.glowMaterial=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:0});
    // Kept as a texture template for the small, occluded right-side slit only.
  }
  buildMagazine(){
    // The viewer-facing end stops at the same rear plane as the chassis.
    this.trayFirst=-12;this.trayLast=16;this.trayRear=1.49;
    this.box(.98,.105,3.10,1.58,.13,-.06,this.black,undefined,.04).name='magazine-base';
    const railMaterial=new THREE.MeshStandardMaterial({color:0x222624,roughness:.46,metalness:.12});
    const rail=new THREE.Group();rail.name='magazine-outer-wall';this.machine.add(rail);
    const rim=new THREE.Group();rim.name='magazine-upper-rim';this.machine.add(rim);
    // The guard has one narrow slit, just wide enough for the lower arm frame.
    const notchHalf=.07;rail.userData.notchWidth=notchHalf*2;
    for(const [front,back] of [[-1.59,GATE_Z-notchHalf],[GATE_Z+notchHalf,this.trayRear]]){
      const depth=back-front,z=(front+back)/2;
      this.box(.135,.535,depth,2.05,.4375,z,railMaterial,rail,.026);
      this.box(.145,.035,depth,2.05,.7175,z,railMaterial,rim,.008);
    }
    this.box(.135,.245,notchHalf*2,2.05,.2875,GATE_Z,railMaterial,rail,.012);
    this.box(.05,.06,3.04,1.14,.22,-.04,this.gray,undefined,.01);
    this.box(.71,.12,3.00,1.58,.30,-.04,this.dark,this.machine,.014);
    this.magazine=new THREE.Group();this.magazine.name='continuous-tray-cells';this.machine.add(this.magazine);
    this.slideFrames=[];this.cells=[];this.traySteps=0;this.cellSerial=0;
    for(let slot=this.trayFirst;slot<=this.trayLast;slot++)this.addCell(slot);
    this.activeSlide=this.makeSlide(this.cream);this.machine.add(this.activeSlide);
    this.incomingSlide=this.makeSlide(this.cream);this.machine.add(this.incomingSlide);
    this.reset();
  }
  addCell(slot){
    const cell=new THREE.Group();cell.userData.slot=slot;cell.userData.serial=this.cellSerial++;cell.position.z=GATE_Z+slot*SLIDE_PITCH;this.magazine.add(cell);
    const profile=new THREE.Shape();profile.moveTo(1.17,.26);profile.lineTo(1.17,.50);profile.lineTo(1.35,.795);
    profile.quadraticCurveTo(1.37,.83,1.42,.83);profile.lineTo(1.95,.83);profile.quadraticCurveTo(2.0,.83,2.0,.79);
    profile.lineTo(2.0,.26);profile.lineTo(1.87,.26);profile.lineTo(1.87,.46);profile.lineTo(1.77,.46);profile.lineTo(1.74,.26);
    profile.lineTo(1.65,.26);profile.lineTo(1.64,.46);profile.lineTo(1.33,.46);profile.lineTo(1.30,.26);profile.closePath();
    const divider=new THREE.Mesh(new THREE.ExtrudeGeometry(profile,{depth:.014,bevelEnabled:true,bevelThickness:.002,bevelSize:.002,bevelSegments:2,steps:1}),this.gray);
    divider.position.z=.052;divider.name='profiled-tray-divider';divider.receiveShadow=true;cell.add(divider);this.meshes++;
    const slide=this.makeSlide(this.cream);slide.position.set(1.57,.59,0);cell.add(slide);
    slide.visible=slot!==0;cell.userData.slide=slide;this.slideFrames.push(slide);this.cells.push(cell);return cell;
  }
  advanceCells(delta){for(const cell of this.cells)cell.position.z+=delta;}
  commitIndex(direction){
    // Commit while the wall shutter is closed. Existing cells keep their exact
    // positions; only the far-end cell is removed and a new near-end cell added.
    for(const cell of [...this.cells]){
      cell.userData.slot-=direction;
      if(cell.userData.slot<this.trayFirst||cell.userData.slot>this.trayLast){
        this.magazine.remove(cell);this.cells.splice(this.cells.indexOf(cell),1);this.slideFrames.splice(this.slideFrames.indexOf(cell.userData.slide),1);
        cell.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(o.material!==this.gray&&o.material!==this.cream)o.material.dispose();}});
      }
    }
    this.addCell(direction>0?this.trayLast:this.trayFirst);this.traySteps+=direction;
    this.canvas.dataset.traySteps=String(this.traySteps);this.canvas.dataset.recycleAt=String(this.cycle?.ms??0);
  }
  makeSlide(material){
    const slide=new THREE.Group();
    this.box(.60,.07,.036,0,.245,0,material,slide,.006);
    this.box(.60,.07,.036,0,-.245,0,material,slide,.006);
    this.box(.095,.44,.036,-.254,0,0,material,slide,.005);
    this.box(.095,.44,.036,.254,0,0,material,slide,.005);
    const filmMaterial=new THREE.MeshStandardMaterial({color:0x55331c,roughness:.38,metalness:0,transparent:true,opacity:.78,side:THREE.DoubleSide});
    const film=new THREE.Mesh(new THREE.PlaneGeometry(.414,.42),filmMaterial);slide.add(film);
    slide.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    return slide;
  }
  buildSideLight(){
    // Both lights live in the film entry slit. A passing mount catches their
    // grazing light on its two faces; neighbouring mounts can occlude it.
    this.slotMaterial=new THREE.MeshBasicMaterial({color:0xffe2aa,transparent:true,opacity:0,toneMapped:false});
    const slot=this.box(.014,.50,.13,1.084,.64,GATE_Z,this.slotMaterial,this.machine,.004);slot.name='side-light-slot';
    slot.userData.glowCorners=[[.008,.25,-.065],[.008,.25,.065],[.008,-.25,.065],[.008,-.25,-.065]];
    this.spillLamp=new THREE.SpotLight(0xffe2aa,0,1.3,.9,.8,2);
    this.spillLamp.position.set(1.078,.885,GATE_Z+.057);this.spillLamp.target.position.set(1.53,.81,GATE_Z);
    this.machine.add(this.spillLamp,this.spillLamp.target);
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.spillLamp.castShadow=true;this.spillLamp.shadow.mapSize.set(512,512);
    this.spillLamp.shadow.camera.near=.018;this.spillLamp.shadow.camera.far=1.4;
    this.spillLamp.shadow.bias=-.0002;this.spillLamp.shadow.normalBias=.003;
    this.spillReturn=new THREE.PointLight(0xffe2aa,0,.85,2);this.spillReturn.position.set(1.078,.69,GATE_Z-.057);this.machine.add(this.spillReturn);
    this.carriage.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
    // Small depth-tested bloom lies at the slot itself, not across the whole tray.
    this.sideGlowMaterial=this.glowMaterial.clone();this.sideGlowMaterial.opacity=0;
    const glow=new THREE.Sprite(this.sideGlowMaterial);glow.position.set(1.17,.93,GATE_Z);glow.scale.set(.65,.38,1);this.machine.add(glow);
    this.leak=0.48;
  }
  updateSideLight(){
    if(!this.spillLamp)return;
    const gain=(this.exposureGain??1)*this.emitterAmount;
    for(const vent of this.vents.children)vent.material.color.setScalar(.85*gain);
    // Source output has one exposure multiplier. Moving cards and the arm still
    // occlude the side spill through geometry and shadows, not extra gain curves.
    this.spillLamp.intensity=this.power*1.65*gain;
    this.spillReturn.intensity=this.power*.12*gain;
    this.transportLeakMaterial.color.setHex(0xffe2aa).multiplyScalar(.78*gain);this.transportLeakMaterial.opacity=this.power*.90;
    this.slotMaterial.color.setHex(0xffe2aa).multiplyScalar(.78*gain);this.slotMaterial.opacity=this.power*.42;
    this.sideGlowMaterial.opacity=0;
    this.canvas.dataset.leak=this.spillLamp.intensity.toFixed(3);
    this.canvas.dataset.exposureGain=(this.exposureGain??1).toFixed(4);this.canvas.dataset.emitterAmount=String(this.emitterAmount);
  }
  setTopReflectance(value){
    this.topReflectance=Math.max(0,Math.min(1,Number(value)||0));
    for(const mat of this.topMaterials){mat.color.copy(this.topBaseColor).multiplyScalar(this.topReflectance);mat.specularIntensity=mat.userData.diffuseOnly?0:this.topReflectance;}
    this.canvas.dataset.topReflectance=String(this.topReflectance);
    if(this.ambient)this.draw();
  }
  setEmitterAmount(value){this.emitterAmount=Math.max(0,Math.min(3,Number(value)||0));this.updateSideLight();this.draw();}
  setPitch(value){const pitch=Math.max(-12,Math.min(12,Number(value)||0));if(pitch!==this.pitch&&this.bounce)this.bounce.shadow.needsUpdate=true;this.pitch=pitch;this.machine.rotation.x=THREE.MathUtils.degToRad(this.pitch);this.canvas.dataset.pitch=String(this.pitch);this.draw();}
  lensPosition(){
    this.scene.updateMatrixWorld();
    const p=this.machine.localToWorld(new THREE.Vector3(.58,.72,-1.72)).project(this.camera),r=this.canvas.getBoundingClientRect();
    return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  }
  resize(){const w=this.canvas.clientWidth,h=this.canvas.clientHeight,dpr=Math.min(devicePixelRatio,1.5);if(!w||!h||w===this.viewWidth&&h===this.viewHeight&&dpr===this.viewDpr)return;this.viewWidth=w;this.viewHeight=h;this.viewDpr=dpr;if(this.renderer.getPixelRatio()!==dpr)this.renderer.setPixelRatio(dpr);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.draw();}
  illuminate(power,exposure,color=[.45,.42,.35],gain=1){
    this.power=power;this.light=exposure;this.exposureGain=gain;this.vents.visible=power>.01;
    this.glowMaterial.opacity=0;
    this.ambient.intensity=.018;
    this.bounce.color.setRGB(...color);this.bounce.intensity=Math.max(0,exposure)*.52;
    this.updateSideLight();this.draw();
  }
  mechanism(ms,reverse=false){
    const f=mechanismAt(ms,reverse);
    if(!this.cycle)this.cycle={ms:0,d:f.direction,offset:0,committed:false};
    const cycle=this.cycle;cycle.ms=ms;
    this.advanceCells(f.trayZ-cycle.offset);cycle.offset=f.trayZ;
    if(ms>=610&&!cycle.committed){this.commitIndex(f.direction);cycle.committed=true;}
    this.carriage.position.x=f.carriage*1.01;
    this.activeSlide.position.set(f.oldX,.59,GATE_Z+f.trayZ);
    this.activeSlide.visible=ms<390;
    this.incomingSlide.position.set(f.newX,.59,f.newZ);this.incomingSlide.visible=ms>=740;
    for(const cell of this.cells){const slot=cell.userData.slot+(cycle.committed?f.direction:0);cell.userData.slide.visible=slot===0?ms>=390:slot===f.direction?ms<740:true;}
    const impact=Math.exp(-Math.pow((ms-610)/65,2))+Math.exp(-Math.pow((ms-1167)/65,2));
    this.machine.rotation.z=Math.sin(ms*.14)*.0018*impact;
    this.machine.position.y=Math.sin(ms*.17)*.003*impact;
    this.leak=f.leak;this.updateSideLight();
    Object.assign(this.canvas.dataset,{mechanism:f.phase,carriage:f.carriage.toFixed(3),ratchet:f.trayZ.toFixed(3),oldX:f.oldX.toFixed(3),newX:f.newX.toFixed(3),newZ:f.newZ.toFixed(3)});this.draw();
  }
  reset(){
    // No completed-cycle tray reset, group translation, slot rebase or rollback.
    // A power-off interruption can finish a partial index while the lamp is off.
    if(this.cycle&&!this.cycle.committed&&this.cycle.offset!==0){
      this.advanceCells(-this.cycle.d*SLIDE_PITCH-this.cycle.offset);this.commitIndex(this.cycle.d);
    }
    this.cycle=null;this.carriage.position.x=0;this.activeSlide.position.set(.56,.59,GATE_Z);this.activeSlide.visible=true;this.incomingSlide.visible=false;
    for(const cell of this.cells)cell.userData.slide.visible=cell.userData.slot!==0;
    this.machine.rotation.z=0;this.machine.position.y=0;this.leak=.48;this.updateSideLight();
    Object.assign(this.canvas.dataset,{mechanism:'idle',carriage:'0',ratchet:'0'});this.draw();
  }
  beginFrame(){this.batchDepth=(this.batchDepth||0)+1;}
  endFrame(){if(this.batchDepth>0&&--this.batchDepth===0&&this.drawPending){this.drawPending=false;this.draw();}}
  draw(){
    if(this.batchDepth){this.drawPending=true;return;}
    if(this.armClip){this.machine.updateWorldMatrix(true,true);this.armClip.set(new THREE.Vector3(1,0,0),-1.105).applyMatrix4(this.machine.matrixWorld);}
    if(this.wallShadowScene&&this.bounce.shadow.needsUpdate){
      this.wallOccluders.rotation.x=this.machine.rotation.x;
      this.renderer.render(this.wallShadowScene,this.camera);
    }
    this.renderer.render(this.scene,this.camera);
  }
}

// Broad, spatially varying diffuse return from the actual image. It is rebuilt
// only on image/viewport changes; the shutter modulates this preblurred light.
export class WallLight {
  constructor(canvas){this.canvas=canvas;this.ctx=canvas.getContext('2d');this.amount=1;this.exposure=0;this.color=[.45,.42,.35];this.canvasBlur=supportsCanvasBlur();}
  sampleSource(source){
    const c=document.createElement('canvas');c.width=48;c.height=48;const ctx=c.getContext('2d'),im=ctx.createImageData(48,48);let sum=[0,0,0];
    for(let y=0;y<48;y++)for(let x=0;x<48;x++){
      const sx=Math.min(source.width-1,Math.floor((x+.5)/48*source.width)),sy=Math.min(source.height-1,Math.floor((y+.5)/48*source.height)),i=(sy*source.width+sx)*4,o=(y*48+x)*4;
      for(let k=0;k<3;k++){const linear=Math.max(0,source.data[i+k]);const v=Math.pow(Math.min(linear,2)/(1+Math.max(0,linear-1)),1/2.2);im.data[o+k]=v*255;sum[k]+=v;}im.data[o+3]=255;
    }ctx.putImageData(im,0,0);return{source:c,color:sum.map(v=>v/2304)};
  }
  setSource(source){Object.assign(this,this.sampleSource(source));this.rebuild();}
  layoutKey({w,h,sw,sh,centerY}){return[w,h,sw,sh,centerY].join(',');}
  setLayout(layout){
    Object.assign(this,layout);this.scale=Math.min(.5,800/this.w,600/this.h);const w=Math.ceil(this.w*this.scale),h=Math.ceil(this.h*this.scale);
    if(this.canvas.width!==w)this.canvas.width=w;if(this.canvas.height!==h)this.canvas.height=h;
  }
  resize(w,h,sw,sh,centerY=h*(w<600?.34:.31)){const layout={w,h,sw,sh,centerY};if(this.layoutKey(layout)===this.layoutKey(this))return;this.setLayout(layout);this.rebuild();}
  makeBuffer(source,layout){
    const scale=Math.min(.5,800/layout.w,600/layout.h),w=Math.ceil(layout.w*scale),h=Math.ceil(layout.h*scale);
    // Safari may silently ignore Canvas filters. Its fallback light buffer is
    // bounded to 512 pixels per side and blurred once before transport.
    const resolution=this.canvasBlur?1:Math.min(1,512/Math.max(w*3,h*3));
    const c=document.createElement('canvas');c.width=Math.ceil(w*3*resolution);c.height=Math.ceil(h*3*resolution);const ctx=c.getContext('2d');
    // Padding lets the halo travel with the film without exposing a buffer edge.
    const sw=layout.sw*scale*resolution,sh=layout.sh*scale*resolution,cx=w*1.5*resolution,cy=(h+layout.centerY*scale)*resolution;
    for(const [scale,blur,opacity] of [[2.4,sw*.28,.28],[1.45,sw*.10,.22],[1.03,sw*.028,.18]]){
      const sigma=Math.max(4*resolution,blur);ctx.globalAlpha=opacity;
      if(this.canvasBlur){ctx.filter=`blur(${sigma}px)`;ctx.drawImage(source,cx-sw*scale/2,cy-sh*scale/2,sw*scale,sh*scale);}
      else{
        const layer=document.createElement('canvas');layer.width=c.width;layer.height=c.height;const lc=layer.getContext('2d',{willReadFrequently:true});
        lc.drawImage(source,cx-sw*scale/2,cy-sh*scale/2,sw*scale,sh*scale);const pixels=lc.getImageData(0,0,layer.width,layer.height);
        blurLightPixels(pixels.data,layer.width,layer.height,sigma);lc.putImageData(pixels,0,0);ctx.drawImage(layer,0,0);
      }
    }if(this.canvasBlur)ctx.filter='none';ctx.globalAlpha=1;return c;
  }
  async prepare(source,layout){
    this.preparations??=new Map();const key=this.layoutKey(layout),cached=this.preparations.get(source);
    if(cached?.key===key)return cached.pending;
    const pending=(async()=>{const sampled=this.sampleSource(source),buffer=await snapshotLight(this.makeBuffer(sampled.source,layout));return{...sampled,layout,buffer};})();
    const entry={key,pending};this.preparations.set(source,entry);entry.value=await pending;
    for(const [old,item]of this.preparations)if(this.preparations.size>2&&old!==source&&item.value!==this.activePrepared){item.value?.buffer.close?.();this.preparations.delete(old);}
    if(cached?.value!==this.activePrepared)cached?.value?.buffer.close?.();return entry.value;
  }
  activate(prepared){this.activePrepared=prepared;this.setLayout(prepared.layout);this.source=prepared.source;this.color=prepared.color;this.buffer=prepared.buffer;}
  rebuild(){
    if(!this.w||!this.source)return;
    this.activePrepared=null;this.buffer=this.makeBuffer(this.source,this);this.draw(this.exposure);
  }
  beginFrame(){this.batchDepth=(this.batchDepth||0)+1;}
  endFrame(){if(this.batchDepth>0&&--this.batchDepth===0&&this.drawPending){this.drawPending=false;this.draw(this.exposure,this.pendingOptics);}}
  draw(exposure,optics){
    this.exposure=exposure;if(this.batchDepth){this.pendingOptics=optics;this.drawPending=true;return;}
    const ctx=this.ctx,w=this.canvas.width,h=this.canvas.height;ctx.clearRect(0,0,w,h);
    if(this.buffer){
      ctx.save();ctx.globalAlpha=Math.min(1,exposure*this.amount*.82);
      if(optics&&(optics.phase==='out'||optics.phase==='in')){
        // The diffuse return follows the moving, partially exposed film window.
        const dx=(optics.shift-optics.clipRight*.5)*this.sw*this.scale;
        ctx.translate(w*.5+dx,0);ctx.scale(.55+.45*(1-optics.clipRight),1);ctx.translate(-w*.5,0);
      }
      ctx.drawImage(this.buffer,-w,-h,w*3,h*3);ctx.restore();
    }
  }
}
