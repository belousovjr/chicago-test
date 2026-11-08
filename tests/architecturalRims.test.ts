import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { buildArchitecture } from '../src/architecture.ts';

test('floor decorations contain only exposed rims, with correct face winding at every LOD', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const body = new StandardMaterial('body', scene), trim = new StandardMaterial('trim', scene);
  const original = Mesh.MergeMeshes;
  let profile = '', checked = 0;
  const spy = mock.method(Mesh, 'MergeMeshes', (...args: Parameters<typeof Mesh.MergeMeshes>) => {
    for (const mesh of args[0].filter(m => m.material === trim && m.scaling.y < .02)) {
      const p = mesh.getVerticesData('position')!, n = mesh.getVerticesData('normal')!, indices = mesh.getIndices()!;
      let area = 0;
      for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = indices.slice(i, i + 3);
        if (n[a * 3 + 1] < .5) continue;
        const crossY = (p[b*3+2]-p[a*3+2])*(p[c*3]-p[a*3])-(p[b*3]-p[a*3])*(p[c*3+2]-p[a*3+2]);
        assert.ok(crossY < 0, 'top rim faces the same way as Babylon primitive caps');
        area += -crossY / 2 * mesh.scaling.x * mesh.scaling.z;
        if (profile === 'marina') for (const index of [a, b, c]) {
          assert.ok(Math.hypot(p[index*3], p[index*3+2]) >= .39-1e-6, 'no cap vertices in the cylinder core');
        }
        if (profile !== 'marina') {
          const x = (p[a*3]+p[b*3]+p[c*3])/3 * mesh.scaling.x;
          const z = (p[a*3+2]+p[b*3+2]+p[c*3+2])/3 * mesh.scaling.z;
          assert.ok(Math.abs(x) >= (mesh.scaling.x-.005)/2-1e-6 || Math.abs(z) >= (mesh.scaling.z-.005)/2-1e-6, 'no horizontal triangle inside the wall footprint');
        }
      }
      if (profile !== 'marina') {
        const expected = mesh.scaling.x * mesh.scaling.z - (mesh.scaling.x-.005)*(mesh.scaling.z-.005);
        assert.ok(Math.abs(area-expected)<1e-6, 'cap covers the perimeter strip, not a full floor');
      } else {
        assert.ok(area > .2 && area < .32, 'circular slab has an empty core at all tessellations');
      }
      checked++;
    }
    return original(...args);
  });
  try {
    for (const current of ['glass', 'stone', 'deco', 'marina'] as const) {
      profile = current;
      const levels = buildArchitecture({id:current,name:current,kind:'building',profile:current,size:[36,100,30],color:'#ffffff',lodDistances:[100,200]},scene,body,trim,[0],(_lod,accent,_light,role)=>accent&&!role?trim:body);
      levels.forEach(m=>m.dispose());
    }
    assert.ok(checked >= 70);
  } finally { spy.mock.restore(); scene.dispose(); engine.dispose(); }
});
