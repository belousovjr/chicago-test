import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { DitheredTileFadeMaterialPlugin } from '@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { LodTransitions, predictLodEye, lodDistance } from '../src/lodTransitions.ts';

test('LOD fades are complementary, reversible, budgeted and independent for shared instances', () => {
  const engine = new NullEngine(), scene = new Scene(engine), transitions = new LodTransitions();
  const material = new StandardMaterial('shared', scene);
  const plugin = DitheredTileFadeMaterialPlugin.GetOrCreate(material);
  const source = MeshBuilder.CreateBox('source', {}, scene); source.material = material;
  const groups = Array.from({ length: 20 }, (_, i) => [source.createInstance(`near${i}`), source.createInstance(`far${i}`)]);
  const bounds = (mesh) => { const value = { lowerBound: 0, upperBound: 0 }; assert.ok(plugin.getFadeBoundsToRef(mesh, value)); return value; };
  for (const levels of groups) { transitions.request(levels, levels, 0); transitions.request(levels, levels, 1); }
  transitions.update(0.016); transitions.update(0.09);
  assert.equal(groups.filter(levels => levels[1].isVisible).length, 4, 'only four groups start on a fast frame');
  const [near, far] = groups[0];
  assert.equal(bounds(near).upperBound, bounds(far).lowerBound);
  assert.ok(bounds(near).upperBound > 0 && bounds(near).upperBound < 1);
  transitions.opacity(groups[0], 0.4);
  assert.ok(Math.abs(bounds(far).upperBound - 0.4) < 1e-6);
  assert.equal(bounds(groups[1][1]).upperBound, 1, 'sibling opacity stays unchanged');
  transitions.request(groups[0], groups[0], 0);
  transitions.update(0.2);
  assert.equal(near.isVisible, true); assert.equal(far.isVisible, false);
  transitions.hide(groups[0]);
  assert.equal(near.isVisible, false);
  transitions.request(groups[0], groups[0], 0);
  for (let i = 0; i < 30; i++) transitions.update(0.02);
  assert.equal(near.isVisible, true, 'reactivated cells fade back in');
  transitions.request(groups[0], groups[0], -1);
  for (let i = 0; i < 30; i++) transitions.update(0.02);
  assert.equal(near.isVisible, false); assert.equal(near.isEnabled(), true, 'render culling does not disable collision geometry');
  for (const levels of groups) transitions.request(levels, levels, 0);
  transitions.settle();
  assert.ok(groups.every(([near, far]) => near.isVisible && !far.isVisible), 'startup settles every pending target without a transition budget');
  transitions.update(0.09);
  assert.ok(groups.every(([near, far]) => near.isVisible && !far.isVisible), 'settled targets leave no queued transitions');
  assert.equal(material.alpha, 1);
  transitions.clear(); scene.dispose(); engine.dispose();
});


test('LOD lookahead accounts for camera speed without early culling or teleport overshoot', () => {
  const previous = Vector3.Zero(), eye = new Vector3(1, 0, 0), predicted = new Vector3();
  const bounds = { minimumWorld: new Vector3(10, -1, -1), maximumWorld: new Vector3(11, 1, 1) };
  predictLodEye(previous, eye, 0.1, predicted);
  assert.ok(Math.abs(predicted.x - 4.3) < 1e-6);
  assert.ok(lodDistance(eye, predicted, bounds) < 9, 'approaching details start earlier');
  predictLodEye(new Vector3(2, 0, 0), eye, 0.1, predicted);
  assert.equal(lodDistance(eye, predicted, bounds), 9, 'retreat never hides currently needed details early');
  predictLodEye(eye, eye, 0.1, predicted);
  assert.deepEqual(predicted.asArray(), eye.asArray());
  predictLodEye(previous, new Vector3(40, 0, 0), 0.01, predicted);
  assert.equal(predicted.x, 70, 'lookahead is capped at 30 metres');
  predictLodEye(previous, new Vector3(1000, 0, 0), 0.01, predicted);
  assert.equal(predicted.x, 1000, 'teleports do not project beyond the destination');
});
