import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup.js';

const TRANSITION_SECONDS = 0.15;

export class AnimationBlend {
  private active: AnimationGroup | undefined;
  private from = new Map<AnimationGroup, number>();
  private elapsed = 0;

  private groups: AnimationGroup[];

  constructor(groups: AnimationGroup[]) { this.groups = groups; }

  get transitioning() { return this.from.size > 0; }

  update(name: string, dt: number) {
    const next = this.groups.find(group => group.name === name);
    if (!next) return;
    if (!this.active) {
      next.weight = 1; next.start(name !== 'Jump_Land', 1); this.active = next;
      return;
    }
    if (next !== this.active) {
      if (!next.isPlaying) { next.weight = 0; next.start(name !== 'Jump_Land', 1); }
      // Capture the current mixture so an interrupted fade never snaps back to a previous pose.
      this.from = new Map(this.groups.filter(group => group.isPlaying).map(group => [group, group.weight]));
      this.active = next; this.elapsed = 0;
    }
    if (!this.from.size) return;
    this.elapsed += dt;
    const t = Math.min(1, this.elapsed / TRANSITION_SECONDS);
    const blend = t * t * (3 - 2 * t);
    for (const [group, weight] of this.from) {
      group.weight = weight * (1 - blend) + (group === this.active ? blend : 0);
      if (t === 1 && group !== this.active) group.stop();
    }
    if (t === 1) this.from.clear();
  }
}
