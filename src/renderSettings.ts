// Runtime rendering budgets. Geometry generation and gameplay speeds have separate owners.
export const RENDER_SETTINGS = {
  width: 1920,
  height: 1080,
  lodInterval: .15,
  activeCellRadius: 2,
  keepTallBuildings: 120,
  collisionRadius: 12,
  furnitureRange: { lamp: 120, lampNightExtra: 200, signal: 160, other: 240 },
  streetLod: { marking: [60, 160], structure: [100, 320] },
  surfaceFade: [16, 96],
} as const;
