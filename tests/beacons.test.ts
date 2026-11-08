import '@babylonjs/core/Meshes/instancedMesh.js';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { Beacons } from '../src/beacons.ts';
import { buildArchitecture, spireTips, PROFILES } from '../src/architecture.ts';

test('beacons sit on persistent spire tips, share geometry and pulse without lights', () => {
  const engine = new NullEngine(), scene = new Scene(engine), beacons = new Beacons(scene);
  const material = new StandardMaterial('body', scene);
  const phases = new Set<number>();
  for (const profile of PROFILES) {
    const root = new Mesh(profile, scene); root.scaling.set(60, 200, 60);
    const template = { id: profile, name: profile, profile, kind: 'building' as const, color: '#ffffff', size: [60, 200, 60] as [number, number, number], lodDistances: [100, 200] };
    beacons.add(root, template);
    const markers = root.getChildMeshes().filter(mesh => mesh.name.endsWith('-beacon'));
    const cores = root.getChildMeshes().filter(mesh => mesh.name.endsWith('-beacon-core'));
    assert.equal(cores.length, markers.length);
    for (const [i, core] of cores.entries()) {
      assert.deepEqual(core.position.asArray(), markers[i].position.asArray());
      assert.equal(core.instancedBuffers.beaconPhase, markers[i].instancedBuffers.beaconPhase);
      assert.equal(core.instancedBuffers.beaconPhase, cores[0].instancedBuffers.beaconPhase, 'all tips on a building blink together');
      assert.ok(core.instancedBuffers.beaconPhase >= 0 && core.instancedBuffers.beaconPhase < 2);
      phases.add(core.instancedBuffers.beaconPhase);
      assert.equal(core.material.getActiveTextures().length, 0);
      assert.ok(core.getTotalVertices() > 4, 'the beacon has a solid bulb as well as a billboard');
    }
    assert.equal(markers.length, spireTips(profile).length);
    const levels = buildArchitecture(template, scene, material, material);
    for (const marker of markers) {
      assert.equal(marker.isPickable, false); assert.equal(marker.checkCollisions, false);
      assert.equal(marker.material.getActiveTextures().length, 0);
      for (const level of levels) {
        const positions = level.getVerticesData('position');
        assert.ok(Array.from({ length: positions.length / 3 }, (_, i) => i * 3).some(i =>
          Math.abs(positions[i] - marker.position.x) < .051 && Math.abs(positions[i + 1] - marker.position.y) < 1e-6 && Math.abs(positions[i + 2] - marker.position.z) < .051), `${profile}: spire stays under beacon at every LOD`);
      }
    }
    levels.forEach(level => level.dispose());
    root.dispose();
  }
  const low = new Mesh('low', scene); low.scaling.set(30, 40, 30);
  beacons.add(low, { id: 'low', name: 'low', kind: 'building', profile: 'deco', size: [30, 40, 30], color: '#ffffff' });
  assert.equal(low.getChildMeshes().length, 0);
  const red = scene.getMaterialByName('spire-beacon') as ShaderMaterial;
  assert.equal(red.alphaMode, Constants.ALPHA_ADD);
  assert.equal(red.disableDepthWrite, true);
  assert.equal(red.depthFunction, Constants.LEQUAL);
  assert.ok(phases.size >= 4, 'different buildings have independent phases');
  beacons.update(.4); beacons.update(100);
  assert.equal(scene.lights.length, 0);
  assert.equal(scene.meshes.filter(mesh => mesh.name === 'spire-beacon-source').length, 1);
  scene.dispose(); engine.dispose();
});
