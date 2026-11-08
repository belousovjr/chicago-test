import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { FollowCamera, MIN_CAMERA_DISTANCE } from './followCamera.ts';

const EDITOR_CAMERA_KEY = 'block-district-editor-camera-v1';

export class SceneCameras {
  readonly camera: ArcRotateCamera;
  readonly editorCamera: UniversalCamera;
  readonly followCamera: UniversalCamera;
  readonly cameraBoom: FollowCamera;
  hasEditorCameraPose = false;
  private savedEditorCameraPose = '';

  constructor(scene: Scene) {
    this.camera = new ArcRotateCamera('follow', -Math.PI / 2, 1.22, 9, new Vector3(32, 1, 22), scene);
    this.camera.lowerRadiusLimit = MIN_CAMERA_DISTANCE; this.camera.upperRadiusLimit = 16;
    this.camera.lowerBetaLimit = 0.25; this.camera.upperBetaLimit = Math.PI / 2 + Math.PI / 10;
    this.camera.wheelPrecision = 35; this.camera.panningSensibility = 0;
    this.camera.checkCollisions = false;
    this.camera.minZ = 0.1; this.camera.maxZ = 3000;
    this.camera.attachControl(true, true, 1);
    this.camera.movement.input.inputMap.push({ source: 'pointer', button: 2, interaction: 'rotate' });
    this.camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');
    this.editorCamera = new UniversalCamera('editor', new Vector3(32, 26, -5), scene);
    this.editorCamera.setTarget(new Vector3(32, 0, 30));
    this.editorCamera.minZ = 1; this.editorCamera.maxZ = 4000; this.editorCamera.speed = 3;
    this.editorCamera.keysUp = [87]; this.editorCamera.keysDown = [83];
    this.editorCamera.keysLeft = [65]; this.editorCamera.keysRight = [68];
    this.editorCamera.keysUpward = [69]; this.editorCamera.keysDownward = [81];
    this.editorCamera.inputs.removeByType('FreeCameraTouchInput');
    try {
      const raw = localStorage.getItem(EDITOR_CAMERA_KEY);
      if (raw) {
        const pose = JSON.parse(raw);
        if ([pose.position, pose.rotation].every(v => Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6))) {
          this.editorCamera.position.copyFromFloats(...pose.position as [number, number, number]);
          this.editorCamera.rotation.copyFromFloats(...pose.rotation as [number, number, number]);
          this.hasEditorCameraPose = true;
          this.savedEditorCameraPose = raw;
        }
      }
    } catch { /* Use the initial view if storage is unavailable or invalid. */ }
    this.followCamera = new UniversalCamera('follow-view', this.camera.position.clone(), scene);
    this.followCamera.minZ = 0.05; this.followCamera.maxZ = this.camera.maxZ;
    this.cameraBoom = new FollowCamera();
    scene.activeCamera = this.followCamera;
    window.addEventListener('pagehide', () => this.saveEditorCamera());
  }

  saveEditorCamera() {
    if (!this.hasEditorCameraPose) return;
    const pose = JSON.stringify({ position: this.editorCamera.position.asArray(), rotation: this.editorCamera.rotation.asArray() });
    if (pose === this.savedEditorCameraPose) return;
    try { localStorage.setItem(EDITOR_CAMERA_KEY, pose); this.savedEditorCameraPose = pose; }
    catch { /* Camera persistence must not interrupt editing when storage is full or blocked. */ }
  }

}
