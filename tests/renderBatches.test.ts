import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder.js';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial.js';
import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera.js';
import {Vector3} from '@babylonjs/core/Maths/math.vector.js';
import {DitheredTileFadeMaterialPlugin} from '@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin.js';
import {RenderBatches} from '../src/renderBatches.ts';
import {visualCandidates} from '../src/sceneCandidates.ts';

test('batches preserve transformed geometry, material groups, fades and live edits without changing pick/collision sources',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,0,-20),scene);camera.setTarget(Vector3.Zero());scene.updateTransformMatrix();
 const material=new StandardMaterial('wall',scene);DitheredTileFadeMaterialPlugin.GetOrCreate(material);
 const sources=[0,1].map(i=>{const m=MeshBuilder.CreateBox(`building${i}`,{},scene);m.material=material;m.position.x=i*2;m.metadata={worldId:m.name,shadowCaster:true};m.checkCollisions=true;return m;});
 const batches=new RenderBatches(scene,sources);batches.update(Vector3.Zero(),Vector3.Down());
 assert.equal(batches.mesh.getTotalVertices(),48);assert.equal(batches.mesh.subMeshes.length,1);assert.equal(batches.mesh.subMeshes[0]!.indexCount,72);
 assert.equal(batches.shadow.subMeshes[0]!.indexCount,72);
 assert.deepEqual(visualCandidates(scene.meshes).active().data,[batches.mesh]);
 assert.ok(sources.every(m=>m.isPickable&&m.checkCollisions&&m.isEnabled()));
 DitheredTileFadeMaterialPlugin.GetOrCreate(material).setFadeBounds(sources[0]!,.25,.75);batches.update(Vector3.Zero(),Vector3.Down());
 assert.deepEqual(Array.from(batches.mesh.getVerticesData('batchFade')!.slice(0,2)),[.25,.75]);
 sources[0]!.isVisible=false;batches.update(Vector3.Zero(),Vector3.Down());assert.equal(batches.mesh.subMeshes[0]!.indexCount,36);
 sources[0]!.isVisible=true;sources[0]!.position.x=5;scene.incrementRenderId();assert.equal(batches.update(Vector3.Zero(),Vector3.Down()),true,'geometry edits invalidate cached shadows');assert.equal(batches.mesh.subMeshes[0]!.indexCount,72);
 assert.equal(batches.mesh.getVerticesData('position')![0],5.5);
 sources[1]!.setEnabled(false);batches.update(Vector3.Zero(),Vector3.Down());assert.equal(batches.mesh.subMeshes[0]!.indexCount,36);
 batches.dispose();assert.ok(sources.every(m=>!m.isDisposed()&&!m.metadata.renderSource));scene.dispose();engine.dispose();
});

test('offscreen geometry is absent from color batches but still casts shadows, and empty batches are invisible',()=>{
 const engine=new NullEngine(),scene=new Scene(engine),camera=new FreeCamera('camera',new Vector3(0,0,-20),scene);camera.setTarget(Vector3.Zero());scene.updateTransformMatrix();
 const empty=new RenderBatches(scene,[]);assert.equal(empty.mesh.isVisible,false);assert.equal(empty.shadow.isVisible,false);empty.dispose();
 const material=new StandardMaterial('wall',scene);DitheredTileFadeMaterialPlugin.GetOrCreate(material);
 const source=MeshBuilder.CreateBox('offscreen',{},scene);source.position.x=200;source.material=material;source.metadata={shadowCaster:true};scene.incrementRenderId();
 const batches=new RenderBatches(scene,[source]);batches.update(Vector3.Zero(),Vector3.Down());assert.equal(batches.mesh.isVisible,false);assert.equal(batches.shadow.isVisible,true);
 batches.update(Vector3.Zero(),Vector3.Down(),0,false);camera.fov=3.1;scene.updateTransformMatrix();batches.update(Vector3.Zero(),Vector3.Down(),0,false);assert.ok(batches.mesh.isVisible,'projection changes invalidate culling even with a stationary camera');
 source.position.x=0;source.rotation.y=Math.PI/4;scene.incrementRenderId();batches.update(Vector3.Zero(),Vector3.Down());assert.ok(batches.mesh.isVisible);
 const normal=batches.mesh.getVerticesData('normal')!;assert.ok(Math.abs(Math.hypot(normal[0]!,normal[1]!,normal[2]!)-1)<.01,'packed normals remain unit vectors');
 batches.dispose();scene.dispose();engine.dispose();
});
