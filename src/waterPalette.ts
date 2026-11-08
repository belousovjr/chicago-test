import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';
import { WATER_LEVEL } from './water.ts';

export class WaterPalette extends MaterialPluginBase {
  constructor(material: Material) {
    super(material, 'WaterPalette', 210, {}, true, true);
    this.doNotSerialize = true;
  }

  getClassName() { return 'WaterPalette'; }

  getUniforms() {
    return { ubo: [{ name: 'waterFog', size: 4, type: 'vec4' }] };
  }

  bindForSubMesh(buffer: UniformBuffer, scene: Scene) {
    const rate = 1 / Math.max(1, scene.fogEnd - scene.fogStart);
    const landRate = scene.fogEnabled && this._material.fogEnabled && scene.fogMode === Scene.FOGMODE_LINEAR ? rate : 0;
    buffer.updateFloat4('waterFog', scene.fogEnabled ? 5 * rate : 0, landRate, scene.fogStart, Math.min(1, Math.max(.1, scene.fogColor.r / .73)));
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    const color = this._material.getClassName().startsWith('PBR') ? 'finalColor' : 'color';
    return {
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        if (vPositionW.y < ${WATER_LEVEL}) {
        float waterPaletteMask = 1. - smoothstep(${WATER_LEVEL - .06}, ${WATER_LEVEL}, vPositionW.y);
        ${color}.rgb *= mix(vec3(1.), vec3(.9, 1., 1.03), waterPaletteMask);
        float waterRayLength = length(vPositionW - vEyePosition.xyz);
        float waterRayFraction = clamp((${WATER_LEVEL} - vPositionW.y) / max(vEyePosition.y - vPositionW.y, .0001), 0., 1.);
        float landFog = clamp((waterRayLength - waterFog.z) * waterFog.y, 0., 1.);
        float underwaterFog = clamp(waterRayLength * waterRayFraction * (waterFog.x - waterFog.y) / max(1. - landFog, .001), 0., 1.);
        ${color}.rgb = mix(${color}.rgb, vec3(.04, .17, .18) * waterFog.w, underwaterFog * waterPaletteMask);
        }
      `,
    };
  }
}
