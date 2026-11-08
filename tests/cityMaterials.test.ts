import '@babylonjs/core/Meshes/instancedMesh.js';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { CityMaterials, buildingSurface, streetSurface, facadeVariant } from '../src/cityMaterials.ts';
import { buildArchitecture } from '../src/architecture.ts';
import { createWorld } from '../src/world.ts';

test('city materials share textures, simplify distant shaders, and keep lights and trees untextured', () => {
  const engine = new NullEngine(), scene = new Scene(engine), materials = new CityMaterials(scene, '/');
  const world = createWorld();
  for (const template of world.templates) {
    const levels = buildArchitecture(template, scene, materials.get(template.color), materials.get(template.color), [0, Math.PI / 2],
      (lod, accent, luminous, role) => materials.get(luminous ? '#ffffff' : template.color, buildingSurface(template, accent, luminous, role), lod, accent || luminous ? 1 : 0));
    levels.forEach((mesh, lod) => {
      const uv = mesh.getVerticesData('uv');
      assert.equal(uv.length, mesh.getTotalVertices() * 2);
      assert.ok(uv.every(Number.isFinite));
      const parts = mesh.subMeshes.map(sub => sub.getMaterial());
      for (const material of parts) {
        assert.ok(material.pluginManager?.getPlugin('WaterPalette'), 'all city surfaces use the spatial water palette');
        if (template.profile === 'tree') assert.equal(material.getActiveTextures().length, 0);
        if (lod > 0) { assert.equal(material.bumpTexture, null); assert.equal(material.ambientTexture, null); assert.equal(material.specularTexture, null); }
      }
      if (['lamp', 'traffic_signal'].includes(template.profile) && lod === 0) {
        assert.ok(parts.some(material => material.diffuseTexture), 'pole/body remains textured');
        assert.ok(parts.some(material => !material.diffuseTexture && !material.reflectionTexture), 'light head/lenses use a separate untextured material');
      }
      if (template.kind === 'building') assert.ok(parts.every(material => material.diffuseTexture), 'all architectural surfaces are textured');
    });
    if (['glass', 'stone'].includes(template.profile)) {
      assert.ok(levels.every(mesh => mesh.subMeshes.length <= 3), 'body, concrete and roof are batched by material');
      for (const mesh of levels) {
        const roof = mesh.subMeshes.find(sub => sub.getMaterial().diffuseTexture?.url.endsWith('/roof-' + levels.indexOf(mesh) + '.webp'));
        assert.ok(roof, 'dedicated matte roof persists at every LOD');
        assert.equal(roof.getMaterial().reflectionTexture, null);
        assert.equal(roof.getMaterial().emissiveTexture, null);
        assert.ok(mesh.subMeshes.some(sub => sub.getMaterial().diffuseTexture?.url.includes('/concrete-')), 'opaque base uses concrete');
      }
    }
    levels.forEach(mesh => mesh.dispose());
  }
  const near = materials.get('#ffffff', 'asphalt'), far = materials.get('#ffffff', 'asphalt', 2);
  assert.match(near.diffuseTexture.url, /asphalt-0.webp$/);
  assert.match(far.diffuseTexture.url, /asphalt-2.webp$/);
  assert.equal(materials.get('#aaaaaa', 'asphalt').diffuseTexture, near.diffuseTexture, 'colors share GPU textures');
  assert.equal(materials.get('#ffffff', 'asphalt'), near, 'materials are cached');
  const glass = materials.get('#ffffff', 'facade-glass'), metal = materials.get('#ffffff', 'metal'), water = materials.get('#ffffff', 'water');
  assert.equal(glass.reflectionTexture, metal.reflectionTexture);
  assert.equal(metal.reflectionTexture, water.reflectionTexture);
  assert.ok(water.pluginManager.getPlugin('WaterSurface'));
  assert.equal(glass.pluginManager.getPlugin('WaterSurface'), null);
  assert.equal(water.bumpTexture, null);
  assert.equal(water.ambientTexture, null);
  assert.equal(water.specularTexture, null);
  assert.equal(water.backFaceCulling, false);
  assert.ok(glass.roughness < metal.roughness);
  assert.ok(glass.specularPower > near.specularPower);
  assert.equal(near.reflectionTexture, null);
  assert.ok(near.pluginManager.getPlugin('SurfaceDetail'));
  assert.ok(materials.get('#ffffff','roof').pluginManager.getPlugin('SurfaceDetail'));
  assert.equal(glass.pluginManager.getPlugin('SurfaceDetail'),null);
  assert.equal(water.pluginManager.getPlugin('SurfaceDetail'),null);
  for (const color of ['#454e50', '#517d85', '#71896a', '#c3baa1', '#505b55', '#b6b2a4']) assert.notEqual(streetSurface(color), 'plain');
  assert.equal(glass.diffuseTexture.wrapU, 0, 'whole-facade textures never tile');
  assert.equal(facadeVariant('building-12'), facadeVariant('building-12'));
  assert.ok(new Set(Array.from({length: 20}, (_, i) => facadeVariant(`building-${i}`))).size === 3);
  const street = materials.get('#ffffff', 'asphalt', 0, 0, 0, true);
  assert.equal(street.lightmapTexture, null);
  materials.setNight(1); assert.equal(street.lightmapTexture.level, 1); assert.equal(street.lightmapTexture.coordinatesIndex, 1);
  materials.setNight(0); assert.equal(street.lightmapTexture, null);
  scene.dispose(); engine.dispose();
});

test('every bundled city texture has maps and all LOD variants within a small download budget', () => {
  const folder = new URL('../public/textures/chicago/', import.meta.url), manifest = JSON.parse(readFileSync(new URL('manifest.json', folder), 'utf8'));
  assert.equal(manifest.license, 'CC0-1.0');
  assert.deepEqual(manifest.lodSizes, [512, 128, 32]);
  assert.deepEqual(manifest.facadeLodSizes, [1024, 512, 128]);
  for (const densities of Object.values(manifest.litWindowFractions)) for (const density of densities) assert.ok(density >= .07 && density < .19);
  for (const family of manifest.derived.filter(name => name.startsWith('facade-'))) {
    const masks = [0, 1, 2].map(variant => readFileSync(new URL(`${family}-emission-${variant ? `v${variant}-` : ''}0.webp`, folder)));
    assert.ok(!masks[0].equals(masks[1]) && !masks[1].equals(masks[2]), 'buildings have different room patterns');
  }
  assert.ok(readFileSync(new URL('street-lightmap.webp', folder)).length > 1000);
  for (const name of ['asphalt', 'concrete', 'brick', 'metal', 'grass', ...manifest.derived]) for (const suffix of ['0', '1', '2', 'ao', 'normal', 'specular', ...(name.startsWith('facade-') ? ['emission-0', 'emission-1', 'emission-2'] : [])]) {
    const raw = readFileSync(new URL(`${name}-${suffix}.webp`, folder));
    assert.equal(raw.subarray(8, 12).toString(), 'WEBP');
  }
  assert.ok(readdirSync(folder).reduce((sum, name) => sum + statSync(new URL(name, folder)).size, 0) < 3 * 1024 * 1024);
});

test('masonry window glints use a pane mask nearby and keep distant walls matte', () => {
  const engine = new NullEngine(), scene = new Scene(engine), materials = new CityMaterials(scene, '/');
  for (const surface of ['facade-stone', 'facade-brick'] as const) {
    const near = materials.get('#ffffff', surface, 0), far = materials.get('#ffffff', surface, 2);
    assert.ok(near.specularTexture, 'bright glints must have a texture mask');
    assert.ok(near.useGlossinessFromSpecularMapAlpha);
    assert.equal(near.specularPower, 96);
    assert.ok(far.specularColor.r < .03);
    assert.equal(far.reflectionTexture, null);
  }
  scene.dispose(); engine.dispose();
});

test('grass overlays terrain with a stable depth bias at every detail level', () => {
  const engine = new NullEngine(), scene = new Scene(engine), materials = new CityMaterials(scene, '/');
  for (const lod of [0, 1, 2]) {
    const grass = materials.get('#ffffff', 'grass', lod, 0, 0, true);
    const terrain = materials.get('#ffffff', 'concrete', lod, 0, 0, true);
    assert.ok(grass.zOffset < terrain.zOffset);
    assert.ok(grass.zOffsetUnits < terrain.zOffsetUnits);
  }
  assert.equal(materials.get('#ffffff', 'grass', 0, 3, 0, true).zOffset, -3);
  scene.dispose(); engine.dispose();
});

test('roof materials always win depth conflicts against facade and accent materials',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),materials=new CityMaterials(scene,'/');
  for(const lod of [0,1,2]) {
    const roof=materials.get('#ffffff','roof',lod,1),facade=materials.get('#ffffff','facade-glass',lod),accent=materials.get('#ffffff','concrete',lod,1);
    assert.ok(roof.zOffset<facade.zOffset && roof.zOffset<accent.zOffset);
    assert.ok(roof.zOffsetUnits<facade.zOffsetUnits);
  }
  scene.dispose();engine.dispose();
});


test('day shaders disconnect night maps and restore the same textures at dusk',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),materials=new CityMaterials(scene,'/');
  const facade=materials.get('#ffffff','facade-stone'),road=materials.get('#ffffff','asphalt',0,0,0,true);
  assert.equal(facade.emissiveTexture,null);assert.equal(road.lightmapTexture,null);
  materials.setNight(.5);const emission=facade.emissiveTexture,lightmap=road.lightmapTexture;
  assert.ok(emission && lightmap);assert.equal(emission.level,.84);
  materials.setNight(0);assert.equal(facade.emissiveTexture,null);assert.equal(road.lightmapTexture,null);
  materials.setNight(1);assert.equal(facade.emissiveTexture,emission);assert.equal(road.lightmapTexture,lightmap);
  const late=materials.get('#ffffff','facade-brick',2);assert.ok(late.emissiveTexture,'materials created at night start with emission');
  scene.dispose();engine.dispose();
});
