import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { defaultPixelShader } from '@babylonjs/core/Shaders/default.fragment.js';
import { SurfaceDetail } from '../src/surfaceDetail.ts';

test('distant surface samples are guarded at the actual Babylon texture reads', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  try {
    const plugin = new SurfaceDetail(new StandardMaterial('surface', scene), [.5,.5,.5,1]);
    const code = plugin.getCustomCode('fragment');
    for (const [point, replacement] of Object.entries(code).filter(([point])=>point.startsWith('!'))) {
      assert.equal([...defaultPixelShader.shader.matchAll(new RegExp(point.slice(1), 'g'))].length, 1, 'shader hooks must still match after a Babylon upgrade');
      assert.ok(replacement.includes('if (surfaceDetailFade < 1.)'));
    }
    assert.ok(code.CUSTOM_FRAGMENT_MAIN_BEGIN.includes('surfaceDetailFade'));
    assert.ok(code.CUSTOM_FRAGMENT_BEFORE_LIGHTS.includes('mix(baseColor.rgb, surfaceAverage, surfaceDetailFade)'));
  } finally { scene.dispose(); engine.dispose(); }
});
