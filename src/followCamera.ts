import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';

export const MIN_CAMERA_DISTANCE = 2.5;
const CAMERA_RADIUS = 0.3;
const SKIN = 0.04;

// Segment versus an expanded local box: a conservative sphere sweep for our box-built world.
// shortcut: box bounds suit this city; use physics sphere casts if irregular level geometry is added.
export function boxEntry(origin: Vector3, direction: Vector3, length: number, mesh: Mesh, radius: number): number | null {
  if (!mesh.isWorldMatrixFrozen) mesh.computeWorldMatrix(true);
  const inverse = Matrix.Invert(mesh.getWorldMatrix());
  const start = Vector3.TransformCoordinates(origin, inverse);
  const delta = Vector3.TransformNormal(direction, inverse);
  const bounds = mesh.getBoundingInfo().boundingBox;
  let enter = 0, exit = length;
  for (const axis of ['x', 'y', 'z'] as const) {
    const padding = radius / Math.abs(mesh.absoluteScaling[axis]);
    const low = bounds.minimum[axis] - padding, high = bounds.maximum[axis] + padding;
    if (Math.abs(delta[axis]) < 1e-8) {
      if (start[axis] < low || start[axis] > high) return null;
    } else {
      let a = (low - start[axis]) / delta[axis], b = (high - start[axis]) / delta[axis];
      if (a > b) [a, b] = [b, a];
      enter = Math.max(enter, a); exit = Math.min(exit, b);
      if (enter > exit) return null;
    }
  }
  if (mesh.metadata?.procedural) {
    let nearest: number | null = null;
    for (const offset of [Vector3.Zero(), new Vector3(radius, 0, 0), new Vector3(-radius, 0, 0), new Vector3(0, radius, 0), new Vector3(0, -radius, 0), new Vector3(0, 0, radius), new Vector3(0, 0, -radius)]) {
      const hit = new Ray(origin.add(offset), direction, length).intersectsMesh(mesh);
      if (hit.hit && hit.distance <= length) nearest = Math.min(nearest ?? length, hit.distance);
    }
    return nearest;
  }
  return enter;
}

// shortcut: nine samples approximate the 1.8 m avatar silhouette; use an occlusion mask for pixel-exact coverage.
export function silhouetteOcclusion(target: Vector3, camera: Vector3, blockers: Mesh[]) {
  const forward = target.subtract(camera);
  const side = new Vector3(forward.z, 0, -forward.x).normalize().scaleInPlace(0.35);
  const covering = new Set<Mesh>();
  let covered = 0;
  for (const height of [-1.1, -0.25, 0.6]) for (const width of [-1, 0, 1]) {
    const point = target.add(new Vector3(0, height, 0)).addInPlace(side.scale(width));
    const ray = point.subtract(camera);
    const length = ray.length();
    if (length < 0.001) continue;
    ray.scaleInPlace(1 / length);
    let nearest = length - 0.02;
    let blocker: Mesh | null = null;
    for (const mesh of blockers) {
      const hit = boxEntry(camera, ray, nearest, mesh, 0);
      if (hit !== null && hit < nearest) { nearest = hit; blocker = mesh; }
    }
    if (blocker) { covered++; covering.add(blocker); }
  }
  return { covered, covering };
}

export class FollowCamera {
  readonly position = Vector3.Zero();
  private distance: number | null = null;
  private previousTarget: Vector3 | null = null;
  private faded = new Map<Mesh, number>();
  get fadedMeshes(): Iterable<Mesh> { return this.faded.keys(); }

  reset() {
    for (const [mesh, value] of this.faded) if (!mesh.isDisposed()) mesh.visibility = value;
    this.faded.clear(); this.distance = null; this.previousTarget = null;
  }

  update(target: Vector3, desired: Vector3, obstacles: Iterable<Mesh>, dt: number) {
    const arm = desired.subtract(target);
    const wanted = arm.length();
    if (wanted < 0.001) { this.position.copyFrom(target); return; }
    arm.scaleInPlace(1 / wanted);
    const lookAhead = Vector3.Zero();
    if (this.previousTarget && dt > 0) {
      lookAhead.copyFrom(target).subtractInPlace(this.previousTarget).scaleInPlace(0.12 / dt);
      // Respawns and stalls must not turn into a huge prediction.
      if (lookAhead.length() > 1) lookAhead.normalize();
    }
    this.previousTarget = target.clone();
    const range = wanted + 3;
    const blockers = [...obstacles].filter(mesh => {
      if (mesh.isDisposed() || !mesh.isEnabled() || !mesh.checkCollisions) return false;
      if (!mesh.isWorldMatrixFrozen) mesh.computeWorldMatrix(true);
      const bounds = mesh.getBoundingInfo().boundingBox;
      return Vector3.DistanceSquared(target, Vector3.Clamp(target, bounds.minimumWorld, bounds.maximumWorld)) <= range * range;
    });
    const travel = lookAhead.length();
    if (travel > 0.001) {
      const heading = lookAhead.scale(1 / travel);
      let allowed = travel;
      for (const mesh of blockers) {
        const hit = boxEntry(target, heading, travel, mesh, CAMERA_RADIUS);
        if (hit !== null) allowed = Math.min(allowed, Math.max(0, hit - SKIN));
      }
      lookAhead.copyFrom(heading).scaleInPlace(allowed);
    }
    const predictedTarget = target.add(lookAhead);
    // Test the requested pose, so pulling forward does not clear its own condition and oscillate.
    const coverage = silhouetteOcclusion(target, desired, blockers);
    const fullyOccluded = coverage.covered === 9;
    const fadedBlockers = coverage.covered / 9 >= 0.4 ? coverage.covering : new Set<Mesh>();
    const predictedOccluded = fullyOccluded && silhouetteOcclusion(predictedTarget, desired.add(lookAhead), blockers).covered === 9;
    let safe = wanted, predictedSafe = wanted, groundSafe = Infinity;
    for (const mesh of blockers) {
      const ground = mesh.metadata?.kind === 'ground';
      if (!ground && !fullyOccluded) continue;
      const hit = boxEntry(target, arm, wanted, mesh, CAMERA_RADIUS);
      if (hit !== null) {
        const distance = Math.max(0.02, hit - SKIN);
        safe = Math.min(safe, distance);
        if (ground) groundSafe = Math.min(groundSafe, distance);
      }
      const predictedHit = boxEntry(predictedTarget, arm, wanted, mesh, CAMERA_RADIUS);
      if ((ground || predictedOccluded) && predictedHit !== null) predictedSafe = Math.min(predictedSafe, Math.max(0.02, predictedHit - SKIN));
    }
    const goal = Math.min(safe, predictedSafe);
    const previous = this.distance ?? wanted;
    const response = goal < previous ? 18 : 4;
    // Keep the avatar readable in tight spaces; faded obstacles may intersect the minimum-distance camera.
    // Opaque ground takes priority over the minimum distance: never push the camera under the floor.
    this.distance = Math.min(groundSafe, Math.max(MIN_CAMERA_DISTANCE, Math.min(wanted, previous + (goal - previous) * (1 - Math.exp(-response * dt)))));
    this.position.copyFrom(target).addInPlace(arm.scale(this.distance));
    for (const mesh of fadedBlockers) {
      if (mesh.metadata?.kind !== 'ground' && !this.faded.has(mesh)) this.faded.set(mesh, mesh.visibility);
    }
    for (const [mesh, original] of this.faded) {
      if (mesh.isDisposed()) { this.faded.delete(mesh); continue; }
      if (!fadedBlockers.has(mesh)) {
        mesh.visibility = original; this.faded.delete(mesh);
      } else {
        mesh.visibility += (Math.min(original, 0.25) - mesh.visibility) * (1 - Math.exp(-18 * dt));
      }
    }
  }
}
