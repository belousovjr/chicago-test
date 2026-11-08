import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { NearbyMeshes } from '../src/nearbyMeshes.ts';

test('nearby cache includes hidden and large colliders by bounds and refreshes after travel or zoom', () => {
  const engine=new NullEngine(),scene=new Scene(engine),cache=new NearbyMeshes();
  const local=MeshBuilder.CreateBox('local',{},scene);local.checkCollisions=true;local.isVisible=false;
  const large=MeshBuilder.CreateBox('large',{width:200},scene);large.position.x=100;large.checkCollisions=true;
  const distant=MeshBuilder.CreateBox('distant',{},scene);distant.position.x=100;distant.checkCollisions=true;
  cache.setSources([local,large,distant]);
  const first=cache.get(Vector3.Zero(),12);
  assert.ok(first.includes(local)&&first.includes(large)&&!first.includes(distant));
  assert.equal(cache.get(new Vector3(3,0,0),12),first,'small movements reuse the list');
  assert.ok(cache.get(Vector3.Zero(),120).includes(distant),'zooming out expands the search immediately');
  assert.ok(cache.get(new Vector3(100,0,0),12).includes(distant),'teleport rebuilds the list');
  local.position.x=100;local.computeWorldMatrix(true);
  cache.invalidate();
  assert.ok(cache.get(new Vector3(100,0,0),12).includes(local),'editor transforms are reflected after invalidation');
  distant.setEnabled(false);cache.invalidate();
  assert.ok(!cache.get(new Vector3(100,0,0),12).includes(distant));
  distant.setEnabled(true);cache.invalidate();
  assert.ok(cache.get(new Vector3(100,0,0),12).includes(distant),'cell activation is respected');
  distant.dispose();cache.invalidate();
  assert.ok(!cache.get(new Vector3(100,0,0),12).includes(distant));
  cache.setSources([]);assert.deepEqual(cache.get(Vector3.Zero(),12),[]);
  scene.dispose();engine.dispose();
});

test('parent movement is reflected before the next render frame',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),cache=new NearbyMeshes();
  const parent=MeshBuilder.CreateBox('parent',{},scene),collider=MeshBuilder.CreateBox('child',{},scene);
  collider.parent=parent;collider.checkCollisions=true;collider.computeWorldMatrix(true);
  cache.setSources([collider]);assert.ok(cache.get(Vector3.Zero(),12).includes(collider));
  parent.position.x=100;cache.invalidate();
  assert.ok(!cache.get(Vector3.Zero(),12).includes(collider));
  assert.ok(cache.get(new Vector3(100,0,0),12).includes(collider));
  scene.dispose();engine.dispose();
});
