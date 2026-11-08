import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import '@babylonjs/core/Shaders/ShadersInclude/instancesDeclaration.js';
import '@babylonjs/core/Shaders/ShadersInclude/instancesVertex.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { ObjectTemplate } from './world';
import { spireTips } from './architecture.ts';

const blink = `uniform float time;
  varying float phase;
  float beaconPulse() {
    float t = mod(time + phase + .6, 2.) - 1.;
    return exp(-t*t/(.22*.22));
  }`;

export class Beacons {
  private source: Mesh;
  private material: ShaderMaterial;
  private coreSource: Mesh;
  private coreMaterial: ShaderMaterial;
  private time = 0;

  constructor(scene: Scene) {
    this.material = new ShaderMaterial('spire-beacon', scene, {
      vertexSource: `precision highp float;
        attribute vec3 position;
        attribute float beaconPhase;
        varying float phase;
        uniform mat4 viewProjection, projection;
        uniform float pixelX, pixelY;
        varying vec2 offset;
        #include<instancesDeclaration>
        void main() {
          #include<instancesVertex>
          vec4 center = viewProjection * finalWorld * vec4(0., 0., 0., 1.);
          offset = position.xy * 2.;
          phase = beaconPhase;
          float size = mix(3., 6., 1.-smoothstep(80., 400., center.w));
          float nearScale = clamp(size * projection[1][1] / (max(.1, center.w) * pixelY), 1., 16.);
          center.xy += position.xy * vec2(pixelX, pixelY) * nearScale * center.w;
          gl_Position = center;
        }`,
      fragmentSource: `precision highp float;
        varying vec2 offset;
        ${blink}
        void main() {
          float r = length(offset);
          float halo = exp(-r*r*5.) * (1.-smoothstep(.7, 1., r));
          float core = 1.-smoothstep(.08, .24, r);
          gl_FragColor = vec4(1., .025, .005, (.015 + beaconPulse()*.985) * (halo*.5+core*.5));
        }`,
    }, { attributes: ['position', 'beaconPhase'], uniforms: ['world', 'viewProjection', 'projection', 'pixelX', 'pixelY', 'time'], needAlphaBlending: true });
    this.material.alphaMode = Constants.ALPHA_ADD;
    this.material.disableDepthWrite = true;
    this.material.depthFunction = Constants.LEQUAL;
    this.material.backFaceCulling = false;
    // The halo smoothly grows from 3 m to 6 m nearby, with a 14 px distant minimum.
    this.source = MeshBuilder.CreatePlane('spire-beacon-source', { size: 1 }, scene);
    this.source.material = this.material;
    this.source.setEnabled(false);
    this.coreMaterial = new ShaderMaterial('spire-beacon-core', scene, {
      vertexSource: `precision highp float;
        attribute vec3 position;
        attribute float beaconPhase;
        varying float phase;
        uniform mat4 viewProjection;
        #include<instancesDeclaration>
        void main() {
          #include<instancesVertex>
          phase = beaconPhase;
          gl_Position = viewProjection * finalWorld * vec4(position, 1.);
        }`,
      fragmentSource: `precision highp float;
        ${blink}
        void main() {
          float pulse = beaconPulse();
          gl_FragColor = vec4(.12 + pulse*.88, pulse*.005, 0., 1.);
        }`,
    }, { attributes: ['position', 'beaconPhase'], uniforms: ['world', 'viewProjection', 'time'] });
    this.coreSource = MeshBuilder.CreateSphere('spire-beacon-core-source', { diameter: 1, segments: 4 }, scene);
    this.coreSource.material = this.coreMaterial;
    this.coreSource.setEnabled(false);
    for (const source of [this.source, this.coreSource]) {
      source.registerInstancedBuffer('beaconPhase', 1);
      source.instancedBuffers.beaconPhase = 0;
    }
    this.update(0);
  }

  add(root: Mesh, template: ObjectTemplate) {
    if (template.kind !== 'building' || root.scaling.y < 75) return;
    let hash = 2166136261;
    for (const char of root.name) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const phase = (hash >>> 0) / 4294967296 * 2;
    for (const tip of spireTips(template.profile)) {
      for (const [source, suffix] of [[this.source, 'beacon'], [this.coreSource, 'beacon-core']] as const) {
        const beacon = source.createInstance(`${root.name}-${suffix}`);
        beacon.parent = root;
        beacon.instancedBuffers.beaconPhase = phase;
        beacon.position.set(...tip);
        beacon.scaling.set(0.9 / root.scaling.x, 0.9 / root.scaling.y, 0.9 / root.scaling.z);
        beacon.isPickable = false;
        beacon.checkCollisions = false;
        beacon.metadata = { procedural: true, shadowCaster: false, beacon: true };
      }
    }
  }

  update(dt: number) {
    this.time = (this.time + dt) % 2;
    const engine = this.source.getScene().getEngine();
    this.coreMaterial.setFloat('time', this.time);
    this.material.setFloat('time', this.time)
      .setFloat('pixelX', 28 / engine.getRenderWidth())
      .setFloat('pixelY', 28 / engine.getRenderHeight());
  }
}
