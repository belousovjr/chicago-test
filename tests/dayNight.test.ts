import '@babylonjs/core/Meshes/instancedMesh.js';
import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { DayNight, daylightAt, nearestLamps } from '../src/dayNight.ts';
import { CityMaterials } from '../src/cityMaterials.ts';

test('daylight wraps smoothly through midnight, dawn and dusk', () => {
  assert.equal(daylightAt(12).day, 1); assert.equal(daylightAt(0).night, 1);
  assert.deepEqual(daylightAt(24), daylightAt(0));
  assert.ok(daylightAt(5).day < daylightAt(6).day && daylightAt(6).day < daylightAt(7).day);
  assert.ok(daylightAt(17).night < daylightAt(18).night && daylightAt(18).night < daylightAt(19).night);
  assert.throws(() => daylightAt(NaN), RangeError);
});

test('haze grows linearly through far LOD and smoothly changes its palette with the sky', () => {
  const engine = new NullEngine(), scene = new Scene(engine), lighting = new DayNight(scene);
  assert.equal(scene.fogMode, Scene.FOGMODE_LINEAR);
  assert.equal(scene.fogStart, 0);
  const opacity = distance => (distance - scene.fogStart) / (scene.fogEnd - scene.fogStart);
  assert.ok(Math.abs(opacity(325) - .3) < 1e-8);
  assert.ok(Math.abs(opacity(650) - .6) < 1e-8);
  lighting.setTime(12); const day = scene.fogColor.clone();
  lighting.setTime(6); const dawn = scene.fogColor.clone();
  lighting.setTime(18); assert.ok(scene.fogColor.equalsWithEpsilon(dawn, 1e-6));
  lighting.setTime(0); const night = scene.fogColor.clone();
  assert.ok(day.r > day.b && day.g > day.b, 'daytime smog is grey-beige');
  assert.ok(dawn.r > dawn.g && dawn.g > dawn.b && dawn.r > day.r, 'dawn and dusk are warm');
  assert.ok(night.b > night.g && night.g > night.r && night.b < day.b, 'night haze is dark blue-grey');
  lighting.setTime(23.9999); assert.ok(scene.fogColor.equalsWithEpsilon(night, 1e-6));
  scene.dispose(); engine.dispose();
});

test('lighting uses a fixed light budget, local receivers, and bounded dynamic shadows', () => {
  const engine = new NullEngine(), scene = new Scene(engine), lighting = new DayNight(scene);
  const road = MeshBuilder.CreateBox('road', { width: 40, depth: 40 }, scene);
  road.metadata = { procedural: true };
  const actor = MeshBuilder.CreateBox('actor', {}, scene);
  const distant = MeshBuilder.CreateBox('far', {}, scene); distant.position.x = 1000;
  const source = MeshBuilder.CreateBox('building-source', {}, scene); source.setEnabled(false); source.receiveShadows = true;
  const buildings = Array.from({ length: 120 }, (_, i) => { const instance = source.createInstance(`building${i}`);instance.position.x = i * .4; return instance; });
  const lamps = Array.from({ length: 20 }, (_, i) => { const mesh = MeshBuilder.CreateBox(`lamp${i}`, {}, scene); mesh.position.set(i * 2, 4, 0); mesh.scaling.set(1, 8, 1); return mesh; });
  const foliage=MeshBuilder.CreateBox('foliage',{},scene);foliage.metadata={shadowCaster:false};
  const truss=MeshBuilder.CreateBox('truss',{},scene);truss.metadata={procedural:true,shadowCaster:true,detailLayer:'rail-structure'};
  const projecting=MeshBuilder.CreateBox('upwind-building',{height:1000},scene);projecting.position.set(600,500,0);
  lighting.sun.direction.set(-.8,-.6,0);
  lighting.setWorld(lamps, [road, actor, distant, projecting, foliage, truss, ...buildings]); lighting.update(Vector3.Zero(), 1);
  assert.ok(road.receiveShadows,'terrain receives building shadows without joining local-light receivers');
  assert.equal(scene.lights.length, 6); assert.equal(lighting.shadows.getShadowMap().renderList.length, 122);
  assert.ok(!lighting.shadows.getShadowMap().renderList.includes(foliage));
  assert.ok(!lighting.shadows.getShadowMap().renderList.includes(truss));
  assert.ok(lighting.shadows.getShadowMap().renderList.includes(projecting),'a distant tall building is retained when its projected shadow reaches the viewer');
  assert.ok(!lighting.shadows.getShadowMap().renderList.includes(distant),'distant geometry whose shadow cannot reach the cascades is culled');
  lighting.setTime(0); lighting.update(Vector3.Zero(), 1);
  assert.equal(lighting.streetLights.filter(light => light.intensity > 0).length, 4);
  assert.ok(lighting.streetLights.every(light => !light.includedOnlyMeshes.includes(road) && light.includedOnlyMeshes.includes(actor) && !light.includedOnlyMeshes.includes(distant) && !light.includedOnlyMeshes.some(mesh => mesh.isAnInstance)));
  assert.equal(lighting.sun.shadowEnabled, false); assert.equal(lighting.shadows.getShadowMap().renderList.length, 0);
  lighting.update(new Vector3(1000, 0, 0), 1);
  assert.ok(lighting.streetLights.every(light => light.intensity === 0));
  assert.equal(scene.lights.length, 6, 'travel and time changes never allocate more lights');
  const chosen = nearestLamps(lamps, Vector3.Zero());assert.equal(chosen.length, 4);assert.equal(chosen[0], lamps[0]);
  scene.dispose(); engine.dispose();
});

test('window and lamp emission updates at every LOD without adding textures to light heads', () => {
  const engine = new NullEngine(), scene = new Scene(engine), materials = new CityMaterials(scene, '/');
  const facades = [0, 1, 2].map(lod => materials.get('#ffffff', 'facade-glass', lod));
  const lamp = materials.get('#ffffff', 'light');
  materials.setNight(1);
  for (const facade of facades) {
    assert.equal(facade.emissiveTexture.level, 1.68);
    assert.equal(facade.useEmissiveAsIllumination, true);
    assert.equal(facade.isFrozen, false, 'native dynamic uniforms and per-mesh light lists stay live');
  }
  assert.equal(lamp.getActiveTextures().length, 0);assert.ok(lamp.emissiveColor.r > .9);
  materials.setNight(0);assert.equal(lamp.emissiveColor.r, 0);
  assert.ok(facades.every(material => material.emissiveTexture === null));
  assert.equal(materials.get('#ffffff', 'facade-stone').emissiveTexture, null, 'new/editor materials inherit current time');
  scene.dispose(); engine.dispose();
});


test('idle shadows stay cached and local lamps are disabled whenever they contribute no light',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),lighting=new DayNight(scene);
  const actor=MeshBuilder.CreateBox('actor',{},scene),lamp=MeshBuilder.CreateBox('lamp',{},scene);lamp.position.y=5;
  lighting.setWorld([lamp],[actor]);
  const spy=mock.method(lighting.shadows.getShadowMap(),'resetRefreshCounter');
  try {
    lighting.update(Vector3.Zero(),1);
    const initial=spy.mock.callCount();assert.ok(initial>0);
    lighting.update(Vector3.Zero(),.01);assert.equal(spy.mock.callCount(),initial,'identical view and geometry reuse the map');
    actor.position.x=1;lighting.update(Vector3.Zero(),.01);assert.ok(spy.mock.callCount()>initial,'moving geometry invalidates shadows');
    const moved=spy.mock.callCount();lighting.update(Vector3.Zero(),.01,true);assert.ok(spy.mock.callCount()>moved,'LOD/opacity transitions force refresh');
    assert.ok(lighting.streetLights.every(light=>!light.isEnabled()),'daytime lamps are actually disabled');
    lighting.setTime(0);lighting.update(Vector3.Zero(),1);
    assert.ok(lighting.streetLights.some(light=>light.isEnabled()),'nearby night lighting wakes up');
    lighting.update(new Vector3(1000,0,0),1);
    assert.ok(lighting.streetLights.every(light=>!light.isEnabled()),'unused night lights switch off');
  } finally {spy.mock.restore();scene.dispose();engine.dispose();}
});

test('diagnostic switches stop shadow selection, nearby lights and atmosphere, then restore them',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),lighting=new DayNight(scene);
  const actor=MeshBuilder.CreateBox('actor',{},scene),lamp=MeshBuilder.CreateBox('lamp',{},scene);
  lighting.setWorld([lamp],[actor]);lighting.update(Vector3.Zero(),1);
  lighting.shadowsEnabled=false;lighting.update(Vector3.Zero(),1);
  assert.equal(lighting.shadows.getShadowMap().renderList.length,0);
  lighting.shadowsEnabled=true;lighting.update(Vector3.Zero(),1);
  assert.ok(lighting.shadows.getShadowMap().renderList.includes(actor));
  lighting.setTime(0);lighting.localLightsEnabled=false;lighting.update(Vector3.Zero(),1);
  assert.ok(lighting.streetLights.every(light=>!light.isEnabled()));
  lighting.localLightsEnabled=true;lighting.update(Vector3.Zero(),1);
  assert.ok(lighting.streetLights.some(light=>light.isEnabled()));
  lighting.setAtmosphereEnabled(false);assert.equal(scene.fogEnabled,false);assert.equal(scene.getMeshByName('sky-dome').isVisible,false);
  lighting.setAtmosphereEnabled(true);assert.equal(scene.fogEnabled,true);assert.equal(scene.getMeshByName('sky-dome').isVisible,true);
  scene.dispose();engine.dispose();
});
