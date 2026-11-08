import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { visualCandidates } from '../src/sceneCandidates.ts';

test('draw candidates omit collision-only geometry but retain hidden LODs and collidable ground',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  const collider=MeshBuilder.CreateBox('collider',{},scene);collider.metadata={collisionOnly:true};collider.checkCollisions=true;
  const root=MeshBuilder.CreateBox('editor-root',{},scene);root.checkCollisions=true;root.collisionGroup=2;
  const lod=MeshBuilder.CreateBox('hidden-lod',{},scene);lod.isVisible=false;
  const ground=MeshBuilder.CreateBox('ground',{},scene);ground.checkCollisions=true;
  const candidates=visualCandidates(scene.meshes);
  assert.deepEqual(candidates.data,[lod,ground]);assert.equal(candidates.length,2);
  assert.ok(scene.meshes.includes(collider) && scene.meshes.includes(root),'physics sources remain available');
  lod.isVisible=true;assert.ok(candidates.data.includes(lod),'LOD activation needs no candidate rebuild');
  const added=MeshBuilder.CreateBox('new-model',{},scene);assert.ok(visualCandidates(scene.meshes).data.includes(added));
  scene.dispose();engine.dispose();
});

test('diagnostic category switches are independent and fully reversible',async()=>{
  const {createPerformanceFlags}=await import('../src/performanceControls.ts');
  const engine=new NullEngine(),scene=new Scene(engine),flags=createPerformanceFlags();
  const city=MeshBuilder.CreateBox('city',{},scene);city.metadata={worldId:'building'};
  const tree=MeshBuilder.CreateBox('tree',{},scene);tree.metadata={worldId:'tree',profile:'tree'};
  const water=MeshBuilder.CreateBox('water',{},scene);water.metadata={procedural:true,surface:'#517d85'};
  const beacon=MeshBuilder.CreateBox('beacon',{},scene);beacon.metadata={procedural:true,beacon:true};
  const hero=MeshBuilder.CreateBox('hero',{},scene);
  assert.equal(visualCandidates(scene.meshes,flags).length,5);
  flags.city=false;assert.deepEqual(visualCandidates(scene.meshes,flags).data,[tree,water,beacon,hero]);
  flags.trees=flags.water=flags.beacons=false;
  assert.deepEqual(visualCandidates(scene.meshes,flags).data,[hero]);
  assert.equal(visualCandidates(scene.meshes,createPerformanceFlags()).length,5);
  assert.equal(scene.meshes.length,5,'diagnostic switches never destroy scene objects');
  scene.dispose();engine.dispose();
});

test('active candidates skip hidden LODs before readiness checks and follow visibility changes without rebuilding', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const near = MeshBuilder.CreateBox('near', {}, scene), far = MeshBuilder.CreateBox('far', {}, scene);
  far.isVisible = false;
  const candidates = visualCandidates(scene.meshes);
  const buffer = candidates.active();
  assert.deepEqual(buffer.data, [near]);
  near.isVisible = false; far.isVisible = true;
  assert.equal(candidates.active(), buffer, 'reuse the frame buffer');
  assert.deepEqual(buffer.data, [far]);
  far.setEnabled(false);
  assert.equal(candidates.active().length, 0);
  far.setEnabled(true); far.visibility = 0;
  assert.equal(candidates.active().length, 0);
  far.visibility = 1;
  assert.deepEqual(candidates.active().data, [far]);
  assert.equal(scene.meshes.length, 2, 'physics and LOD sources stay intact');
  scene.dispose(); engine.dispose();
});
