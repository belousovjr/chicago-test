import { streetSurface } from './cityMaterials.ts';
import { treeOverlapsRoad } from './treePlacement.ts';
import { wallSections } from './wallGeometry.ts';
import { RENDER_SETTINGS } from './renderSettings.ts';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import { lodDistance } from './lodTransitions.ts';
import chicago from './generated/chicago.json' with { type: 'json' };
import { WATER_LEVEL, riverbedElevation } from './water.ts';

// Furniture positions are ground anchors; their template height is applied by the scene.
export type StreetFurniture = { templateId: 'tree' | 'lamp' | 'traffic_signal'; position: [number, number, number]; yaw: number; headings?: number[] };
export function elevationAt(_x: number, _z: number, surface: 'street' | 'sidewalk' | 'water' | 'riverwalk' = 'street') {
  // shortcut: flat Loop datum plus stylized river terraces; replace with surveyed terrain when available.
  return { street: 0, sidewalk: 0.16, water: WATER_LEVEL, riverwalk: -3.8 }[surface];
}

const streetLodGroups = new WeakMap<Mesh[], Map<string, Mesh[]>>();

// Visibility never disables the near mesh: its collision geometry remains available.
export function updateStreetDetailLODs(meshes: Mesh[], eye: Vector3, transition?: (key: Mesh, levels: Mesh[], level: number) => void, predictedEye = eye) {
  const cached = transition ? streetLodGroups.get(meshes) : undefined;
  const groups = transition ? cached ?? new Map<string, Mesh[]>() : null;
  if (!cached) for (const mesh of meshes) {
    const layer = mesh.metadata?.detailLayer;
    if (!layer || layer === 'world') continue;
    if (groups) {
      const key = mesh.name.slice(0, mesh.name.lastIndexOf(','));
      const levels = groups.get(key) ?? [];
      levels[mesh.metadata.detailLevel] = mesh;
      groups.set(key, levels);
    } else {
      const bounds = mesh.metadata.lodBounds ?? mesh.getBoundingInfo().boundingBox;
      const distance = lodDistance(eye, predictedEye, bounds);
      const [near, far] = layer === 'marking' ? RENDER_SETTINGS.streetLod.marking : RENDER_SETTINGS.streetLod.structure;
      mesh.isVisible = distance < far && (mesh.metadata.detailLevel === 0 ? distance < near : distance >= near);
    }
  }
  if (groups && !cached) streetLodGroups.set(meshes, groups);
  if (groups) for (const levels of groups.values()) {
    const first = levels[0] ?? levels[1]!;
    const bounds = first.metadata.lodBounds ?? first.getBoundingInfo().boundingBox;
    const distance = lodDistance(eye, predictedEye, bounds);
    const [near, far] = first.metadata.detailLayer === 'marking' ? RENDER_SETTINGS.streetLod.marking : RENDER_SETTINGS.streetLod.structure;
    const target = distance >= far ? -1 : distance < near ? 0 : 1;
    const present = levels.filter(Boolean);
    transition!(first, present, present.findIndex(mesh => mesh.metadata.detailLevel === target));
  }
}

// Procedural surfaces are batched by 256 m cell and material, not editable world-object records.
export function drawChicagoStreets(scene: Scene, material: (color: string, lod: number) => Material) {
  const batches = new Map<string, { positions: number[]; indices: number[]; color: string; collision: boolean; layer: string; level: number }>();
  const props: StreetFurniture[] = [];
  const cube = VertexData.CreateBox({ size: 1 });
  let detailLayer = 'world', detailLevel = 0;
  function batch(x: number, z: number, color: string, collision: boolean) {
    const cell = detailLayer === 'world' ? 256 : 128;
    const key = `${Math.floor(x / cell)},${Math.floor(z / cell)},${color},${collision},${detailLayer},${detailLevel}`;
    if (!batches.has(key)) batches.set(key, { positions: [], indices: [], color, collision, layer: detailLayer, level: detailLevel });
    return batches.get(key)!;
  }
  function box(x: number, y: number, z: number, w: number, h: number, d: number, yaw: number, color: string, collision = true, roll = 0) {
    const b = batch(x, z, color, collision), offset = b.positions.length / 3;
    const cos = Math.cos(yaw), sin = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll), p = cube.positions!;
    for (let i = 0; i < p.length; i += 3) {
      const px = p[i]! * w * cr - p[i + 1]! * h * sr, py = p[i]! * w * sr + p[i + 1]! * h * cr, pz = p[i + 2]! * d;
      b.positions.push(x + px * cos + pz * sin, y + py, z - px * sin + pz * cos);
    }
    for (const i of cube.indices!) b.indices.push(offset + i);
  }
  function surface(triangles: number[][][], y: number | ((x: number, z: number) => number), color: string, collision: boolean, downward = false) {
    for (const tri of triangles) {
      const x = tri.reduce((s, p) => s + p[0]!, 0) / 3, z = tri.reduce((s, p) => s + p[1]!, 0) / 3;
      const b = batch(x, z, color, collision), offset = b.positions.length / 3;
      // Upward faces, regardless of GIS polygon winding.
      const [a, c, d] = tri;
      const points = (c![0]! - a![0]!) * (d![1]! - a![1]!) - (c![1]! - a![1]!) * (d![0]! - a![0]!) < 0 ? [a!, d!, c!] : [a!, c!, d!];
      if (downward) points.reverse();
      for (const p of points) b.positions.push(p[0]!, typeof y === 'number' ? y : y(p[0]!, p[1]!), p[1]!);
      b.indices.push(offset, offset + 1, offset + 2);
    }
  }
  function paintRectangle(x: number, z: number, width: number, depth: number, yaw: number) {
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const p = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) =>
      [x + a! * width / 2 * cos + b! * depth / 2 * sin, z - a! * width / 2 * sin + b! * depth / 2 * cos]);
    surface([[p[0]!, p[1]!, p[2]!], [p[0]!, p[2]!, p[3]!]], 0.055, '#c3baa1', false);
  }
  function walls(lines: number[][][], bottom: number | ((x: number, z: number) => number), top: number, color: string, collision = true) {
    if (typeof bottom === 'function') lines = lines.map(line => line.flatMap((a, i) => {
      const c = line[i + 1];
      if (!c) return [a];
      const count = Math.ceil(Math.hypot(c[0]! - a[0]!, c[1]! - a[1]!) / 2);
      return Array.from({ length: count }, (_, j) => [a[0]! + (c[0]! - a[0]!) * j / count, a[1]! + (c[1]! - a[1]!) * j / count]);
    }));
    for (const line of lines) {
      const sections = wallSections(line);
      const closed = sections.length > 2 && sections[0] === sections.at(-1);
      for (let i = 1; i < sections.length; i++) {
        const a = sections[i - 1]!, c = sections[i]!;
        const lowA = typeof bottom === 'number' ? bottom : bottom(a.point[0]!, a.point[1]!);
        const lowC = typeof bottom === 'number' ? bottom : bottom(c.point[0]!, c.point[1]!);
        const b = batch((a.point[0]! + c.point[0]!) / 2, (a.point[1]! + c.point[1]!) / 2, color, collision);
        const al = [a.left[0]!, lowA, a.left[1]!], ar = [a.right[0]!, lowA, a.right[1]!];
        const cl = [c.left[0]!, lowC, c.left[1]!], cr = [c.right[0]!, lowC, c.right[1]!];
        const alt = [al[0]!, top, al[2]!], art = [ar[0]!, top, ar[2]!];
        const clt = [cl[0]!, top, cl[2]!], crt = [cr[0]!, top, cr[2]!];
        const faces = [[al, alt, clt, cl], [cr, crt, art, ar], [alt, art, crt, clt], [ar, al, cl, cr]];
        if (!closed && i === 1) faces.push([ar, art, alt, al]);
        if (!closed && i === sections.length - 1) faces.push([cl, clt, crt, cr]);
        for (const face of faces) {
          for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
            const offset = b.positions.length / 3;
            for (const i of triangle) b.positions.push(...face[i]!);
            b.indices.push(offset, offset + 1, offset + 2);
          }
        }
      }
    }
  }
  const data = chicago.environment;
  props.push(...data.trafficSignals.map(signal => ({ templateId: 'traffic_signal' as const, position: [...signal.position] as [number, number, number], yaw: signal.yaw, headings: signal.headings })));
  props.push(...data.lamps.map(lamp => ({ templateId: 'lamp' as const, position: [...lamp.position] as [number, number, number], yaw: lamp.yaw })));
  function drawTerrain() {
  for (const cell of data.terrain) surface(cell.triangles, elevationAt(0, 0), '#85877d', true);
  surface(data.water, elevationAt(0, 0, 'water'), '#517d85', false);
  surface(data.waterbed, riverbedElevation, '#6a644e', true);
  surface(data.riverwalk, elevationAt(0, 0, 'riverwalk'), '#b1a993', true);
  surface(data.parks, elevationAt(0, 0), '#71896a', true);
  }
  drawTerrain();
  surface(data.roadSurface, 0.03, '#454e50', true);
  surface(data.sidewalks, elevationAt(0, 0, 'sidewalk'), '#b6b2a4', true);
  surface(data.curbs, 0.18, '#c0bba9', false);
  for (const edge of data.pavingEdges) walls(edge.lines, 0, edge.top, edge.color, false);
  detailLayer = 'marking';
  for (detailLevel of [0, 1]) {
    for (const crossing of data.crosswalks) {
      if (detailLevel === 0) surface(crossing.stripes, 0.055, '#c3baa1', false);
      else {
        const [cx, cz] = crossing.centre, [ux, uz] = crossing.direction;
        for (const side of [-1, 1]) paintRectangle(cx! + ux! * side * (crossing.depth / 2 - 0.08), cz! + uz! * side * (crossing.depth / 2 - 0.08),
          crossing.width - 0.2, 0.16, -Math.atan2(ux!, -uz!));
      }
      surface(crossing.stopLine, 0.055, '#c3baa1', false);
    }
    for (const road of data.roads) {
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!, b = road.points[i]!;
        const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, length = Math.hypot(dx, dz);
        if (length < 1) continue;
        const yaw = -Math.atan2(dz, dx);
        const nx = -dz / length, nz = dx / length;
        for (let distance = 9; distance < length - 10; distance += 16) {
          const t = distance / length;
          const x = a[0]! + dx * t, z = a[1]! + dz * t;
          if (data.crosswalks.some(crossing => {
            const rx = x - crossing.centre[0]!, rz = z - crossing.centre[1]!;
            const [ux, uz] = crossing.direction;
            return Math.abs(rx * ux! + rz * uz!) < crossing.depth / 2 + 4
              && Math.abs(-rx * uz! + rz * ux!) < crossing.width / 2 + 2.1;
          })) continue;
          if (detailLevel === 0) box(x, 0.055, z, 4, 0.01, 0.16, yaw, '#c3baa1', false);
          else paintRectangle(x, z, 4, 0.16, yaw);
        }
        if (detailLevel === 0 && !road.bridge && length > 45) for (let distance = 25; distance < length - 20; distance += 85) {
          const side = road.width / 2 + 2.2, t = distance / length;
          if (data.trafficSignals.some(signal => Math.hypot(signal.position[0]! - (a[0]! + dx * t - nx * side), signal.position[2]! - (a[1]! + dz * t - nz * side)) < 2)) continue;
          props.push({ templateId: 'tree', position: [a[0]! + dx * t - nx * side, 0, a[1]! + dz * t - nz * side], yaw: 0 });
        }
      }
    }
  }
  detailLayer = 'world'; detailLevel = 0;
  function drawElevatedRailway() {
    const railway = data.railway;
    surface(railway.deck, 6, '#505b55', true);
    surface(railway.deck, 5.65, '#505b55', true, true);
    walls(railway.edges, 5.65, 6, '#505b55');
    surface(railway.rails, 6.16, '#959b92', false);
    walls(railway.railEdges, 6, 6.16, '#959b92', false);
    detailLayer = 'rail-structure';
    for (detailLevel of [0, 1]) {
      for (const truss of railway.bridgeTrusses) {
        const color = '#655044', bottom = truss.bankSupported ? 0.15 : 0.18, top = 5.5;
        for (const side of truss.sides) {
          const [a, b] = side, dx = b![0]! - a![0]!, dz = b![1]! - a![1]!;
          const length = Math.hypot(dx, dz), yaw = -Math.atan2(dz, dx);
          for (const y of [bottom, top]) box((a![0]! + b![0]!) / 2, y, (a![1]! + b![1]!) / 2, length + 0.3, 0.3, 0.3, yaw, color);
          for (let j = 0; j <= truss.panels; j++) {
            if (detailLevel === 1 && j !== 0 && j !== truss.panels) continue;
            const t = j / truss.panels;
            box(a![0]! + dx * t, (bottom + top) / 2, a![1]! + dz * t, 0.3, top - bottom, 0.3, yaw, color);
            if (detailLevel === 0 && j < truss.panels) {
              const rise = (j % 2 === 0 ? 1 : -1) * (top - bottom), run = length / truss.panels;
              box(a![0]! + dx * (j + 0.5) / truss.panels, (bottom + top) / 2, a![1]! + dz * (j + 0.5) / truss.panels,
                Math.hypot(run, rise), 0.22, 0.22, yaw, color, true, Math.atan2(rise, run));
            }
          }
        }
        for (let j = 0; j <= truss.panels; j++) {
          if (detailLevel === 1 && j !== 0 && j !== truss.panels) continue;
          const t = j / truss.panels;
          const [a, b] = truss.sides.map(side => [side[0]![0]! + (side[1]![0]! - side[0]![0]!) * t, side[0]![1]! + (side[1]![1]! - side[0]![1]!) * t]);
          const dx = b![0]! - a![0]!, dz = b![1]! - a![1]!;
          box((a![0]! + b![0]!) / 2, top, (a![1]! + b![1]!) / 2, Math.hypot(dx, dz), 0.3, 0.3, -Math.atan2(dz, dx), color);
        }
      }
      for (let i = 0; i < railway.supports.length; i += 2) {
        const pair = railway.supports.slice(i, i + 2);
        const [a, b] = pair.map(s => s.position);
        const dx = b![0]! - a![0]!, dz = b![2]! - a![2]!, span = Math.hypot(dx, dz);
        const ux = dx / span, uz = dz / span, yaw = -Math.atan2(dz, dx);
        const ends = [...pair.map(s => s.position), ...pair.map(s => [s.attachment[0]!, 0, s.attachment[1]!])];
        const projections = ends.map(p => (p[0]! - a![0]!) * ux + (p[2]! - a![2]!) * uz);
        const left = Math.min(...projections) - 0.25, right = Math.max(...projections) + 0.25, middle = (left + right) / 2;
        box(a![0]! + ux * middle, 5.45, a![2]! + uz * middle, right - left, 0.4, 0.5, yaw, '#505b55');
        for (const [j, support] of pair.entries()) {
          const [x, base, z] = support.position, height = support.top - base!;
          box(x!, base! + height / 2, z!, 0.35, height, 0.35, yaw, '#505b55');
          if (detailLevel === 1) continue;
          box(x!, base! + 0.15, z!, 0.65, 0.3, 0.65, yaw, '#868b83');
          const reach = Math.min(1.25, span / 4), sign = j === 0 ? 1 : -1;
          const braceX = ux * reach * sign, braceZ = uz * reach * sign;
          box(x! + braceX / 2, 4.9, z! + braceZ / 2, Math.hypot(reach, 1.1), 0.18, 0.18,
            -Math.atan2(braceZ, braceX), '#505b55', true, Math.atan2(1.1, reach));
        }
      }
    }
    detailLayer = 'world'; detailLevel = 0;
  }
  drawElevatedRailway();
  walls(data.shorelines, (x, z) => riverbedElevation(x, z) - 1, -3.8, '#868b83');
  walls(data.terraceWalls, (x, z) => riverbedElevation(x, z) - 1, 0, '#868b83');
  surface(data.bridgeDeck, -0.85, '#505b55', true, true);
  walls(data.bridgeEdges, -0.85, 0, '#505b55');
  walls(data.bridgeAbutments, (x, z) => Math.min(-5.8, riverbedElevation(x, z) - 1), -0.85, '#868b83');
  for (const line of data.bridgeRails) for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!, dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
    box((a[0]! + b[0]!) / 2, 0.66, (a[1]! + b[1]!) / 2, Math.hypot(dx, dz), 1, 0.18, -Math.atan2(dz, dx), '#868b83');
  }
  // Concrete colours resolve to the same material; combine within the existing cell/collision/shadow boundaries.
  const combined = new Map<string, { key: string; batch: ReturnType<typeof batch> }>();
  for (const [key, b] of batches) {
    const surfaceMaterial = material(b.color, b.level);
    const shadow = ['#505b55', '#868b83'].includes(b.color);
    const cell = key.split(',').slice(0, 2).join(',');
    const mergeKey = b.layer === 'world' && streetSurface(b.color) === 'concrete'
      ? `${cell}:${surfaceMaterial.uniqueId}:${b.collision}:${shadow}` : key;
    const existing = combined.get(mergeKey);
    if (!existing) combined.set(mergeKey, { key, batch: b });
    else {
      const offset = existing.batch.positions.length / 3;
      for (const value of b.positions) existing.batch.positions.push(value);
      for (const index of b.indices) existing.batch.indices.push(offset + index);
    }
  }
  const meshes: Mesh[] = [];
  const fullBatches = new Map<string, Mesh>();
  for (const { key, batch: b } of combined.values()) {
    const mesh = new Mesh(`street-${key}`, scene), vertexData = new VertexData();
    vertexData.positions = b.positions; vertexData.indices = b.indices;
    const normals: number[] = []; VertexData.ComputeNormals(b.positions, b.indices, normals); vertexData.normals = normals;
    // World-space planar UVs keep density and seams stable across cells and LODs.
    vertexData.uvs = []; vertexData.uvs2 = [];
    for (let i = 0; i < b.positions.length; i += 3) {
      vertexData.uvs2.push((b.positions[i]! - data.bounds[0]!) / (data.bounds[2]! - data.bounds[0]!), (b.positions[i + 2]! - data.bounds[1]!) / (data.bounds[3]! - data.bounds[1]!));
      const nx = Math.abs(normals[i]!), ny = Math.abs(normals[i + 1]!), nz = Math.abs(normals[i + 2]!);
      vertexData.uvs.push((ny > 0.5 || nz >= nx ? b.positions[i]! : b.positions[i + 2]!) / 4,
        (ny > 0.5 ? b.positions[i + 2]! : b.positions[i + 1]!) / 4);
    }
    vertexData.applyToMesh(mesh); mesh.material = material(b.color, b.level); mesh.checkCollisions = b.collision && b.level === 0;
    mesh.isPickable = mesh.checkCollisions; mesh.metadata = { worldId: mesh.name, kind: 'ground', procedural: true, surface: b.color, detailLayer: b.layer, detailLevel: b.level, shadowCaster: b.layer === 'rail-structure' || ['#505b55', '#868b83'].includes(b.color) };
    mesh.isVisible = b.level === 0;
    mesh.freezeWorldMatrix(); meshes.push(mesh);
    const lodKey = key.slice(0, key.lastIndexOf(','));
    if (b.level === 0) fullBatches.set(lodKey, mesh);
    else mesh.metadata.lodBounds = fullBatches.get(lodKey)?.getBoundingInfo().boundingBox;
  }
  const beds = meshes.filter(mesh => mesh.name.includes('#6a644e'));
  const waterMaterials = new Set(meshes.filter(mesh => mesh.name.includes('#517d85')).map(mesh => mesh.material!));
  for (const bed of beds) bed.isVisible = false;
  const waterView = scene.onBeforeCameraRenderObservable.add(camera => {
    const underwater = camera.globalPosition.y < WATER_LEVEL;
    // The near plane can cross the surface while the camera origin is still above it.
    const aspect = scene.getEngine().getAspectRatio(camera);
    const nearRadius = camera.minZ * Math.sqrt(1 + Math.tan(camera.fov / 2) ** 2 * (1 + aspect ** 2));
    for (const bed of beds) bed.isVisible = camera.globalPosition.y - nearRadius < WATER_LEVEL;
    for (const material of waterMaterials) material.alpha = underwater ? .95 : 1;
  });
  meshes[0]?.onDisposeObservable.addOnce(() => scene.onBeforeCameraRenderObservable.remove(waterView));
  const groundRay = new Ray(Vector3.Zero(), Vector3.Down(), 7);
  for (let index = props.length - 1; index >= 0; index--) {
    const prop = props[index]!;
    prop.position[0] = Math.max(data.bounds[0]! + 0.25, Math.min(data.bounds[2]! - 0.25, prop.position[0]));
    prop.position[2] = Math.max(data.bounds[1]! + 0.25, Math.min(data.bounds[3]! - 0.25, prop.position[2]));
    if (prop.templateId === 'tree' && treeOverlapsRoad(prop.position[0], prop.position[2], data.roadSurface)) {
      props.splice(index, 1);
      continue;
    }
    groundRay.origin.set(prop.position[0], 0.5, prop.position[2]);
    let floor = -Infinity;
    for (const mesh of meshes) if (mesh.checkCollisions) {
      const hit = groundRay.intersectsMesh(mesh);
      if (hit.hit) floor = Math.max(floor, hit.pickedPoint!.y);
    }
    if (!Number.isFinite(floor)) throw new Error(`No ground beneath ${prop.templateId} at ${prop.position[0]}, ${prop.position[2]}`);
    prop.position[1] = floor;
  }
  return { meshes, props };
}
