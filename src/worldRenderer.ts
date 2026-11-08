import { treeVariant } from './treeGeometry.ts';
import { windowMappingKey } from './windowMapping.ts';
import { RENDER_SETTINGS } from './renderSettings.ts';
import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import '@babylonjs/core/Meshes/instancedMesh.js';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { CELL_SIZE, cellAt, createWorld, objectProperties } from './world.ts';
import type { WorldData, WorldObject, ObjectTemplate } from './world.ts';
import { attachCollisionGeometry, buildArchitecture, createCollisionPrototype, setArchitectureStatic } from './architecture.ts';
import { drawChicagoStreets, updateStreetDetailLODs } from './streets.ts';
import { LodTransitions, lodDistance } from './lodTransitions.ts';
import { buildingSurface, streetSurface, facadeVariant } from './cityMaterials.ts';
import type { CityMaterials } from './cityMaterials.ts';
import type { Beacons } from './beacons.ts';

// Owns GPU instances, prototypes, collision roots and visibility; never reads DOM or storage.
export class WorldRenderer {
  readonly meshes = new Map<string, Mesh>();
  readonly modelLevels = new Map<Mesh, InstancedMesh[]>();
  readonly furnitureRoots: Mesh[] = [];
  readonly lodTransitions = new LodTransitions();
  proceduralMeshes: Mesh[] = [];
  initialLods = true;
  activeCell = '';
  world: WorldData;
  private lodDirty = true;
  private lodEye = new Vector3(Infinity, Infinity, Infinity);
  private lodPredicted = new Vector3(Infinity, Infinity, Infinity);
  private lodMode = '';
  private modelTemplates = new WeakMap<Mesh, ObjectTemplate>();
  private scene: Scene;
  private materials: CityMaterials;
  private beacons: Beacons;
  private templateMeshes = new Map<string, Mesh[]>();
  private colliderSource: Mesh;
  private originalTemplateColors = new Map(createWorld().templates.map(t => [t.id, t.color]));

  constructor(scene: Scene, materials: CityMaterials, beacons: Beacons, world: WorldData) {
    this.scene = scene; this.materials = materials; this.beacons = beacons; this.world = world;
    this.colliderSource = createCollisionPrototype(scene);
  }

  updateCellCoverage(mesh: Mesh) {
    this.lodDirty = true;
    const template = this.world.templates.find(t => t.id === mesh.metadata.templateId);
    if (template && mesh.metadata.windowMapping !== windowMappingKey(template, mesh.scaling.y)) {
      for (const child of mesh.getChildMeshes()) child.dispose();
      this.lodTransitions.forget(mesh);
      this.attachModel(mesh, template, mesh.metadata.modelColor, true);
    }
    mesh.computeWorldMatrix(true);
    for (const child of mesh.getChildMeshes()) if (child.metadata?.collisionOnly) child.computeWorldMatrix(true);
    const bounds = mesh.getBoundingInfo().boundingBox;
    mesh.metadata.minCellX = Math.floor(bounds.minimumWorld.x / CELL_SIZE);
    mesh.metadata.maxCellX = Math.floor(bounds.maximumWorld.x / CELL_SIZE);
    mesh.metadata.minCellZ = Math.floor(bounds.minimumWorld.z / CELL_SIZE);
    mesh.metadata.maxCellZ = Math.floor(bounds.maximumWorld.z / CELL_SIZE);
  }
  private attachModel(root: Mesh, template: ObjectTemplate, color: string, pickable: boolean) {
    if (template.profile === 'tree') template = { ...template, lodDistances: [25, 65] };
    this.lodDirty = true;
    this.modelTemplates.set(root, template);
    const headings = root.metadata.signalHeadings as number[] | undefined;
    const bodySurface = template.profile === 'stone' && root.scaling.y < 36 ? 'facade-brick' : buildingSurface(template);
    const variant = template.profile === 'tree' ? treeVariant(root.name) : template.kind === 'building' ? facadeVariant(root.name) : 0;
    const tint = template.profile === 'tree' || color !== this.originalTemplateColors.get(template.id) ? color : '#ffffff';
    const mapping = windowMappingKey(template, root.scaling.y);
    root.metadata.windowMapping = mapping;
    root.metadata.modelColor = color;
    const key = `${mapping}:${template.id}:${color}:${bodySurface}:${variant}:${headings?.join(',') ?? ''}`;
    let sources = this.templateMeshes.get(key);
    if (!sources) {
      sources = buildArchitecture(mapping ? { ...template, size: [template.size[0], root.scaling.y, template.size[2]] } : template, this.scene, this.materials.get(color, 'plain'), this.materials.get(template.profile === 'tree' ? '#675341' : color, 'plain', 0, 1), headings,
        (lod, accent, luminous, role) => this.materials.get(luminous ? '#ffffff' : tint,
          accent || luminous || role ? buildingSurface(template, accent, luminous, role) : bodySurface, lod, accent || luminous || role ? 1 : 0, variant), variant,
        template.profile === 'tree' ? this.materials.get(color, 'foliage') : undefined,
        template.profile === 'tree' ? this.materials.get(color, 'foliage', 2) : undefined);
      for (const source of sources) source.receiveShadows = true;
      this.templateMeshes.set(key, sources);
    }
    const levels = sources.map((source, i) => {
      const instance = source.createInstance(`${root.name}-lod${i}`);
      instance.parent = root; instance.isPickable = pickable;
      instance.metadata = { worldId: root.name, shadowCaster: template.kind === 'building', profile: template.profile }; instance.isVisible = i === sources.length - 1;
      return instance;
    });
    attachCollisionGeometry(root, sources[0]!);
    this.beacons.add(root, template);
    this.modelLevels.set(root, levels);
  }
  addMesh(o: WorldObject, editing: boolean) {
    const properties = objectProperties(this.world, o);
    const mesh = this.colliderSource.clone(o.id, null, true)!;
    mesh.setEnabled(true); mesh.isVisible = false; mesh.isPickable = false;
    mesh.position.copyFromFloats(...o.position); mesh.scaling.copyFromFloats(...properties.size);
    mesh.rotation.y = o.yaw;
    mesh.checkCollisions = true; mesh.metadata = { worldId: o.id, kind: properties.kind, templateId: o.templateId };
    this.attachModel(mesh, this.world.templates.find(t => t.id === o.templateId)!, properties.color, true);
    this.updateCellCoverage(mesh);
    setArchitectureStatic(mesh, !editing);
    this.meshes.set(o.id, mesh); return mesh;
  }
  removeMesh(mesh: Mesh) {
    this.meshes.delete(mesh.name);
    for (const level of this.modelLevels.get(mesh) ?? []) level.dispose();
    this.modelLevels.delete(mesh); this.lodTransitions.forget(mesh);
    mesh.dispose();
  }

  updateLODs(eye: Vector3, predictedLodEye: Vector3, editing: boolean, selected: Mesh | null, previewLod: number, night: number) {
    const mode = `${editing}:${selected?.uniqueId ?? -1}:${previewLod}:${night}`;
    if (!this.lodDirty && this.lodMode === mode && this.lodEye.equals(eye) && this.lodPredicted.equals(predictedLodEye)) return;
    this.lodDirty = false; this.lodMode = mode;
    this.lodEye.copyFrom(eye); this.lodPredicted.copyFrom(predictedLodEye);
    for (const [root, levels] of this.modelLevels) {
      if (root.isDisposed() || !root.isEnabled()) continue;
      const template = this.modelTemplates.get(root)!;
      root.computeWorldMatrix(!root.isSynchronized());
      const bounds = root.getBoundingInfo().boundingBox;
      const distance = lodDistance(eye, predictedLodEye, bounds);
      const level = editing && root === selected && previewLod >= 0 ? Math.min(previewLod, levels.length - 1) : (template.profile === 'tree' ? [25, 65] : template.lodDistances ?? []).filter(d => distance >= d).length;
      const range = template.profile === 'lamp' ? RENDER_SETTINGS.furnitureRange.lamp + night * RENDER_SETTINGS.furnitureRange.lampNightExtra : template.profile === 'traffic_signal' ? RENDER_SETTINGS.furnitureRange.signal : RENDER_SETTINGS.furnitureRange.other;
      this.lodTransitions.request(root, levels, root.metadata.kind === 'building' || distance < range || (editing && root === selected) ? level : -1);
      root.metadata.lod = level;
    }
    updateStreetDetailLODs(this.proceduralMeshes, eye, (key, levels, level) => this.lodTransitions.request(key, levels, level), predictedLodEye);
  }
  rebuild(editing: boolean) {
    this.lodDirty = true;
    const farLods = this.world.templates.filter(t => t.kind === 'building' && t.lodDistances?.length)
      .map(t => t.lodDistances!.at(-1)!).sort((a, b) => a - b);
    this.scene.fogEnd = (farLods[Math.floor(farLods.length / 2)] ?? 650) / 0.6;
    this.initialLods = true;
    this.lodTransitions.clear();
    this.activeCell = '';
    for (const levels of this.modelLevels.values()) for (const mesh of levels) mesh.dispose();
    this.modelLevels.clear();
    for (const m of [...this.proceduralMeshes, ...this.furnitureRoots]) m.dispose();
    this.proceduralMeshes = []; this.furnitureRoots.length = 0;
    for (const m of this.meshes.values()) m.dispose();
    this.meshes.clear();
    for (const sources of this.templateMeshes.values()) for (const source of sources) {
      if (source.material?.getClassName() === 'MultiMaterial') source.material.dispose();
      source.dispose();
    }
    this.templateMeshes.clear();
    for (const o of this.world.objects) this.addMesh(o, editing);
    if (this.world.environment === 'chicago-loop') {
      const streets = drawChicagoStreets(this.scene, (color, lod) => this.materials.get('#ffffff', streetSurface(color), lod, 0, 0, true)); this.proceduralMeshes = streets.meshes;
      for (const [i, prop] of streets.props.entries()) {
        let template = this.world.templates.find(t => t.id === prop.templateId);
        if (!template && prop.templateId === 'traffic_signal') {
          template = structuredClone(createWorld().templates.find(t => t.id === 'traffic_signal')!);
          this.world.templates.push(template);
        }
        if (!template) continue;
        const root = this.colliderSource.clone(`street-prop-${i}`, null, true)!;
        root.isVisible = false; root.isPickable = false; root.setEnabled(true);
        root.position.copyFromFloats(...prop.position); root.position.y += template.size[1] / 2;
        root.scaling.copyFromFloats(...template.size); root.rotation.y = prop.yaw;
        root.metadata = { templateId: template.id, kind: 'obstacle', signalHeadings: prop.headings };
        this.attachModel(root, template, template.color, false);
        setArchitectureStatic(root, !editing); this.furnitureRoots.push(root);
      }
    }
  }

  updateActiveCell(position: Vector3, editing: boolean) {
    if (editing) return false;
    const cell = cellAt(position.x, position.z);
    if (cell !== this.activeCell) {
      this.activeCell = cell;
      this.lodDirty = true;
      const [cx, cz] = cell.split(',').map(Number);
      // shortcut: cells only toggle existing meshes; load/unload assets when the map outgrows memory.
      for (const m of this.meshes.values()) {
        const b = m.metadata;
        const enabled = (b.minCellX <= cx! + RENDER_SETTINGS.activeCellRadius && b.maxCellX >= cx! - RENDER_SETTINGS.activeCellRadius && b.minCellZ <= cz! + RENDER_SETTINGS.activeCellRadius && b.maxCellZ >= cz! - RENDER_SETTINGS.activeCellRadius) || m.scaling.y > RENDER_SETTINGS.keepTallBuildings;
        if (!enabled && m.isEnabled()) this.lodTransitions.hide(m);
        m.setEnabled(enabled);
      }
      return true;
    }
    return false;
  }
}
