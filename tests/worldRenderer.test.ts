import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { WorldRenderer } from '../src/worldRenderer.ts';
import { CityMaterials } from '../src/cityMaterials.ts';
import { Beacons } from '../src/beacons.ts';
import type { WorldData } from '../src/world.ts';

function setup() {
  const engine=new NullEngine(),scene=new Scene(engine),materials=new CityMaterials(scene,'/');
  const world: WorldData={version:3,spawn:[0,1,0],templates:[{id:'box',name:'Building',kind:'building',size:[10,20,10],color:'#aaaaaa',profile:'box',lodDistances:[30,100]}],objects:[
    {id:'first',templateId:'box',position:[0,10,0],yaw:0},
    {id:'second',templateId:'box',position:[20,10,0],yaw:0},
  ]};
  const city=new WorldRenderer(scene,materials,new Beacons(scene),world);
  return {engine,scene,city};
}

test('renderer owns shared instances and rebuild replaces roots without accumulating meshes',()=>{
  const {engine,scene,city}=setup();city.rebuild(false);
  const roots=[...city.meshes.values()],count=scene.meshes.length;
  const prototype=city.modelLevels.get(roots[0])![0].sourceMesh;
  assert.equal(city.modelLevels.get(roots[1])![0].sourceMesh,prototype,'identical template/tint variants share geometry');
  assert.ok(roots.every(root=>root.getChildMeshes().some(m=>m.metadata?.collisionOnly && m.checkCollisions)));
  city.rebuild(false);assert.ok(roots.every(root=>root.isDisposed()));assert.ok(prototype.isDisposed());
  assert.equal(scene.meshes.length,count);assert.equal(city.meshes.size,2);
  const first=city.meshes.get('first')!;city.removeMesh(first);
  assert.ok(first.isDisposed());assert.equal(city.modelLevels.has(first),false);assert.equal(city.meshes.has('first'),false);
  scene.dispose();engine.dispose();
});

test('cell activation and LOD updates keep collision roots independent of visual levels',()=>{
  const {engine,scene,city}=setup();city.rebuild(false);
  assert.equal(city.updateActiveCell(Vector3.Zero(),false),true);assert.equal(city.updateActiveCell(Vector3.Zero(),false),false);
  city.updateLODs(Vector3.Zero(),Vector3.Zero(),false,null,-1,0);city.lodTransitions.settle();
  assert.equal(city.meshes.get('first')!.metadata.lod,0);
  const far=new Vector3(1000,0,1000);city.updateActiveCell(far,false);
  assert.ok([...city.meshes.values()].every(root=>!root.isEnabled()));
  city.updateActiveCell(Vector3.Zero(),false);assert.ok([...city.meshes.values()].every(root=>root.isEnabled()));
  assert.equal(city.updateActiveCell(far,true),false,'editor does not cell-cull the map');
  scene.dispose();engine.dispose();
});

test('window mapping uses actual object height and refits after editor scaling', () => {
  const {engine,scene,city}=setup(); city.rebuild(true);
  const root=city.meshes.get('first')!;
  const old=city.modelLevels.get(root)![0].sourceMesh;
  root.scaling.y=8; city.updateCellCoverage(root);
  const shorter=city.modelLevels.get(root)![0].sourceMesh;
  assert.notEqual(shorter,old);
  assert.notEqual(root.metadata.windowMapping,city.meshes.get('second')!.metadata.windowMapping);
  assert.equal(root.getChildMeshes().filter(m=>m.metadata?.collisionOnly).length,1);
  root.scaling.y=20; city.updateCellCoverage(root);
  assert.equal(city.modelLevels.get(root)![0].sourceMesh,old,'restoring height reuses shared geometry');
  scene.dispose();engine.dispose();
});

test('trees select three LODs at close distances and the distant model is tiny',()=>{
  const {engine,scene,city}=setup();
  city.world.templates=[{id:'tree',name:'Tree',kind:'obstacle',profile:'tree',size:[5,8,5],color:'#648263',lodDistances:[90]}];
  city.world.objects=[{id:'test-tree',templateId:'tree',position:[0,4,0],yaw:0}];
  city.rebuild(true);
  const root=city.meshes.get('test-tree')!,levels=city.modelLevels.get(root)!;
  assert.equal(levels.length,3,'old saved templates also gain the distant LOD');
  assert.ok(levels[2]!.getTotalIndices()/3<=28);
  for(const [distance,lod] of [[5,0],[40,1],[90,2]]) {
    const eye=new Vector3(0,4,-distance!);
    city.updateLODs(eye,eye,true,null,-1,0);
    assert.equal(root.metadata.lod,lod);
  }
  scene.dispose();engine.dispose();
});

test('stationary LOD requests are cached, while edits and movement invalidate them',()=>{
  const {engine,scene,city}=setup();city.rebuild(true);
  const original=city.lodTransitions.request.bind(city.lodTransitions);let requests=0;
  city.lodTransitions.request=(...args)=>{requests++;original(...args);};
  const eye=Vector3.Zero();city.updateLODs(eye,eye,true,null,-1,0);
  const initial=requests;assert.ok(initial>0);
  city.updateLODs(eye,eye,true,null,-1,0);assert.equal(requests,initial);
  eye.x=1;city.updateLODs(eye,eye,true,null,-1,0);assert.ok(requests>initial);
  const moved=requests;city.updateCellCoverage(city.meshes.get('first')!);
  city.updateLODs(eye,eye,true,null,-1,0);assert.ok(requests>moved);
  const edited=requests;city.updateLODs(eye,eye,true,null,-1,1);assert.ok(requests>edited,'night changes furniture visibility');
  scene.dispose();engine.dispose();
});
