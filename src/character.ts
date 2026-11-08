import type { Scene } from '@babylonjs/core/scene.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/2.0/glTFLoader.js';
import { initialPlayerState, stepPlayer } from './player.ts';
import type { PlayerInput } from './player.ts';
import { AnimationBlend } from './animationBlend.ts';
import { WaterPalette } from './waterPalette.ts';

export class Character {
  readonly body: Mesh;
  readonly visual: TransformNode;
  state = initialPlayerState();
  private scene: Scene;
  private fallback: Mesh;
  private blend?: AnimationBlend;

  constructor(scene: Scene, fallbackMaterial: Material) {
    this.scene = scene;
    this.body = MeshBuilder.CreateBox('player-collider', { size: 1 }, scene);
    this.body.isVisible = false; this.body.isPickable = false;
    this.body.collisionMask = 1;
    this.body.ellipsoid.set(0.35, 0.9, 0.35); this.body.ellipsoidOffset.set(0, 0.9, 0);
    this.visual = new TransformNode('player-visual', scene);
    this.visual.parent = this.body;
    scene.onAfterAnimationsObservable.add(() => {
      const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, .1);
      if (this.state.grounded && (this.blend?.transitioning || Math.abs(this.visual.rotation.x) + Math.abs(this.visual.rotation.z) > .001)) {
        const previous = this.visual.position.y;
        this.visual.position.y = 0;
        this.visual.computeWorldMatrix(true);
        let bottom = Infinity;
        // Only sample the animated geometry during landing; the collision capsule stays unchanged.
        for (const mesh of this.visual.getChildMeshes()) {
          mesh.computeWorldMatrix(true);
          if (mesh instanceof Mesh) {
            mesh.skeleton?.prepare(true);
            mesh.refreshBoundingInfo({ applySkeleton: true });
            bottom = Math.min(bottom, mesh.getBoundingInfo().boundingBox.minimumWorld.y);
          }
        }
        this.visual.position.y = Math.max(0, this.body.position.y - bottom, previous * Math.exp(-12 * dt));
      } else this.visual.position.y *= Math.exp(-12 * dt);
    });
    this.fallback = MeshBuilder.CreateCapsule('loading-avatar', { height: 1.8, radius: 0.3 }, scene);
    this.fallback.position.y = 0.9; this.fallback.parent = this.visual; this.fallback.isPickable = false; this.fallback.material = fallbackMaterial;
  }

  async load(baseUrl: string) {
    const result = await ImportMeshAsync(`${baseUrl}models/character.glb`, this.scene);
    for (const material of new Set(result.meshes.map(mesh => mesh.material))) {
      if (material && !material.pluginManager?.getPlugin('WaterPalette')) new WaterPalette(material);
    }
    const root = result.meshes[0]!;
    for (const a of result.animationGroups) a.stop();
    root.computeWorldMatrix(true);
    const bounds = root.getHierarchyBoundingVectors(true);
    const height = bounds.max.y - bounds.min.y;
    if (!Number.isFinite(height) || height < 0.001) throw new Error('Empty character');
    root.scaling.scaleInPlace(1.8 / height);
    root.position.y = -bounds.min.y * 1.8 / height;
    root.parent = this.visual;
    for (const mesh of result.meshes) { mesh.isPickable = false; mesh.checkCollisions = false; }
    this.blend = new AnimationBlend(result.animationGroups);
    this.fallback.dispose();
  }

  reset(position: readonly number[]) {
    this.body.position.set(position[0]!, position[1]!, position[2]!);
    this.body.surroundingMeshes = null;
    this.state = initialPlayerState();
  }

  step(input: PlayerInput, dt: number) {
    stepPlayer(this.scene, this.body, this.state, input, dt);
    if (this.state.moving) {
      const difference = Math.atan2(Math.sin(this.state.facing - this.visual.rotation.y), Math.cos(this.state.facing - this.visual.rotation.y));
      this.visual.rotation.y += difference * Math.min(1, 14 * dt);
    }
    const freeMovement = this.state.mode !== 'walk';
    const tilt = freeMovement && this.state.moving ? -this.state.pitch : 0;
    const turn = Math.atan2(Math.sin(this.state.facing - this.visual.rotation.y), Math.cos(this.state.facing - this.visual.rotation.y));
    const bank = freeMovement && this.state.moving ? Math.max(-.35, Math.min(.35, -turn * .5)) : 0;
    this.visual.rotation.x += (tilt - this.visual.rotation.x) * Math.min(1, 12 * dt);
    this.visual.rotation.z += (bank - this.visual.rotation.z) * Math.min(1, 12 * dt);
  }
  animate(dt: number) {
    const state = this.state.mode === 'fly' ? this.state.moving ? 'Fly_Loop' : 'Fly_Idle_Loop'
      : this.state.mode === 'swim' ? this.state.moving ? 'Swim_Fwd_Loop' : 'Swim_Idle_Loop'
      : this.state.landing > 0 ? 'Jump_Land'
      : !this.state.grounded ? 'Jump_Loop' : this.state.moving ? this.state.superRunning ? 'Gallop_Loop' : this.state.running ? 'Sprint_Loop' : 'Walk_Loop' : 'Idle_Loop';
    this.blend?.update(state, dt);
  }
}
