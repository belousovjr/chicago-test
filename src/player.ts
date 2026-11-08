import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { WATER_LEVEL, isWaterAt } from './water.ts';
import { Ray } from '@babylonjs/core/Culling/ray.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';

export interface PlayerInput { x: number; z: number; yaw: number; pitch?: number; steer?: boolean; run: boolean; jump: boolean; fly?: boolean; stopFlight?: boolean; up?: boolean; down?: boolean; forwardPressed?: boolean; forwardReleased?: boolean }
export interface PlayerState { flightVelocity: Vector3; verticalSpeed: number; grounded: boolean; moving: boolean; running: boolean; facing: number; pitch: number; moveYaw: number | null; movePitch: number; mode: 'walk' | 'fly' | 'swim'; superRunning: boolean; forwardDown: boolean; sprintTap: number; landing: number }
export function initialPlayerState(): PlayerState {
  return { flightVelocity: Vector3.Zero(), verticalSpeed: 0, grounded: false, moving: false, running: false, facing: 0, pitch: 0, moveYaw: null, movePitch: 0, mode: 'walk', superRunning: false, forwardDown: false, sprintTap: 0, landing: 0 };
}

// Input and simulation stay separate from the camera, keyboard and character animations.
export function stepPlayer(scene: Scene, body: Mesh, state: PlayerState, input: PlayerInput, dt: number) {
  state.landing = Math.max(0, state.landing - dt);
  const wasGrounded = state.grounded;
  if (state.mode === 'walk' || input.steer !== false || state.moveYaw === null) {
    state.moveYaw = input.yaw;
    state.movePitch = state.mode === 'walk' ? 0 : input.pitch ?? 0;
  }
  const yaw = state.moveYaw;
  const pitch = state.mode === 'walk' ? 0 : Math.max(-1.3, Math.min(1.3, state.movePitch));
  const forward = new Vector3(-Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.sin(yaw) * Math.cos(pitch));
  const right = new Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
  const direction = forward.scale(input.z).addInPlace(right.scale(input.x));
  const forwardDown = input.z > 0;
  state.sprintTap = Math.max(0, state.sprintTap - dt);
  if ((input.forwardReleased || (!forwardDown && state.forwardDown)) && state.running) state.sprintTap = .3;
  if ((input.forwardPressed || (forwardDown && !state.forwardDown)) && input.run && state.sprintTap > 0) { state.superRunning = true; state.sprintTap = 0; }
  if (!input.run || !forwardDown) state.superRunning = false;
  state.forwardDown = forwardDown;
  state.moving = direction.lengthSquared() > 0;
  state.running = state.moving && input.run;
  if (state.moving) direction.normalize();
  const groundRay = new Ray(body.position.add(new Vector3(0, 0.12, 0)), Vector3.Down(), 0.22);
  const isGround = (m: AbstractMesh) => m.checkCollisions && (m.collisionGroup & body.collisionMask) !== 0 && !!m.metadata?.worldId && m.isEnabled();
  const candidates = body.surroundingMeshes;
  const onGround = candidates
    ? candidates.some(m => isGround(m) && groundRay.intersectsMesh(m, true).hit)
    : !!scene.pickWithRay(groundRay, m => isGround(m))?.hit;
  state.grounded = onGround && state.verticalSpeed <= 0;
  if (state.grounded && !wasGrounded) state.landing = .25;
  if (input.stopFlight && state.mode === 'fly') { state.mode = 'walk'; state.pitch = 0; state.movePitch = 0; state.verticalSpeed = 0; state.superRunning = false; }
  const inWater = body.position.y < WATER_LEVEL - (state.mode === 'swim' ? 1.15 : 1.26) && isWaterAt(body.position.x, body.position.z);
  let deepWater = false;
  if (inWater) {
    const depthRay = new Ray(new Vector3(body.position.x, WATER_LEVEL + .1, body.position.z), Vector3.Down(), 1.36);
    deepWater = !(candidates ? candidates.some(m => isGround(m) && depthRay.intersectsMesh(m, true).hit)
      : scene.pickWithRay(depthRay, m => isGround(m))?.hit);
  }
  if (deepWater && state.mode !== 'fly') state.mode = 'swim';
  else if (state.mode === 'swim') state.mode = 'walk';
  if (state.mode === 'walk') {
    if (state.grounded) state.verticalSpeed = -.5;
    if (input.jump && state.grounded) {
      state.verticalSpeed = 7; state.grounded = false;
    }
  }
  if (input.fly) { state.mode = 'fly'; state.verticalSpeed = 0; state.grounded = false; state.landing = 0; }
  const speed = (state.superRunning ? 24.5 : input.run && (state.moving || state.mode === 'fly') ? 7 : 3.2) * (state.mode === 'fly' ? 8 : 1);
  const displacement = direction.scale(state.mode === 'swim' ? speed * .65 : speed);
  if (state.mode === 'fly') {
    displacement.y += (Number(!!input.up) - Number(!!input.down)) * speed;
    if (displacement.length() > speed) displacement.normalize().scaleInPlace(speed);
    // Bounded acceleration makes both the turning radius and stopping distance grow with speed.
    const change = displacement.subtract(state.flightVelocity);
    const limit = (displacement.lengthSquared() < .000001 ? 160 : 240) * dt;
    if (change.length() > limit) change.normalize().scaleInPlace(limit);
    state.flightVelocity.addInPlace(change);
    if (state.flightVelocity.lengthSquared() < .000001) state.flightVelocity.setAll(0);
    displacement.copyFrom(state.flightVelocity);
    state.moving = displacement.lengthSquared() > .000001;
    state.verticalSpeed = 0;
    state.grounded = false;
  } else if (state.mode === 'swim') {
    const verticalInput = Number(!!input.up) - Number(!!input.down);
    displacement.y += verticalInput * speed * .65;
    if (Math.abs(displacement.y) < .001) displacement.y = Math.max(-2, Math.min(2, (WATER_LEVEL - 1.35 - body.position.y) * 4));
    if (displacement.length() > speed * .65) displacement.normalize().scaleInPlace(speed * .65);
    // Stay at the surface while swimming up; shallow-water detection still permits walking ashore.
    displacement.y = Math.min(displacement.y, Math.max(0, (WATER_LEVEL - 1.27 - body.position.y) / dt));
    state.verticalSpeed = displacement.y;
    state.grounded = false;
  } else {
    state.verticalSpeed = Math.max(-30, state.verticalSpeed - 20 * dt);
    displacement.y = state.verticalSpeed;
  }
  state.pitch = state.mode !== 'walk' && state.moving ? Math.atan2(displacement.y, Math.hypot(displacement.x, displacement.z)) : 0;
  displacement.scaleInPlace(dt);
  if (state.mode === 'fly' && displacement.y < 0) {
    // Land before the pitched flight pose reaches the floor, rather than waiting for the upright capsule.
    const clearance = Math.max(.15, 1.35 * Math.abs(Math.sin(state.pitch)) + .4 * Math.abs(Math.cos(state.pitch)) - .9);
    const landingRay = new Ray(body.position.add(new Vector3(0, .12, 0)), Vector3.Down(), .12 + clearance - displacement.y);
    const approachingGround = candidates
      ? candidates.some(m => isGround(m) && landingRay.intersectsMesh(m).hit)
      : !!scene.pickWithRay(landingRay, m => isGround(m))?.hit;
    if (approachingGround) { state.mode = 'walk'; state.pitch = 0; state.verticalSpeed = displacement.y / dt; state.superRunning = false; }
  }
  const previous = body.position.clone();
  // Multiple fixed steps can run before rendering refreshes the cached world position.
  body.computeWorldMatrix(true);
  body.moveWithCollisions(displacement);
  if (state.mode === 'fly' && body.position.subtract(previous).subtract(displacement).lengthSquared() > .000025) {
    state.mode = 'walk'; state.pitch = 0; state.verticalSpeed = 0; state.superRunning = false;
    if (displacement.y < 0 && body.position.y - previous.y > displacement.y + .005) { state.grounded = true; state.landing = .25; }
  }
  if (state.verticalSpeed > 0 && body.position.y - previous.y < displacement.y * .5) state.verticalSpeed = 0;
  if (state.mode !== 'fly') state.flightVelocity.setAll(0);
  if (state.moving) state.facing = state.mode === 'fly'
    ? Math.atan2(state.flightVelocity.x, state.flightVelocity.z) : Math.atan2(direction.x, direction.z);
}
