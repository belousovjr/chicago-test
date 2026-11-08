import { buildTree } from './treeGeometry.ts';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { ObjectTemplate } from './world';
import facadeLayout from './facadeLayout.json' with { type: 'json' };

import { hasMasonryWindows, windowRows } from './windowMapping.ts';
import type { Profile } from './profiles.ts';
export { PROFILES } from './profiles.ts';
export type { Profile } from './profiles.ts';

export function spireTips(profile?: Profile): [number, number, number][] {
  if (profile === 'bundled') return [[0, 0.5, 0], [0.2, 0.5, 0]];
  if (profile === 'rounded' || profile === 'deco') return [[0.08, 0.5, 0]];
  if (profile === 'clock' || profile === 'gothic') return [[0, 0.5, 0]];
  return [];
}

export function setArchitectureStatic(root: Mesh, frozen: boolean) {
  for (const mesh of [root, ...root.getChildMeshes()]) {
    if (frozen) mesh.freezeWorldMatrix();
    else mesh.unfreezeWorldMatrix();
  }
}

export function createCollisionPrototype(scene: Scene): Mesh {
  // Match the 1.03-wide architectural plinths without changing instance/editor dimensions.
  const mesh = MeshBuilder.CreateBox('collision-prototype', { width: 1.03, height: 1, depth: 1.03 }, scene);
  mesh.setEnabled(false);
  return mesh;
}

export function attachCollisionGeometry(root: Mesh, source: Mesh): Mesh {
  // Keep the editor/camera bounds separate from the player's stable, shared collision geometry.
  root.checkCollisions = true;
  root.collisionGroup = 2;
  source = source.metadata?.collisionSource ?? source;
  const collider = source.clone(`${root.name}-collision`, root, true)!;
  collider.isVisible = false;
  collider.isPickable = false;
  collider.checkCollisions = true;
  collider.collisionGroup = 1;
  collider.metadata = { ...root.metadata, worldId: root.name, collisionOnly: true };
  collider.setEnabled(true);
  collider.computeWorldMatrix(true);
  return collider;
}

// Keep only the exposed rim of a slab; its middle is buried inside the facade.
function hollowSlab(mesh: Mesh, innerX: number, innerZ: number) {
  const source = VertexData.ExtractFromMesh(mesh);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const remap = new Map<number, number>();
  for (let i = 0; i < source.indices!.length; i += 3) {
    const triangle = Array.from(source.indices!.slice(i, i + 3));
    if (triangle.every(index => Math.abs(source.normals![index * 3 + 1]!) > .5)) continue;
    for (const index of triangle) {
      if (!remap.has(index)) {
        remap.set(index, positions.length / 3);
        positions.push(...source.positions!.slice(index * 3, index * 3 + 3));
        normals.push(...source.normals!.slice(index * 3, index * 3 + 3));
        uvs.push(...source.uvs!.slice(index * 2, index * 2 + 2));
      }
      indices.push(remap.get(index)!);
    }
  }
  const perimeter = new Map<string, [number, number]>();
  for (let i = 0; i < source.positions!.length; i += 3) {
    const x = source.positions![i]!, z = source.positions![i + 2]!;
    if (source.normals![i + 1]! > .5 && Math.hypot(x, z) > .1) perimeter.set(`${x.toFixed(6)}:${z.toFixed(6)}`, [x, z]);
  }
  const outline = [...perimeter.values()].sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
  for (const y of [-.5, .5]) for (let i = 0; i < outline.length; i++) {
    const a = outline[i]!, b = outline[(i + 1) % outline.length]!, start = positions.length / 3;
    for (const [x, z] of [a, b, [b[0] * innerX, b[1] * innerZ], [a[0] * innerX, a[1] * innerZ]]) {
      positions.push(x!, y, z!); normals.push(0, Math.sign(y), 0); uvs.push(x! + .5, z! + .5);
    }
    indices.push(...(y > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map(index => start + index));
  }
  const data = new VertexData();
  data.positions = positions; data.normals = normals; data.uvs = uvs; data.indices = indices;
  data.applyToMesh(mesh);
}

// Local geometry is normalized to the editable collision box. Materials and geometry are shared by instances.
export function buildArchitecture(template: ObjectTemplate, scene: Scene, material: Material, detailMaterial: Material, signalHeadings: number[] = [0], surfaceMaterial?: (lod: number, accent: boolean, luminous: boolean, role?: 'roof' | 'base') => Material, treeVariant = 0, leafMaterial?: Material, farLeafMaterial?: Material): Mesh[] {
  const profile = template.profile ?? 'box';
  if (profile === 'tree') return buildTree(scene, detailMaterial, leafMaterial ?? material, (template.lodDistances?.length ?? 0) + 1, treeVariant, farLeafMaterial);
  const masonry = hasMasonryWindows(template);
  const panelled = ['glass', 'stone', 'deco'].includes(profile);
  const grid = ['glass', 'bundled'].includes(profile) ? facadeLayout.glass : facadeLayout.masonry;
  const { bodyBottom, bodyTop } = facadeLayout;
  const bodyHeight = bodyTop - bodyBottom;
  return Array.from({ length: (template.lodDistances?.length ?? 0) + 1 }, (_, detail) => {
    const pieces: Mesh[] = [];
    const part = (x: number, y: number, z: number, w: number, h: number, d: number, shade = 1, round: boolean | 'sphere' = false, luminous = false, role?: 'roof' | 'base', inner?: [number, number]) => {
      const mesh = round === 'sphere' ? MeshBuilder.CreateSphere('part', { diameter: 1, segments: 4 }, scene) : round
        ? MeshBuilder.CreateCylinder('part', { diameter: 1, height: 1, tessellation: detail === 0 ? 12 : profile === 'marina' && detail >= 2 ? 6 : 8 }, scene)
        : MeshBuilder.CreateBox('part', { size: 1 }, scene);
      if (inner) hollowSlab(mesh, inner[0] / w, inner[1] / d);
      mesh.scaling.set(w, h, d); mesh.position.set(x, y, z);
      mesh.setVerticesData('color', Array.from({ length: mesh.getTotalVertices() }, () => [shade, shade, shade, 1]).flat());
      const accent = profile === 'marina' ? shade !== 0.75 : shade !== 1;
      mesh.material = surfaceMaterial?.(detail, accent, luminous, role) ?? (shade === 1 ? material : detailMaterial);
      const bottom = panelled ? Math.max(y - h / 2, bodyBottom) : y - h / 2;
      const top = panelled ? Math.min(y + h / 2, bodyTop) : y + h / 2;
      const rows = profile === 'bundled' ? Math.max(1, Math.round(h * grid.rows)) : windowRows(template.size[1], Math.max(0, top - bottom));
      if (surfaceMaterial && !luminous) {
        const positions = mesh.getVerticesData('position')!, normals = mesh.getVerticesData('normal')!, sourceUVs = mesh.getVerticesData('uv')!, uvs: number[] = [];
        const facade = template.kind === 'building' && !accent && !role;
        for (let i = 0; i < positions.length; i += 3) {
          const px = positions[i]! * w + x, py = positions[i + 1]! * h + y, pz = positions[i + 2]! * d + z;
          const nx = Math.abs(normals[i]!), ny = Math.abs(normals[i + 1]!), nz = Math.abs(normals[i + 2]!);
          if (facade && ny > 0.5) uvs.push(0.004 + positions[i]! * 0.004, 0.004 + positions[i + 2]! * 0.004);
          else if (facade) {
            if (masonry || profile === 'bundled') {
              const width = nx > nz ? d : w;
              const columns = Math.max(1, Math.round(width * grid.columns));
              const local = nx > nz ? positions[i + 2]! : positions[i]!;
              uvs.push(rows ? (local + 0.5) * columns / grid.columns : 0.002,
                rows ? (py - bottom) / (top - bottom) * rows / grid.rows : 0.002);
              continue;
            }
            const u = round ? sourceUVs[i / 3 * 2]! : (nx > nz ? pz : px) + 0.5;
            const v = profile === 'marina'
              ? (py - facadeLayout.marina.bottom) / (facadeLayout.marina.step * facadeLayout.glass.rows)
              : panelled ? (py - bodyBottom) / bodyHeight : py + 0.5;
            uvs.push(u, v);
          } else if (round && ny < 0.5) {
            // A cylinder needs one continuous unwrap; switching X/Z projections stretches the joining faces.
            const circumference = Math.PI * (w * template.size[0] + d * template.size[2]) / 2;
            uvs.push(sourceUVs[i / 3 * 2]! * circumference / 4, py * template.size[1] / 4);
          } else {
            uvs.push((ny > 0.5 || nz >= nx ? px * template.size[0] : pz * template.size[2]) / 4,
              (ny > 0.5 ? pz * template.size[2] : py * template.size[1]) / 4);
          }
        }
        mesh.setVerticesData('uv', uvs);
        if (facade) {
          // Every facade volume has a roof above it; two coincident top faces cause z-fighting.
          const indices = mesh.getIndices()!, visible: number[] = [];
          for (let i = 0; i < indices.length; i += 3) {
            if ([indices[i]!, indices[i + 1]!, indices[i + 2]!].every(index => normals[index * 3 + 1]! > .5)) continue;
            visible.push(indices[i]!, indices[i + 1]!, indices[i + 2]!);
          }
          mesh.setIndices(visible);
        }
      }
      pieces.push(mesh);
      if (surfaceMaterial && masonry && panelled && !accent && !role && detail === 0) {
        // Details use the same whole-cell mapping as this particular stepped wall.
        const span = top - bottom;
        const beltHeight = Math.min(0.008, 1.6 * Math.min(grid.insetTop, grid.insetBottom) / facadeLayout.size * grid.rows * span / Math.max(1, rows));
        const belts = Math.min(7, rows - 1);
        for (let i = 1; i <= belts; i++) {
          const row = Math.round(rows * i / (belts + 1));
          part(x, bottom + row / rows * span, z, w + 0.005, beltHeight, d + 0.005, 0.87, false, false, undefined, [w, d]);
        }
        for (const axis of ['x', 'z'] as const) {
          const width = axis === 'x' ? w : d;
          const columns = Math.max(1, Math.round(width * grid.columns));
          const ribWidth = Math.min(0.012, 1.6 * grid.insetX / facadeLayout.size * grid.columns * width / columns);
          const boundaries = new Set([1 / 6, 1 / 2, 5 / 6].map(f => Math.round(columns * f)).filter(c => c > 0 && c < columns));
          for (const column of boundaries) for (const side of [-1, 1]) {
            const offset = (column / columns - 0.5) * width;
            part(x + (axis === 'x' ? offset : side * (w / 2 + 0.002)), (top + bottom) / 2,
              z + (axis === 'z' ? offset : side * (d / 2 + 0.002)),
              axis === 'x' ? ribWidth : 0.012, span, axis === 'z' ? ribWidth : 0.012, 1.25);
          }
        }
      }
      if (surfaceMaterial && template.kind === 'building' && !accent && !role && !['glass', 'stone'].includes(profile)) {
        // Keep a matte roof over every stepped volume without changing its silhouette.
        part(x, y + h / 2 - 0.001, z, w, 0.002, d, 1, round, false, 'roof');
      }
      return mesh;
    };
    if (profile === 'bundled') {
      // Every setback ends on the shared floor grid, so adjacent tubes keep their rows aligned.
      const heights = [0.52, 0.72, 0.92, 0.72, 1, 0.92, 0.52, 0.72, 0.52]
        .map(height => Math.round(height * 0.94 * facadeLayout.glass.rows) / facadeLayout.glass.rows);
      part(0, -0.49, 0, 1, 0.02, 1, 1, false, false, 'base');
      heights.forEach((h, i) => {
        const x = (i % 3 - 1) * 0.2;
        const z = (Math.floor(i / 3) - 1) * 0.22;
        part(x, -0.5 + h / 2, z, 0.2, h, 0.22);
      });
      for (const i of [4, 5]) {
        const roof = -0.5 + heights[i]!;
        part((i % 3 - 1) * 0.2, (roof + 0.5) / 2, 0, 0.012, 0.5 - roof, 0.012, 1.4);
      }
    } else if (profile === 'rounded' || profile === 'deco') {
      for (let i = 0; i < 3; i++) {
        const width = 1 - i * 0.23;
        part(i * 0.04, -0.5 + i * 0.28 + 0.14, 0, width, 0.28, width, 1, profile === 'rounded');
      }
      part(0.08, 0.39, 0, 0.23, 0.1, 0.23, 1, profile === 'rounded');
      part(0.08, 0.47, 0, 0.015, 0.06, 0.015, 1.3);
    } else if (profile === 'marina') {
      const { rings, bottom, step } = facadeLayout.marina;
      const top = bottom + rings * step;
      part(0, (bottom + top) / 2, 0, 0.78, top - bottom, 0.78, 0.75, true);
      part(0, (-0.5 + bottom) / 2, 0, 0.8, bottom + 0.5, 0.8, 1.15, true, false, 'base');
      for (let i = 0; i < rings; i++) part(0, bottom + i * step, 0, 1, 0.015, 1, 1.15, true, false, undefined, [0.78, 0.78]);
      part(0, (top + 0.5) / 2, 0, 0.8, 0.5 - top, 0.8, 1, true);
    } else if (profile === 'clock' || profile === 'gothic') {
      part(0, -0.21, 0, 1, 0.58, 1);
      part(0, 0.17, 0, 0.52, 0.3, 0.58, 1.08);
      part(0, 0.37, 0, 0.34, 0.1, 0.4, 1.18);
      part(0, 0.46, 0, 0.1, 0.08, 0.1, 0.75);
      if (detail < 2) for (const x of [-0.27, 0.27]) for (const z of [-0.28, 0.28]) part(x, 0.33, z, 0.07, 0.18, 0.07, 1.1);
      if (profile === 'gothic' && detail === 0) for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) part(x, -0.13, z, 0.055, 0.74, 0.055, 1.1);
      if (profile === 'clock' && detail === 0) for (const z of [-0.296, 0.296]) part(0, 0.22, z, 0.15, 0.05, 0.015, 0.45);
    } else if (profile === 'traffic_signal') {
      part(0, -0.12, 0, 0.14, 0.76, 0.14, 0.2);
      for (const angle of signalHeadings) {
        const housing = part(Math.sin(angle) * 0.2, 0.20, Math.cos(angle) * 0.2, 0.58, 0.25, 0.28, 0.12);
        housing.rotation.y = angle;
        for (const [i, color] of [[1, 0.04, 0.02], [0.12, 0.09, 0.01], [0.01, 0.09, 0.03]].entries()) {
          if (detail > 0 && i > 0) continue;
          const lens = part(Math.sin(angle) * 0.355, 0.275 - i * 0.075, Math.cos(angle) * 0.355, 0.32, 0.045, 0.035, 1, false, true);
          lens.rotation.y = angle;
          lens.setVerticesData('color', Array.from({ length: lens.getTotalVertices() }, () => [...color, 1]).flat());
        }
      }
    } else if (profile === 'lamp') {
      part(0, -0.03, 0, 0.13, 0.94, 0.13, 0.8, detail === 0);
      part(0.23, 0.43, 0, 0.55, 0.04, 0.08, 1.2);
      part(0.45, 0.4, 0, 0.25, 0.05, 0.25, 2, false, true);
    } else {
      part(0, 0, 0, 1, 1, 1);
    }
    if (panelled) {
      part(0, (-0.5 + bodyBottom) / 2, 0, 1.03, bodyBottom + 0.5, 1.03, 0.72, false, false, 'base');
      if (profile !== 'deco') part(0, (bodyTop + 0.5) / 2, 0, 1.02, 0.5 - bodyTop, 1.02, 1.25, false, false, 'roof');
      if (detail === 0 && !masonry) {
        // Place structural details on window-cell boundaries and keep them inside the opaque gaps.
        const beltHeight = Math.min(0.008, 1.6 * Math.min(grid.insetTop, grid.insetBottom) / facadeLayout.size * bodyHeight);
        const ribWidth = Math.min(0.012, 1.6 * grid.insetX / facadeLayout.size);
        for (let i = 1; i < 8; i++) {
          const row = Math.round(grid.rows * i / 8);
          part(0, bodyBottom + row / grid.rows * bodyHeight, 0, 1.005, beltHeight, 1.005, profile === 'glass' ? 0.7 : 0.87, false, false, undefined, [1, 1]);
        }
        for (const fraction of [1 / 6, 1 / 2, 5 / 6]) {
          const x = Math.round(grid.columns * fraction) / grid.columns - 0.5;
          for (const z of [-0.502, 0.502]) part(x, (bodyTop + bodyBottom) / 2, z, ribWidth, bodyHeight, 0.012, 1.25);
        }
      }
    }
    // Group by material so repeated details share a single submesh.
    const result = Mesh.MergeMeshes(pieces.sort((a, b) => a.material!.uniqueId - b.material!.uniqueId), true, true, undefined, false, true)!;
    result.name = `template-${template.id}-lod${detail}`;
    result.isPickable = false; result.checkCollisions = false; result.setEnabled(false);
    return result;
  });
}
