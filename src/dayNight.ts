import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { SpotLight } from '@babylonjs/core/Lights/spotLight.js';
import { CascadedShadowGenerator } from '@babylonjs/core/Lights/Shadows/cascadedShadowGenerator.js';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Scene } from '@babylonjs/core/scene.js';

const smooth = (a: number, b: number, value: number) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
export function daylightAt(hour: number) {
  if (!Number.isFinite(hour)) throw new RangeError('Invalid time of day');
  hour = (hour % 24 + 24) % 24;
  const angle = (hour - 6) * Math.PI / 12;
  const sun = new Vector3(Math.cos(angle), Math.sin(angle), -0.35).normalize();
  const day = smooth(-0.12, 0.18, sun.y);
  return { hour, sun, day, night: 1 - smooth(-0.08, 0.16, sun.y), sunset: smooth(-0.2, 0, sun.y) * (1 - smooth(0.05, 0.45, sun.y)) };
}

export function nearestLamps<T extends { position: Vector3 }>(lamps: T[], eye: Vector3) {
  return lamps.map(lamp => ({ lamp, distance: (lamp.position.x - eye.x) ** 2 + (lamp.position.z - eye.z) ** 2 }))
    .filter(item => item.distance < 36 ** 2).sort((a, b) => a.distance - b.distance).slice(0, 4).map(item => item.lamp);
}

export function shadowReaches(mesh: AbstractMesh, eye: Vector3, direction: Vector3) {
  const { minimumWorld: min, maximumWorld: max } = mesh.getBoundingInfo().boundingBox;
  // Include the projected shadow; 100 m extra stays outside cascade coverage.
  const travel = Math.max(0, max.y - Math.min(0, eye.y)) / Math.max(.06, -direction.y);
  const sx = direction.x * travel, sz = direction.z * travel;
  const dx = Math.max(min.x + Math.min(0, sx) - eye.x, 0, eye.x - max.x - Math.max(0, sx));
  const dz = Math.max(min.z + Math.min(0, sz) - eye.z, 0, eye.z - max.z - Math.max(0, sz));
  return dx * dx + dz * dz < 500 ** 2;
}

const vertexSource = `precision highp float;
attribute vec3 position; uniform mat4 worldViewProjection; varying vec3 ray;
void main(){ ray=position; gl_Position=worldViewProjection*vec4(position,1.0); gl_Position.z=gl_Position.w; }`;
const fragmentSource = `precision highp float;
varying vec3 ray; uniform vec3 sunDirection; uniform vec3 hazeColor; uniform float day; uniform float sunset; uniform float wind;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec3 d=normalize(ray); float height=smoothstep(-0.06,0.8,d.y);
 vec3 horizon=hazeColor;
 vec3 zenith=mix(vec3(0.005,0.012,0.04),vec3(0.12,0.36,0.69),day);
 vec3 color=mix(horizon,zenith,height);
 vec2 starUV=d.xz/max(0.22,d.y+0.3); vec2 p=starUV+vec2(wind,wind*0.25);
 float clouds=sin(p.x*3.0+sin(p.y*2.0))*sin(p.y*2.7+sin(p.x*1.9));
 clouds=smoothstep(0.22,0.8,clouds)*smoothstep(0.0,0.18,d.y)*0.32;
 color=mix(color,mix(vec3(0.10,0.13,0.21),vec3(0.96,0.93,0.88),day),clouds);
 float sunDot=max(0.0,dot(d,sunDirection)), moonDot=max(0.0,dot(d,-sunDirection));
 color+=vec3(1.0,0.72,0.35)*pow(sunDot,80.0)*0.38;
 color=mix(color,vec3(1.0,0.92,0.69),smoothstep(0.99965,0.99985,sunDot)*smoothstep(-0.02,0.02,sunDirection.y));
 color+=vec3(0.21,0.3,0.46)*pow(moonDot,200.0)*(1.0-day)*0.35;
 color=mix(color,vec3(0.76,0.84,0.97),smoothstep(0.99980,0.99994,moonDot)*(1.0-day));
 float star=step(0.9975,hash(floor(starUV*170.0)))*(1.0-day)*smoothstep(0.12,0.35,d.y);
 color+=vec3(0.7,0.79,0.96)*star*(1.0-clouds*2.0);
 gl_FragColor=vec4(color,1.0);
}`;

export class DayNight {
  readonly skyLight: HemisphericLight;
  readonly sun: DirectionalLight;
  readonly streetLights: SpotLight[];
  readonly shadows: ShadowGenerator;
  private sky: ShaderMaterial;
  private skyMesh: Mesh;
  private scene: Scene;
  private state = daylightAt(14);
  private lamps: { position: Vector3 }[] = [];
  private receivers: AbstractMesh[] = [];
  private casters: AbstractMesh[] = [];
  private elapsed = 0;
  private wind = 0;
  shadowsEnabled = true;
  localLightsEnabled = true;
  private shadowState: number[] | null = null;
  get hour() { return this.state.hour; }
  get night() { return this.state.night; }

  constructor(scene: Scene) {
    this.scene = scene;
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogStart = 0;
    // 30% haze halfway to the typical far-LOD distance; rebuild recalibrates from its templates.
    scene.fogEnd = 650 / 0.6;
    this.skyLight = new HemisphericLight('sky-ambient', Vector3.Up(), scene);
    this.sun = new DirectionalLight('sun-moon', new Vector3(0, -1, 0), scene);
    this.sun.shadowFrustumSize = 600; this.sun.shadowMinZ = 1; this.sun.shadowMaxZ = 1600;
    this.shadows = CascadedShadowGenerator.IsSupported ? new CascadedShadowGenerator(1024, this.sun) : new ShadowGenerator(1024, this.sun);
    if (this.shadows instanceof CascadedShadowGenerator) {
      this.shadows.numCascades = 2;
      this.shadows.shadowMaxZ = 400;
      this.shadows.lambda = .65;
      this.shadows.cascadeBlendPercentage = .2;
      this.shadows.stabilizeCascades = true;
      this.shadows.depthClamp = true;
    }
    this.shadows.frustumEdgeFalloff = .2;
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0005; this.shadows.normalBias = 0.12;
    this.shadows.setDarkness(0.22);
    this.shadows.getShadowMap()!.refreshRate = 0;
    this.sky = new ShaderMaterial('day-night-sky', scene, { vertexSource, fragmentSource }, {
      attributes: ['position'], uniforms: ['worldViewProjection', 'sunDirection', 'hazeColor', 'day', 'sunset', 'wind'],
    });
    this.sky.backFaceCulling = false; this.sky.disableDepthWrite = true;
    this.skyMesh = MeshBuilder.CreateSphere('sky-dome', { diameter: 2800, segments: 16 }, scene);
    this.skyMesh.material = this.sky; this.skyMesh.infiniteDistance = true; this.skyMesh.isPickable = false;
    this.streetLights = Array.from({ length: 4 }, (_, i) => {
      const light = new SpotLight(`nearby-street-light-${i}`, Vector3.Zero(), Vector3.Down(), Math.PI * 0.78, 2, scene);
      light.diffuse = new Color3(1, 0.73, 0.4); light.specular = new Color3(0.35, 0.25, 0.14);
      light.range = 22; light.intensity = 0; light.setEnabled(false);
      // Empty inclusion means "all meshes" in Babylon, so the sky is our inert placeholder.
      light.includedOnlyMeshes = [this.skyMesh];
      return light;
    });
    this.setTime(14);
  }

  setAtmosphereEnabled(enabled: boolean) {
    this.skyMesh.isVisible = enabled; this.scene.fogEnabled = enabled;
  }

  setTime(hour: number) {
    this.shadowState = null;
    this.state = daylightAt(hour);
    const { day, night, sunset, sun } = this.state;
    this.sky.setVector3('sunDirection', sun).setFloat('day', day).setFloat('sunset', sunset);
    this.skyLight.intensity = 0.28 + day * 0.26;
    this.skyLight.diffuse = Color3.Lerp(new Color3(0.45, 0.55, 0.78), new Color3(0.76, 0.85, 1), day);
    this.skyLight.groundColor = Color3.Lerp(new Color3(0.2, 0.14, 0.1), new Color3(0.26, 0.29, 0.32), day);
    this.sun.direction.copyFrom(sun).scaleInPlace(sun.y >= 0 ? -1 : 1);
    this.sun.intensity = sun.y >= 0 ? smooth(0, 0.25, sun.y) * 1.15 : night * 0.16;
    this.sun.diffuse = sun.y >= 0 ? Color3.Lerp(new Color3(1, 0.48, 0.23), new Color3(1, 0.96, 0.84), smooth(0, 0.55, sun.y)) : new Color3(0.46, 0.59, 1);
    this.sun.specular.copyFrom(this.sun.diffuse);
    this.sun.shadowEnabled = sun.y > 0.06;
    this.scene.ambientColor = Color3.Lerp(new Color3(0.035, 0.026, 0.022), new Color3(0.015, 0.02, 0.025), day);
    this.scene.fogColor = Color3.Lerp(new Color3(0.09, 0.12, 0.18), new Color3(0.73, 0.70, 0.65), day);
    this.scene.fogColor = Color3.Lerp(this.scene.fogColor, new Color3(0.90, 0.57, 0.30), sunset);
    this.sky.setColor3('hazeColor', this.scene.fogColor);
    this.elapsed = 1;
  }

  setWorld(lamps: Mesh[], receivers: AbstractMesh[]) {
    this.shadowState = null;
    this.lamps = lamps.map(root => ({ position: Vector3.TransformCoordinates(new Vector3(0.45, 0.4, 0), root.computeWorldMatrix(true)) }));
    // Hardware instances share their source light list; ground pools use a shared lightmap, live spotlights affect moving actors.
    this.receivers = receivers.filter(mesh => !mesh.isAnInstance && !mesh.metadata?.procedural && mesh.getTotalVertices() > 0);
    for (const mesh of receivers) mesh.receiveShadows = true;
    this.casters = receivers.filter(mesh => mesh.metadata?.shadowCaster !== false && mesh.metadata?.detailLayer !== 'rail-structure' && (!mesh.metadata?.procedural || mesh.metadata.shadowCaster) && mesh.getTotalVertices() > 0);
    this.elapsed = 1;
  }

  update(eye: Vector3, dt: number, dynamicShadows = false) {
    this.wind += dt * 0.002;
    this.sky.setFloat('wind', this.wind);
    this.sun.position.copyFrom(eye).addInPlaceFromFloats(-this.sun.direction.x * 800, -eye.y - this.sun.direction.y * 800, -this.sun.direction.z * 800);
    this.elapsed += dt;
    if (this.elapsed < 0.3) { this.refreshShadows(dynamicShadows); return; }
    this.elapsed = 0;
    const nearby = this.localLightsEnabled && this.night > 0.05 ? nearestLamps(this.lamps, eye) : [];
    this.streetLights.forEach((light, i) => {
      const lamp = nearby[i];
      const distance = lamp ? Math.hypot(lamp.position.x - eye.x, lamp.position.z - eye.z) : 36;
      const intensity = lamp ? this.night * 2.1 * (1 - smooth(18, 36, distance)) : 0;
      if (lamp) light.position.copyFrom(lamp.position);
      const meshes = lamp ? this.receivers.filter(mesh => {
        if (mesh.isDisposed() || !mesh.isEnabled()) return false;
        mesh.computeWorldMatrix(!!mesh.parent || !mesh.isSynchronized());
        const b = mesh.getBoundingInfo().boundingBox;
        return Vector3.DistanceSquared(lamp.position, Vector3.Clamp(lamp.position, b.minimumWorld, b.maximumWorld)) < light.range ** 2;
      }) : [];
      const included = meshes.length ? meshes : [this.skyMesh];
      if (light.intensity !== intensity || included.length !== light.includedOnlyMeshes.length || included.some((mesh, j) => mesh !== light.includedOnlyMeshes[j])) {
        light.includedOnlyMeshes = included;
      }
      light.intensity = intensity;
      const enabled = intensity > 0 && meshes.length > 0;
      if (light.isEnabled() !== enabled) light.setEnabled(enabled);
    });
    if (this.shadowsEnabled && this.sun.shadowEnabled) {
      // Caster selection must not pop at a distance or when a nearer building takes a budget slot.
      this.shadows.getShadowMap()!.renderList = this.casters.filter(mesh => {
        if (mesh.isDisposed() || !mesh.isEnabled() || !mesh.isVisible) return false;
        mesh.computeWorldMatrix(!!mesh.parent || !mesh.isSynchronized());
        return shadowReaches(mesh, eye, this.sun.direction);
      });
    } else this.shadows.getShadowMap()!.renderList = [];
    this.refreshShadows(dynamicShadows);
  }

  private refreshShadows(dynamic: boolean) {
    if (!this.shadowsEnabled || !this.sun.shadowEnabled) return;
    const map = this.shadows.getShadowMap()!, casters = map.renderList ?? [];
    if (dynamic || this.scene.animationsEnabled && casters.some(mesh => mesh.skeleton)) {
      map.resetRefreshCounter(); this.shadowState = null; return;
    }
    const camera = this.scene.activeCamera;
    const state = [...this.sun.position.asArray(), ...this.sun.direction.asArray()];
    if (camera) state.push(...camera.getViewMatrix().m, ...camera.getProjectionMatrix().m);
    for (const mesh of casters) {
      state.push(mesh.uniqueId, mesh.isEnabled() && mesh.isVisible ? 1 : 0, mesh.visibility, ...mesh.computeWorldMatrix(!!mesh.parent || !mesh.isSynchronized()).m);
    }
    if (!this.shadowState || state.length !== this.shadowState.length || state.some((value, i) => value !== this.shadowState![i])) map.resetRefreshCounter();
    this.shadowState = state;
  }
}
