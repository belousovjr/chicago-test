import { RenderBatches } from './renderBatches';
import { MaterialFlags } from '@babylonjs/core/Materials/materialFlags.js';
import { createPerformanceFlags, bindPerformanceControls } from './performanceControls';
import { visualCandidates } from './sceneCandidates';
import { createEditor } from './editor';
import { RENDER_SETTINGS } from './renderSettings';
import type { WorldData } from './world';
import { SceneCameras } from './sceneCameras';
import { WorldRenderer } from './worldRenderer';
import { GameInput } from './gameInput';
import { Character } from './character';
import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Color4 } from '@babylonjs/core/Maths/math.color.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import '@babylonjs/core/Collisions/collisionCoordinator.js';
import '@babylonjs/core/Culling/ray.js';
import { cellAt, createWorld, parseWorld, WORLD_STORAGE_KEY } from './world';
import { NearbyMeshes } from './nearbyMeshes';
import { predictLodEye } from './lodTransitions';
import { CityMaterials } from './cityMaterials';
import { DayNight } from './dayNight';
import { Beacons } from './beacons';
import { mountUI, bindTimeControls, $, notify } from './ui';
import './style.css';

const performanceFlags = createPerformanceFlags();
mountUI();
const canvas = $<HTMLCanvasElement>('renderCanvas');
const engine = new Engine(canvas, true, { stencil: true });
function resizeRenderer() {
  engine.setHardwareScalingLevel(Math.max(1, canvas.clientWidth / RENDER_SETTINGS.width, canvas.clientHeight / RENDER_SETTINGS.height));
}
resizeRenderer();
engine.renderEvenInBackground = false;
const scene = new Scene(engine);
scene.clearColor = Color4.FromHexString('#bacbccff');
scene.collisionsEnabled = true;
// Selection uses clicks; camera motion needs no triangle picking under the pointer.
scene.skipPointerMovePicking = true;
const lighting = new DayNight(scene);
const cameras = new SceneCameras(scene);
const { camera, followCamera, cameraBoom } = cameras;

const cityMaterials = new CityMaterials(scene, import.meta.env.BASE_URL);
const beacons = new Beacons(scene);
bindTimeControls(lighting);
const playerNeighborhood = new NearbyMeshes(), cameraNeighborhood = new NearbyMeshes();
const previousLodEye = new Vector3(), predictedLodEye = new Vector3();
let previousLodCamera = scene.activeCamera!;
let initialWorld: WorldData = createWorld();
let startupMessage = '';
try {
  const saved = localStorage.getItem(WORLD_STORAGE_KEY);
  if (saved) initialWorld = parseWorld(JSON.parse(saved));
} catch { startupMessage = 'Сохранённая карта недоступна. Открыт Chicago Loop.'; }
const city = new WorldRenderer(scene, cityMaterials, beacons, initialWorld);
function updateLODs() {
  if (!performanceFlags.lod && !city.initialLods) return;
  city.updateLODs(editor.editing ? scene.activeCamera!.position : player.position, predictedLodEye, editor.editing, editor.selected, editor.previewLod, lighting.night);
}
function updateActiveCell() {
  if (city.updateActiveCell(player.position, editor.editing)) { playerNeighborhood.invalidate(); cameraNeighborhood.invalidate(); }
}
let batches: RenderBatches | undefined;
function refreshNearbySources() {
  const sources = [...[...city.modelLevels.values()].flat(), ...city.proceduralMeshes];
  if (!batches?.matchesSources(sources)) {
    batches?.dispose();
    batches = new RenderBatches(scene, sources);
  }
  const candidates = visualCandidates(scene.meshes, performanceFlags);
  scene.getActiveMeshCandidates = candidates.active;
  playerNeighborhood.setSources(scene.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh && mesh.checkCollisions && (mesh.collisionGroup & player.collisionMask) !== 0 && !!mesh.metadata?.worldId));
  cameraNeighborhood.setSources([...city.meshes.values(), ...city.proceduralMeshes].filter(mesh => mesh.checkCollisions));
  lighting.setWorld(city.furnitureRoots.filter(root => root.metadata.templateId === 'lamp'),
    [...city.proceduralMeshes, ...[...city.modelLevels.values()].flat(), ...visual.getChildMeshes()].filter(mesh => !mesh.metadata?.renderSource).concat([batches.mesh, batches.shadow]));
}
const character = new Character(scene, cityMaterials.get('#d4a663', 'plain'));
const player = character.body;
const visual = character.visual;
const flightCameraTarget = new Vector3(0, 1.55, 0);
async function loadCharacter() {
  try {
    await character.load(import.meta.env.BASE_URL);
    refreshNearbySources();
    notify(startupMessage || 'WASD — идти · Shift — бег · повтор W — галоп · два прыжка — полёт · Space/C — вверх/вниз · Tab — редактор');
  } catch (error) {
    console.error('Character loading failed', error);
    notify('Модель не загрузилась. Управление доступно с временной капсулой.');
  }
}

function respawn() {
  playerNeighborhood.invalidate(); cameraNeighborhood.invalidate();
  player.surroundingMeshes = null;
  cameraBoom.reset();
  character.reset(city.world.spawn); input.reset();
  updateActiveCell();
  camera.target.copyFrom(player.position).addInPlaceFromFloats(0, 1.1, 0);
}
const input = new GameInput();
const editor = createEditor({ scene, canvas, city, cameras, player, input, changed: refreshNearbySources, respawn, updateLODs });
input.attach(canvas, { blocked: () => starting, editing: () => editor.editing, toggle: editor.toggle, respawn, resetTiming: () => { accumulator = 0; } });

function simulate(dt: number) {
  updateActiveCell();
  player.surroundingMeshes = playerNeighborhood.get(player.position, RENDER_SETTINGS.collisionRadius);
  character.step(input.consume(camera.alpha, camera.beta - Math.PI / 2), dt);
  if (character.state.moving) $('intro').hidden = true;
  camera.upperBetaLimit = character.state.mode !== 'walk' ? Math.PI - .25 : Math.PI / 2 + Math.PI / 10;
  if (player.position.y < -30) respawn();
}

editor.initialize();
let starting = true, characterReady = false;
void loadCharacter().finally(() => { characterReady = true; });
let accumulator = 0;
let statsTime = 0;
let lodTime = 0;
const fadedLastFrame = new Set<Mesh>();
bindPerformanceControls(performanceFlags, () => {
  const candidates = visualCandidates(scene.meshes, performanceFlags);
  scene.getActiveMeshCandidates = candidates.active;
  scene.shadowsEnabled = lighting.shadowsEnabled = performanceFlags.shadows;
  scene.texturesEnabled = performanceFlags.textures;
  lighting.shadows.getShadowMap()!.resetRefreshCounter();
  MaterialFlags.BumpTextureEnabled = performanceFlags.materials;
  MaterialFlags.AmbientTextureEnabled = performanceFlags.materials;
  MaterialFlags.SpecularTextureEnabled = performanceFlags.materials;
  MaterialFlags.ReflectionTextureEnabled = performanceFlags.reflections;
  scene.animationsEnabled = performanceFlags.animation;
  lighting.localLightsEnabled = performanceFlags.localLights;
  if (!performanceFlags.localLights) for (const light of lighting.streetLights) light.setEnabled(false);
  lighting.setAtmosphereEnabled(performanceFlags.atmosphere);
  document.body.classList.toggle('no-film', !performanceFlags.film);
  if (!performanceFlags.camera) cameraBoom.reset();
  if (!performanceFlags.lod) city.lodTransitions.settle();
});
engine.runRenderLoop(() => {
  if (document.hidden) { accumulator = 0; return; }
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.1);
  if (!starting && !editor.editing && !document.hidden) {
    accumulator += dt;
    while (accumulator >= 1 / 60) { if (performanceFlags.physics) simulate(1 / 60); accumulator -= 1 / 60; }
    if (character.state.mode === 'fly') {
      Vector3.TransformCoordinatesToRef(flightCameraTarget, visual.computeWorldMatrix(true), camera.target);
    } else camera.target.copyFrom(player.position).addInPlaceFromFloats(0, 1.15, 0);
    if (performanceFlags.animation) character.animate(dt);
  } else { accumulator = 0; }
  if (!editor.editing) {
    // The orbit camera owns input/desired zoom; the render camera owns the collision-safe pose.
    camera.update();
    if (performanceFlags.camera) {
      cameraBoom.update(camera.target, camera.position, cameraNeighborhood.get(camera.target, Vector3.Distance(camera.target, camera.position) + 3), dt);
      followCamera.position.copyFrom(cameraBoom.position);
    } else followCamera.position.copyFrom(camera.position);
    followCamera.setTarget(camera.target);
  }
  const eye = editor.editing ? scene.activeCamera!.position : player.position;
  if (city.initialLods || previousLodCamera !== scene.activeCamera) previousLodEye.copyFrom(eye);
  predictLodEye(previousLodEye, eye, dt, predictedLodEye);
  previousLodEye.copyFrom(eye); previousLodCamera = scene.activeCamera!;
  lodTime += dt;
  if (starting || city.initialLods || lodTime >= RENDER_SETTINGS.lodInterval) { updateLODs(); lodTime = 0; }
  if (starting || city.initialLods) { city.lodTransitions.settle(); city.initialLods = false; }
  const opacityChanged = fadedLastFrame.size > 0;
  // Only camera-obscuring roots change opacity; include last frame to restore cleared blockers.
  for (const root of fadedLastFrame) if (!root.isDisposed()) city.lodTransitions.opacity(root, root.visibility);
  fadedLastFrame.clear();
  for (const root of cameraBoom.fadedMeshes) {
    city.lodTransitions.opacity(root, root.visibility); fadedLastFrame.add(root);
  }
  if (performanceFlags.lod) city.lodTransitions.update(dt);
  cityMaterials.setNight(lighting.night);
  if (performanceFlags.beacons) beacons.update(dt);
  lighting.update(eye, dt, starting || city.lodTransitions.busy || opacityChanged || fadedLastFrame.size > 0);
  scene.updateTransformMatrix();
  if (batches?.update(eye, lighting.sun.direction, city.lodTransitions.revision, editor.editing, editor.selected)) lighting.shadows.getShadowMap()!.resetRefreshCounter();
  scene.render();
  if (starting && characterReady && scene.isReady()) {
    starting = false;
    requestAnimationFrame(() => document.getElementById('startup-loader')?.remove());
  }
  statsTime += dt;
  if (statsTime >= 0.5) {
    statsTime = 0;
    const count = [...city.meshes.values()].filter(m => m.isEnabled()).length;
    $('stats').textContent = `${Math.round(engine.getFps())} FPS · ${count} зданий · ${scene.getActiveMeshes().length} мешей · ячейка ${cellAt(player.position.x, player.position.z)}`;
    if (editor.editing) { editor.describeSelection(); editor.describeEditorCamera(); cameras.saveEditorCamera(); }
  }
});
window.addEventListener('resize', resizeRenderer);
