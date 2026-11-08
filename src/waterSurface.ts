import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';

// Surface normals only: no displaced shoreline, scene copies or reflection render targets.
export class WaterSurface extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'WaterSurface', 200, {}, true, true);
    this.doNotSerialize = true;
  }

  getClassName() { return 'WaterSurface'; }

  getUniforms() {
    return { ubo: [{ name: 'waterTime', size: 1, type: 'float' }] };
  }

  bindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat('waterTime', performance.now() * .001);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
        float waterDistance = length(vEyePosition.xyz - vPositionW);
        if (waterDistance < 180.) {
        vec2 waterSlope = vec2(
          sin(dot(vPositionW.xz, vec2(1.7, .8)) + waterTime * 1.1),
          sin(dot(vPositionW.xz, vec2(-.6, 2.3)) - waterTime * .8)
        );
        float waterDetail = 1. - smoothstep(40., 180., waterDistance);
        normalW = normalize(normalW + vec3(waterSlope.x, 0., waterSlope.y) * (.035 * waterDetail));
        }
      `,
    };
  }
}
