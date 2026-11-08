import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { DitheredTileFadeMaterialPlugin } from '@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';

// Look ahead through one LOD polling interval plus the fade, without projecting teleports.
export function predictLodEye(previous: Vector3, eye: Vector3, dt: number, result: Vector3) {
  eye.subtractToRef(previous, result);
  const travel = result.length();
  result.scaleInPlace(dt > 0 && travel <= 50 ? Math.min(0.33 / dt, 30 / Math.max(travel, 0.001)) : 0);
  result.addInPlace(eye);
}

export function lodDistance(eye: Vector3, predicted: Vector3, bounds: { minimumWorld: Vector3; maximumWorld: Vector3 }) {
  const squaredDistance = (point: Vector3) => {
    const dx = Math.max(bounds.minimumWorld.x - point.x, 0, point.x - bounds.maximumWorld.x);
    const dy = Math.max(bounds.minimumWorld.y - point.y, 0, point.y - bounds.maximumWorld.y);
    const dz = Math.max(bounds.minimumWorld.z - point.z, 0, point.z - bounds.maximumWorld.z);
    return dx * dx + dy * dy + dz * dz;
  };
  return Math.sqrt(Math.min(squaredDistance(eye), squaredDistance(predicted)));
}

type Level = Mesh | InstancedMesh;
type Group = { meshes: Level[]; plugins: DitheredTileFadeMaterialPlugin[][]; weights: number[]; from: number[]; target: number; elapsed: number; active: boolean; opacity: number };

export class LodTransitions {
  revision = 0;
  get busy() { return this.active.size > 0 || this.pending.size > 0; }
  private groups = new Map<object, Group>();
  private pending = new Set<Group>();
  private active = new Set<Group>();

  request(key: object, meshes: Level[], target: number) {
    let group = this.groups.get(key);
    if (!group) {
      const plugins = meshes.map(mesh => {
        const materials = mesh.material instanceof MultiMaterial ? mesh.material.subMaterials : [mesh.material];
        return materials.filter((m): m is StandardMaterial => m instanceof StandardMaterial).map(m => DitheredTileFadeMaterialPlugin.GetOrCreate(m));
      });
      const weights = meshes.map((_, i) => +(i === target));
      group = { meshes, plugins, weights, from: weights.slice(), target, elapsed: 0, active: false, opacity: 1 };
      this.groups.set(key, group);
      // Initial scene setup settles immediately; distance-driven appearances fade afterwards.
      this.apply(group);
    } else if (group.target !== target) {
      group.target = target;
      if (group.active) { group.from = group.weights.slice(); group.elapsed = 0; }
      else this.pending.add(group);
    }
  }

  opacity(key: object, opacity: number) {
    const group = this.groups.get(key);
    if (!group || group.opacity === opacity) return;
    group.opacity = opacity;
    this.apply(group);
  }

  update(dt: number) {
    for (const group of this.active) {
      if (group.meshes.some(mesh => mesh.isDisposed())) { this.active.delete(group); continue; }
      group.elapsed += dt;
      const t = Math.min(1, group.elapsed / 0.18);
      group.weights = group.from.map((weight, i) => weight + (+(i === group.target) - weight) * t);
      this.apply(group);
      group.active = t < 1;
      if (!group.active) this.active.delete(group);
    }
    // Bound extra draw calls; slow frames start fewer transitions, never a catch-up burst.
    let starts = dt > 0.025 ? 1 : 4;
    for (const group of this.pending) {
      if (this.active.size >= 12 || starts-- <= 0) break;
      this.pending.delete(group);
      group.from = group.weights.slice(); group.elapsed = 0; group.active = true;
      this.active.add(group);
    }
  }

  settle() {
    this.active.clear(); this.pending.clear();
    for (const group of this.groups.values()) {
      group.active = false;
      group.weights = group.meshes.map((_, i) => +(i === group.target));
      this.apply(group);
    }
  }

  hide(key: object) {
    const group = this.groups.get(key);
    if (!group) return;
    this.active.delete(group); this.pending.delete(group);
    group.active = false; group.target = -1; group.weights.fill(0);
    this.apply(group);
  }

  forget(key: object) {
    const group = this.groups.get(key);
    if (group) { this.active.delete(group); this.pending.delete(group); this.groups.delete(key); }
  }

  clear() { this.groups.clear(); this.pending.clear(); this.active.clear(); }

  private apply(group: Group) {
    this.revision++;
    let lower = 0;
    group.meshes.forEach((mesh, i) => {
      const upper = Math.min(1, lower + group.weights[i]! * group.opacity);
      // Complementary Bayer intervals keep the two LODs from painting the same pixels.
      for (const plugin of group.plugins[i]!) plugin.setFadeBounds(mesh, lower, upper);
      mesh.isVisible = upper > lower;
      lower = upper;
    });
  }
}
