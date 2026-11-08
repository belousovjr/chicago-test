import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';

// shortcut: static city; moving obstacles must invalidate this cache when introduced.
export class NearbyMeshes {
  private sources: Mesh[] = [];
  private centre = new Vector3(Infinity, Infinity, Infinity);
  private radius = -1;
  private nearby: Mesh[] = [];

  setSources(meshes: Mesh[]) {
    this.sources = meshes;
    this.invalidate();
  }

  invalidate() { this.radius = -1; }

  get(centre: Vector3, radius: number): Mesh[] {
    if (this.radius >= radius && Vector3.DistanceSquared(centre, this.centre) < 16) return this.nearby;
    this.centre.copyFrom(centre);
    this.radius = radius;
    const limit = (radius + 8) ** 2;
    this.nearby = this.sources.filter(mesh => {
      if (mesh.isDisposed() || !mesh.isEnabled() || !mesh.checkCollisions) return false;
      mesh.computeWorldMatrix(!!mesh.parent || !mesh.isSynchronized());
      const box = mesh.getBoundingInfo().boundingBox;
      const dx = Math.max(box.minimumWorld.x - centre.x, 0, centre.x - box.maximumWorld.x);
      const dy = Math.max(box.minimumWorld.y - centre.y, 0, centre.y - box.maximumWorld.y);
      const dz = Math.max(box.minimumWorld.z - centre.z, 0, centre.z - box.maximumWorld.z);
      return dx * dx + dy * dy + dz * dz <= limit;
    });
    return this.nearby;
  }
}
