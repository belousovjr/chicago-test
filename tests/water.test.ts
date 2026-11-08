import '@babylonjs/core/Collisions/collisionCoordinator.js';
import { NearbyMeshes } from '../src/nearbyMeshes.ts';
import { updateStreetDetailLODs } from '../src/streets.ts';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { WATER_LEVEL, riverbedElevation, riverbedDepth } from '../src/water.ts';
import { drawChicagoStreets } from '../src/streets.ts';
import chicago from '../src/generated/chicago.json' with { type: 'json' };

const area = ([a,b,c]) => Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;

test('riverbed covers all water, has bounded relief and supports collisions', () => {
  const data = chicago.environment;
  assert.ok(Math.abs(data.waterbed.reduce((sum,t)=>sum+area(t),0)-data.water.reduce((sum,t)=>sum+area(t),0))<1e-5);
  const engine = new NullEngine(), scene = new Scene(engine), material = new StandardMaterial('ground',scene);
  const beds = drawChicagoStreets(scene,()=>material).meshes.filter(mesh=>mesh.name.includes('#6a644e'));
  assert.ok(beds.length>0 && beds.length<50);
  const heights = [];
  for (const bed of beds) {
    assert.equal(bed.checkCollisions,true);
    const positions=bed.getVerticesData('position');
    for(let i=0;i<positions.length;i+=3) {
      heights.push(positions[i+1]);
      assert.ok(Math.abs(positions[i+1]-riverbedElevation(positions[i],positions[i+2]))<1e-5);
    }
  }
  assert.ok(Math.max(...heights)-Math.min(...heights)>15);
  assert.ok(Math.max(...heights)<=WATER_LEVEL-.99 && Math.min(...heights)>WATER_LEVEL-19);
  const bankHeights = [];
  for (const ring of data.shorelines) for (const [x,z] of ring) {
    const height = riverbedElevation(x,z);
    bankHeights.push(height);
    assert.ok(height<=WATER_LEVEL-1 && height>=WATER_LEVEL-3, 'sand starts well underwater and overlaps the wall base');
  }
  assert.ok(Math.max(...bankHeights)-Math.min(...bankHeights)>1.4, 'sand meets the banks along an uneven line');
  assert.ok(Math.min(...heights)<WATER_LEVEL-17, 'the channel interior is substantially deeper than its banks');
  const tri=[...data.water].sort((a,b)=>area(b)-area(a))[0];
  const x=tri.reduce((sum,p)=>sum+p[0],0)/3,z=tri.reduce((sum,p)=>sum+p[1],0)/3;
  const ray=new Ray(new Vector3(x,WATER_LEVEL-.1,z),Vector3.Down(),25);
  assert.ok(beds.some(bed=>ray.intersectsMesh(bed).hit));
  scene.dispose();engine.dispose();
});

test('bank descends at 45 degrees then rounds into the channel', () => {
  for (const distance of [0, 3, 6, 12]) assert.equal(riverbedDepth(distance), distance);
  assert.ok(Math.abs((riverbedDepth(12.001)-riverbedDepth(12))/.001-1)<.001);
  assert.ok(riverbedDepth(30)>17 && riverbedDepth(100)<=18);
});

test('long concrete banks have enough bed vertices to show sediment waves', () => {
  const segments = chicago.environment.shorelines.flatMap(ring => ring.slice(1).map((b,i) => [ring[i],b]));
  const length = ([a,b]) => Math.hypot(b[0]-a[0],b[1]-a[1]);
  const [a,b] = segments.sort((a,b)=>length(b)-length(a))[0];
  const dx=b[0]-a[0], dz=b[1]-a[1], size=Math.hypot(dx,dz);
  const distances = chicago.environment.waterbed.flat().filter(p =>
    Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)/size<1e-6
  ).map(p=>((p[0]-a[0])*dx+(p[1]-a[1])*dz)/size).filter(d=>d>=0 && d<=size).sort((a,b)=>a-b);
  assert.ok(distances.length>size/2);
  for(let i=1;i<distances.length;i++) assert.ok(distances[i]-distances[i-1]<=2.001);
});


test('riverbed renders only below water while surface becomes translucent', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const materials = new Map();
  const meshes = drawChicagoStreets(scene, color => {
    if (!materials.has(color)) materials.set(color, new StandardMaterial(color, scene));
    return materials.get(color);
  }).meshes;
  const beds = meshes.filter(mesh => mesh.name.includes('#6a644e'));
  const water = materials.get('#517d85');
  const camera = new FreeCamera('water-test', new Vector3(0, WATER_LEVEL + 3, 0), scene);
  camera.minZ = 1;
  const update = () => { camera.getViewMatrix(true); scene.onBeforeCameraRenderObservable.notifyObservers(camera); };
  update();
  assert.ok(beds.every(mesh => !mesh.isVisible && mesh.checkCollisions));
  assert.equal(water.alpha, 1);
  camera.position.y = WATER_LEVEL + .01;
  update();
  assert.ok(beds.every(mesh => mesh.isVisible), 'bed is ready when the near plane first crosses water');
  assert.equal(water.alpha, 1, 'water stays opaque while the camera origin is above it');
  camera.position.y = WATER_LEVEL - .001;
  update();
  assert.ok(beds.every(mesh => mesh.isVisible));
  assert.equal(water.alpha, .95);
  camera.position.y = WATER_LEVEL + 3;
  update();
  assert.ok(beds.every(mesh => !mesh.isVisible));
  assert.equal(water.alpha, 1);
  meshes[0].dispose();
  assert.equal(scene.onBeforeCameraRenderObservable.hasObservers(), false);
  scene.dispose(); engine.dispose();
});


test('bank walls block the player along the entire river, including beside bridges', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.collisionsEnabled = true;
  const material = new StandardMaterial('bank-test', scene);
  const meshes = drawChicagoStreets(scene, () => material).meshes;
  const body = new Mesh('player-probe',scene);
  body.ellipsoid.set(.35,.9,.35); body.ellipsoidOffset.set(0,.9,0);
  const nearby = new NearbyMeshes();
  nearby.setSources(meshes.filter(mesh => mesh.checkCollisions));
  updateStreetDetailLODs(meshes, Vector3.Zero());
  assert.ok(meshes.filter(mesh=>mesh.name.includes('#868b83') && mesh.metadata.detailLayer==='world').every(mesh=>mesh.isVisible && mesh.checkCollisions));
  let checked=0;
  for (const [rings,y] of [[chicago.environment.shorelines,-6], [chicago.environment.terraceWalls,-3.7], [chicago.environment.terraceWalls,null], [chicago.environment.shorelines,null], [chicago.environment.bridgeAbutments,null]]) {
    for (const ring of rings) for(let i=1;i<ring.length;i++) {
      const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
      if(length<2)continue;
      for (const t of [.01, .5, .99]) {
      const x=a[0]+dx*t,z=a[1]+dz*t;
      const footY = y ?? riverbedElevation(x,z) + .05;
      for(const side of [-1,1]) {
        const nx=-dz/length*side,nz=dx/length*side;
        body.position.set(x+nx,footY,z+nz);body.computeWorldMatrix(true);
        const steps = t === .5 ? 20 : 1;
        for (let step=0;step<steps;step++) {
          body.surroundingMeshes = nearby.get(body.position,12);
          body.computeWorldMatrix(true);
          body.moveWithCollisions(new Vector3(-nx*2/steps,0,-nz*2/steps));
        }
        assert.ok(t === .5 ? (body.position.x-x)*nx+(body.position.z-z)*nz>.25 : Math.hypot(body.position.x-x-nx,body.position.z-z-nz)<1.95, 'crossed bank at '+[x,footY,z,side,t]);
        checked++;
      }
      }
    }
  }
  assert.ok(checked>0);
  scene.dispose();engine.dispose();
});
