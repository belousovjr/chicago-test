import { shadowReaches } from './dayNight.ts';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { SubMesh } from '@babylonjs/core/Meshes/subMesh.js';
import { MultiMaterial } from '@babylonjs/core/Materials/multiMaterial.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { DitheredTileFadeMaterialPlugin } from '@babylonjs/core/Materials/ditheredTileFadeMaterialPlugin.js';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { MaterialDefines } from '@babylonjs/core/Materials/materialDefines.js';

// Keep per-object Bayer intervals while submitting static city surfaces by material.
class BatchFade extends MaterialPluginBase {
  constructor(material: StandardMaterial) { super(material, 'BatchFade', 195, { BATCH_FADE: false }, true, true); this.doNotSerialize = true; }
  getClassName() { return 'BatchFade'; }
  prepareDefines(defines: MaterialDefines, _scene: Scene, mesh: AbstractMesh) { (defines as MaterialDefines & { BATCH_FADE: boolean }).BATCH_FADE = mesh.isVerticesDataPresent('batchFade'); }
  getAttributes(attributes: string[]) { attributes.push('batchFade'); }
  getCustomCode(shaderType: string): Record<string, string> {
    if (shaderType === 'vertex') return {
      CUSTOM_VERTEX_DEFINITIONS: '#ifdef BATCH_FADE\nattribute vec2 batchFade; varying vec2 vBatchFade;\n#endif',
      CUSTOM_VERTEX_MAIN_BEGIN: '#ifdef BATCH_FADE\nvBatchFade = batchFade;\n#endif',
    };
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef BATCH_FADE\nvarying vec2 vBatchFade;\n#endif',
      CUSTOM_FRAGMENT_MAIN_BEGIN: '#ifdef BATCH_FADE\nif (vBatchFade.x > 0. || vBatchFade.y < 1.) { float batchThreshold = bayerDither8(floor(gl_FragCoord.xy)) / 64.; if (batchThreshold < vBatchFade.x || batchThreshold >= vBatchFade.y) discard; }\n#endif',
    };
  }
}

type Entry = { source: Mesh | InstancedMesh; offset: number; count: number; parts: { material: number; indices: Uint32Array }[]; indices: Uint32Array; lower: number; upper: number; visible: boolean; shadow: boolean; matrix: number };

/** Draw-only buffers. Original meshes continue to own picking, collisions and editable state. */
export class RenderBatches {
  readonly mesh: Mesh;
  readonly shadow: Mesh;
  private entries: Entry[] = [];
  private materials: StandardMaterial[] = [];
  private positions: Float32Array;
  private normals: Int8Array;
  private fades: Float32Array;
  private indices: Uint32Array;
  private shadowIndices: Uint32Array;
  private bounds = { lowerBound: 0, upperBound: 1 };
  private multi: MultiMaterial;
  private shadowMaterial: StandardMaterial;

  private subMeshes: SubMesh[];
  private sources: (Mesh | InstancedMesh)[];
  private scene: Scene;
  private revision = -1;
  private eye = new Vector3(Infinity,Infinity,Infinity);
  private sun = Vector3.Zero();
  private view = Matrix.Zero();

  constructor(scene: Scene, sources: (Mesh | InstancedMesh)[]) {
    this.scene = scene; this.sources = sources.slice();
    // Alpha-tested foliage keeps Babylon's hardware instances and cutout shadow handling.
    sources = sources.filter(source => source.metadata?.profile !== 'tree' && !['#517d85', '#6a644e'].includes(source.metadata?.surface) && source.getTotalVertices() > 0);
    const vertices = sources.reduce((n, source) => n + source.getTotalVertices(), 0);
    const indices = sources.reduce((n, source) => n + source.getTotalIndices(), 0);
    this.positions = new Float32Array(vertices * 3); this.normals = new Int8Array(vertices * 3);
    this.fades = new Float32Array(vertices * 2); this.indices = new Uint32Array(indices); this.shadowIndices = new Uint32Array(indices);
    const uvs = new Float32Array(vertices * 2), uv2 = new Float32Array(vertices * 2), colors = new Uint8Array(vertices * 4); colors.fill(255);
    let offset = 0;
    for (const source of sources) {
      const count = source.getTotalVertices(), original = source.getIndices()!;
      const parts = source.subMeshes.map(sub => {
        const material = sub.getMaterial() as StandardMaterial;
        let index = this.materials.indexOf(material);
        if (index < 0) {
          index = this.materials.length; this.materials.push(material);
          if (!material.pluginManager?.getPlugin('BatchFade')) new BatchFade(material);
        }
        return { material: index, indices: Uint32Array.from(Array.from(original).slice(sub.indexStart, sub.indexStart + sub.indexCount), value => value + offset) };
      });
      this.entries.push({ source, offset, count, parts, indices: Uint32Array.from(original, value => value + offset), lower: -1, upper: -1, visible: false, shadow: false, matrix: -1 });
      const uv = source.getVerticesData('uv'), secondary = source.getVerticesData('uv2'), color = source.getVerticesData('color');
      if (uv) uvs.set(uv, offset * 2);
      if (secondary) uv2.set(secondary, offset * 2);
      if (color) for (let i = 0; i < color.length; i++) colors[offset * 4 + i] = Math.round(color[i]! * 255);
      source.metadata = { ...source.metadata, renderSource: true };
      offset += count;
    }
    this.mesh = new Mesh('city-batch', scene);
    this.mesh.setVerticesData('position', this.positions, true); this.mesh.setVerticesBuffer(new VertexBuffer(scene.getEngine(), this.normals, 'normal', true, false, 3, false, 0, 3, VertexBuffer.BYTE, true));
    this.mesh.setVerticesData('uv', uvs); this.mesh.setVerticesData('uv2', uv2); this.mesh.setVerticesBuffer(new VertexBuffer(scene.getEngine(), colors, 'color', false, false, 4, false, 0, 4, VertexBuffer.UNSIGNED_BYTE, true));
    this.mesh.setVerticesData('batchFade', this.fades, true, 2); this.mesh.setIndices(this.indices, vertices, true);
    this.multi = new MultiMaterial('city-batch-materials', scene); this.multi.subMaterials = this.materials; this.mesh.material = this.multi;
    this.mesh.releaseSubMeshes();
    this.subMeshes = this.materials.map((_, index) => new SubMesh(index, 0, vertices, 0, 0, this.mesh));
    this.mesh.isVisible = false; this.mesh.isPickable = false; this.mesh.receiveShadows = true; this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.metadata = { procedural: true, shadowCaster: false, renderBatch: true };
    this.mesh.freezeWorldMatrix();
    this.shadow = new Mesh('city-shadow-batch', scene);
    this.shadow.setVerticesData('position', this.positions, true); this.shadow.setIndices(this.shadowIndices, vertices, true);
    this.shadowMaterial = new StandardMaterial('city-shadow-material', scene); this.shadow.material = this.shadowMaterial;
    this.shadow.isVisible = false; this.shadow.isPickable = false; this.shadow.metadata = { shadowOnly: true, shadowCaster: true };
    this.shadow.freezeWorldMatrix();
    this.update(Vector3.Zero(), new Vector3(0,-1,0));
  }

  update(eye: Vector3, sunDirection: Vector3, revision = -1, editing = true, selected: Mesh | null = null) {
    const view = this.scene.getTransformMatrix();
    if (revision >= 0 && (!editing || !selected) && revision === this.revision && this.eye.equals(eye) && this.sun.equals(sunDirection) && view.equals(this.view)) return false;
    this.revision = revision; this.eye.copyFrom(eye); this.sun.copyFrom(sunDirection); this.view.copyFrom(view);
    let geometryDirty = false, indicesDirty = false, fadesDirty = false, shadowsDirty = false;
    const frustum = this.scene.frustumPlanes;
    for (const entry of this.entries) {
      const source = entry.source;
      if (source.isDisposed()) continue;
      const world = source.computeWorldMatrix();
      if (entry.matrix !== world.updateFlag) {
        const normalMatrix = Matrix.Transpose(Matrix.Invert(world));
        const positions = source.getVerticesData('position')!, normals = source.getVerticesData('normal')!;
        const point = new Vector3(), normal = new Vector3();
        for (let i = 0; i < entry.count; i++) {
          Vector3.TransformCoordinatesFromFloatsToRef(positions[i*3]!,positions[i*3+1]!,positions[i*3+2]!,world,point);
          Vector3.TransformNormalFromFloatsToRef(normals[i*3]!,normals[i*3+1]!,normals[i*3+2]!,normalMatrix,normal);normal.normalize();
          point.toArray(this.positions,(entry.offset+i)*3);
          this.normals[(entry.offset+i)*3]=Math.round(normal.x*127);this.normals[(entry.offset+i)*3+1]=Math.round(normal.y*127);this.normals[(entry.offset+i)*3+2]=Math.round(normal.z*127);
        }
        entry.matrix = world.updateFlag; geometryDirty = true;
      }
      const enabled = source.isVisible && source.visibility > 0 && source.isEnabled();
      const visible = enabled && (!frustum || source.isInFrustum(frustum));
      if (entry.visible !== visible) { entry.visible = visible; indicesDirty = true; }
      if (enabled) {
        const material = this.materials[entry.parts[0]!.material]!;
        DitheredTileFadeMaterialPlugin.GetOrCreate(material).getFadeBoundsToRef(source, this.bounds);
        if (entry.lower !== this.bounds.lowerBound || entry.upper !== this.bounds.upperBound) {
          entry.lower = this.bounds.lowerBound; entry.upper = this.bounds.upperBound;
          for (let i = entry.offset; i < entry.offset + entry.count; i++) { this.fades[i*2] = entry.lower; this.fades[i*2+1] = entry.upper; }
          fadesDirty = true;
        }
      }
      let shadow = enabled && source.metadata?.shadowCaster !== false && source.metadata?.detailLayer !== 'rail-structure' && (!source.metadata?.procedural || source.metadata.shadowCaster);
      if (shadow) shadow = shadowReaches(source, eye, sunDirection);
      if (shadow !== entry.shadow) { entry.shadow = shadow; shadowsDirty = true; }
    }
    if (geometryDirty) {
      this.mesh.updateVerticesData('position',this.positions,true);this.mesh.getVertexBuffer('normal')!.update(this.normals);
      this.shadow.updateVerticesData('position',this.positions,true);
    }
    if (fadesDirty) this.mesh.updateVerticesData('batchFade',this.fades);
    if (indicesDirty) {
      let count=0;
      for(let i=0;i<this.materials.length;i++) {
        const sub=this.subMeshes[i]!;sub.indexStart=count;
        for(const entry of this.entries) if(entry.visible) for(const part of entry.parts) if(part.material===i) { this.indices.set(part.indices,count);count+=part.indices.length; }
        sub.indexCount=count-sub.indexStart;
      }
      this.mesh.subMeshes = this.subMeshes.filter(sub => sub.indexCount > 0);
      this.scene.getEngine().updateDynamicIndexBuffer(this.mesh.geometry!.getIndexBuffer()!,this.indices.subarray(0,count));this.mesh.isVisible=count>0;
    }
    if (shadowsDirty) {
      let count=0;
      for(const entry of this.entries) if(entry.shadow) { this.shadowIndices.set(entry.indices,count);count+=entry.indices.length; }
      this.scene.getEngine().updateDynamicIndexBuffer(this.shadow.geometry!.getIndexBuffer()!,this.shadowIndices.subarray(0,count));this.shadow.subMeshes[0]!.indexCount=count;this.shadow.isVisible=count>0;
    }
    return geometryDirty || shadowsDirty;
  }

  matchesSources(sources: (Mesh | InstancedMesh)[]) {
    return sources.length === this.sources.length && sources.every((source, i) => source === this.sources[i]);
  }

  dispose() {
    for(const entry of this.entries) if(!entry.source.isDisposed()) delete entry.source.metadata.renderSource;
    this.mesh.dispose();this.shadow.dispose();this.multi.dispose();this.shadowMaterial.dispose();
  }
}
