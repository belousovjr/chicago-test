import { RENDER_SETTINGS } from './renderSettings.ts';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer.js';

// Fade repeating microdetail into its measured average without additional texture samples.
export class SurfaceDetail extends MaterialPluginBase {
  private mean: number[];

  constructor(material: Material, mean: number[]) {
    super(material, 'SurfaceDetail', 190, {}, true, true);
    this.mean = mean;
    this.doNotSerialize = true;
  }

  getClassName() { return 'SurfaceDetail'; }
  getUniforms() { return { ubo: [{ name: 'surfaceMean', size: 4, type: 'vec4' }] }; }
  bindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat4('surfaceMean', this.mean[0]!, this.mean[1]!, this.mean[2]!, this.mean[3]!);
  }

  getCustomCode(shaderType: string) {
    if (shaderType !== 'fragment') return null;
    return {
      CUSTOM_FRAGMENT_MAIN_BEGIN: `float surfaceDetailFade = smoothstep(${RENDER_SETTINGS.surfaceFade[0].toFixed(1)}, ${RENDER_SETTINGS.surfaceFade[1].toFixed(1)}, length(vPositionW - vEyePosition.xyz));`,
      // Beyond the fade, these samples are completely overwritten by the measured average.
      '!baseColor=TEXRD\\(diffuseSampler,vDiffuseUV\\+uvOffset\\);': `baseColor = vec4(surfaceMean.rgb, 1.); if (surfaceDetailFade < 1.) { baseColor = TEXRD(diffuseSampler,vDiffuseUV+uvOffset); }`,
      '!baseAmbientColor=TEXRD\\(ambientSampler,vAmbientUV\\+uvOffset\\)\\.rgb\\*vAmbientInfos\\.y;': `baseAmbientColor = vec3(surfaceMean.a); if (surfaceDetailFade < 1.) { baseAmbientColor = TEXRD(ambientSampler,vAmbientUV+uvOffset).rgb*vAmbientInfos.y; }`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
        vec3 surfaceAverage = surfaceMean.rgb;
        #if defined(VERTEXCOLOR) || defined(INSTANCESCOLOR) && defined(INSTANCES)
          surfaceAverage *= vColor.rgb;
        #endif
        baseColor.rgb = mix(baseColor.rgb, surfaceAverage, surfaceDetailFade);
        #ifdef AMBIENT
          baseAmbientColor = mix(baseAmbientColor, vec3(surfaceMean.a), surfaceDetailFade);
        #endif
        #ifdef NORMAL
          normalW = normalize(mix(normalW, normalize(vNormalW), surfaceDetailFade));
        #endif
      `,
    };
  }
}
