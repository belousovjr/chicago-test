import { test, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { buildTree } from '../src/treeGeometry.ts';
import { CityMaterials } from '../src/cityMaterials.ts';

test('tree variants are repeatable, retain their crown at each LOD, and reduce geometry', () => {
  const engine=new NullEngine(),scene=new Scene(engine),bark=new StandardMaterial('bark',scene),leaf=new StandardMaterial('leaves',scene);
  const a=buildTree(scene,bark,leaf,3,1),b=buildTree(scene,bark,leaf,3,1),c=buildTree(scene,bark,leaf,3,2);
  assert.deepEqual(a[0]!.getVerticesData('position'),b[0]!.getVerticesData('position'));
  assert.notDeepEqual(a[0]!.getVerticesData('position'),c[0]!.getVerticesData('position'));
  let count=Infinity;
  for(const mesh of a) {
    const triangles=mesh.getTotalIndices()/3;
    assert.ok(triangles<count && triangles<400);count=triangles;
    const bounds=mesh.getBoundingInfo().boundingBox;
    assert.ok(bounds.maximum.y>.4 && bounds.minimum.y<=-.49);
    assert.ok(mesh.getVerticesData('normal')!.every(Number.isFinite));
    assert.equal(mesh.subMeshes.length,2,'only bark and foliage draw groups');
  }
  const positions=a[2]!.getVerticesData('position')!, indices=a[2]!.getIndices()!;
  let topCover=false;
  for(let i=0;i<indices.length;i+=3) {
    const [x,y,z]=indices.slice(i,i+3).map(index=>index*3);
    if([x,y,z].every(index=>Math.abs(positions[index!+1]!-.15)<1e-5)) {
      const area=(positions[y!]!-positions[x!]!)*(positions[z!+2]!-positions[x!+2]!)-(positions[z!]!-positions[x!]!)*(positions[y!+2]!-positions[x!+2]!);
      if(Math.abs(area)>.1) topCover=true;
    }
  }
  assert.ok(topCover,'distant crown has horizontal foliage visible from above');
  const materials=new CityMaterials(scene,'/'),foliage=materials.get('#668353','foliage');
  assert.equal(foliage.transparencyMode,StandardMaterial.MATERIAL_ALPHATEST);
  assert.ok(foliage.diffuseTexture!.hasAlpha);
  assert.ok(foliage.useAlphaFromDiffuseTexture);
  assert.equal(foliage.needAlphaBlending(),false);
  assert.equal(materials.get('#668353','foliage'),foliage);
  scene.dispose();engine.dispose();
});

test('tree silhouettes vary substantially and only the narrow trunk has collision geometry', async () => {
  const { attachCollisionGeometry } = await import('../src/architecture.ts');
  const { Mesh } = await import('@babylonjs/core/Meshes/mesh.js');
  const engine=new NullEngine(),scene=new Scene(engine),bark=new StandardMaterial('bark',scene),leaf=new StandardMaterial('leaf',scene);
  const widths=[];
  for(let variant=0;variant<6;variant++) {
    const [tree]=buildTree(scene,bark,leaf,1,variant);
    const bounds=tree!.getBoundingInfo().boundingBox;
    widths.push(bounds.maximum.x-bounds.minimum.x);
    const root=new Mesh('tree-root',scene);
    const collider=attachCollisionGeometry(root,tree!);
    const box=collider.getBoundingInfo().boundingBox;
    assert.ok(box.maximumWorld.x-box.minimumWorld.x<.061);
    assert.ok(box.maximumWorld.z-box.minimumWorld.z<.061);
    assert.ok(box.maximumWorld.y<=.121,'collider stops below the leafy crown');
    assert.equal(collider.geometry,tree!.metadata.collisionSource.geometry);
    assert.equal(collider.subMeshes.length,1);
  }
  assert.ok(Math.max(...widths)/Math.min(...widths)>1.4,'wide and narrow crowns have clearly different silhouettes');
  scene.dispose();engine.dispose();
});


test('distant crown planes always intersect along the trunk axis for every variant', () => {
  const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('tree',scene);
  const original=Mesh.MergeMeshes;
  let checked=0;
  const spy=mock.method(Mesh,'MergeMeshes',(...args: Parameters<typeof Mesh.MergeMeshes>)=>{
    const crowns=args[0].filter(mesh=>mesh.name==='tree-crown');
    if(crowns.length) {
      assert.equal(crowns.length,3);
      for(const plane of crowns) {
        assert.equal(plane.position.x,0);
        assert.equal(plane.position.z,0);
      }
      assert.equal(crowns.filter(mesh=>mesh.rotation.x===0).length,2);
      checked++;
    }
    return original(...args);
  });
  try {
    for(let variant=0;variant<6;variant++) buildTree(scene,material,material,3,variant).forEach(mesh=>mesh.dispose());
    assert.equal(checked,6);
  } finally {spy.mock.restore();scene.dispose();engine.dispose();}
});
