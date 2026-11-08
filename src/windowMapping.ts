import layout from './facadeLayout.json' with { type: 'json' };
import type { ObjectTemplate } from './world';

// Artistic minimum for the opening itself, not the floor-to-floor height.
export const MIN_WINDOW_HEIGHT = 1.5;
export function hasMasonryWindows(template: ObjectTemplate) {
  return template.kind === 'building' && ['box', 'stone', 'deco', 'clock', 'gothic'].includes(template.profile ?? 'box');
}
export function windowRows(height: number, span: number) {
  const opening = 1 - (layout.masonry.insetTop + layout.masonry.insetBottom) * layout.masonry.rows / layout.size;
  return Math.max(0, Math.min(layout.masonry.rows, Math.round(span / (layout.bodyTop - layout.bodyBottom) * layout.masonry.rows),
    Math.floor(height * span * opening / MIN_WINDOW_HEIGHT + 1e-9)));
}
export function windowMappingKey(template: ObjectTemplate, height: number) {
  if (!hasMasonryWindows(template)) return '';
  const spans = template.profile === 'deco' ? [.2, .28, .1] : [template.profile === 'stone' ? .88 : template.profile === 'clock' || template.profile === 'gothic' ? .58 : 1];
  return spans.map(span => windowRows(height, span)).join(',');
}
