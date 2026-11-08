export const PROFILES = ['box', 'glass', 'stone', 'deco', 'bundled', 'rounded', 'marina', 'gothic', 'clock', 'tree', 'lamp', 'traffic_signal'] as const;
export type Profile = typeof PROFILES[number];
