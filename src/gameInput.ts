import type { PlayerInput } from './player.ts';

const DOUBLE_TAP_MS = 350;

export class GameInput {
  readonly keys = new Set<string>();
  steering = false;
  private jump = false;
  private fly = false;
  private stopFlight = false;
  private lastSpace = -Infinity;
  private lastC = -Infinity;
  private forwardPressed = false;
  private forwardReleased = false;

  press(code: string, repeat: boolean, now: number) {
    this.keys.add(code);
    if (repeat) return;
    if (code === 'KeyW') this.forwardPressed = true;
    if (code === 'Space') {
      this.fly ||= now - this.lastSpace <= DOUBLE_TAP_MS;
      this.lastSpace = this.fly ? -Infinity : now;
      this.jump = true;
    }
    if (code === 'KeyC') {
      this.stopFlight ||= now - this.lastC <= DOUBLE_TAP_MS;
      this.lastC = this.stopFlight ? -Infinity : now;
    }
  }

  release(code: string) {
    this.keys.delete(code);
    if (code === 'KeyW') this.forwardReleased = true;
  }

  reset() {
    this.keys.clear(); this.steering = false;
    this.jump = this.fly = this.stopFlight = this.forwardPressed = this.forwardReleased = false;
    this.lastSpace = this.lastC = -Infinity;
  }

  consume(yaw: number, pitch: number): PlayerInput {
    const input = {
      x: Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
      z: Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
      yaw, pitch, steer: this.steering,
      run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
      jump: this.jump, fly: this.fly, stopFlight: this.stopFlight,
      up: this.keys.has('Space'), down: this.keys.has('KeyC'),
      forwardPressed: this.forwardPressed, forwardReleased: this.forwardReleased,
    };
    this.jump = this.fly = this.stopFlight = this.forwardPressed = this.forwardReleased = false;
    return input;
  }

  attach(canvas: HTMLCanvasElement, actions: { blocked: () => boolean; editing: () => boolean; toggle: () => void; respawn: () => void; resetTiming: () => void }) {
    const controller = new AbortController(), options = { signal: controller.signal };
    window.addEventListener('keydown', event => {
      if (actions.blocked() || (event.target instanceof HTMLElement && event.target.closest('input, select, textarea, button')) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.code === 'Tab') { event.preventDefault(); if (!event.repeat) actions.toggle(); return; }
      if (!actions.editing() && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (!actions.editing()) this.press(event.code, event.repeat, performance.now());
      if (!actions.editing() && event.code === 'KeyR' && !event.repeat) actions.respawn();
    }, options);
    window.addEventListener('keyup', event => this.release(event.code), options);
    window.addEventListener('blur', () => this.reset(), options);
    document.addEventListener('visibilitychange', () => { this.reset(); actions.resetTiming(); }, options);
    canvas.addEventListener('contextmenu', event => event.preventDefault(), options);
    canvas.addEventListener('pointerdown', event => { canvas.focus(); if (event.button === 2) this.steering = true; }, options);
    window.addEventListener('pointerup', event => { if (event.button === 2) this.steering = false; }, options);
    return () => { controller.abort(); this.reset(); };
  }
}
