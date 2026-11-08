import chicago from './generated/chicago.json' with { type: 'json' };

export const WATER_LEVEL = -5.5;

// A 1:1 bank slope rounds into an 18 m deep channel.
export function riverbedDepth(distance: number) {
  return distance <= 12 ? distance : 12 + 6 * (1 - Math.exp(-(distance - 12) / 6));
}

export function riverbedElevation(x: number, z: number) {
  let distanceSquared = Infinity;
  for (const ring of chicago.environment.shorelines) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i]!;
    const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((x - a[0]!) * dx + (z - a[1]!) * dz) / lengthSquared)) : 0;
    distanceSquared = Math.min(distanceSquared, (x - a[0]! - dx * t) ** 2 + (z - a[1]! - dz * t) ** 2);
  }
  const distance = Math.sqrt(distanceSquared);
  const relief = (.15 * Math.sin(x / 42) + .1 * Math.cos(z / 37)) * (1 - Math.exp(-Math.max(0, distance - 12) / 12));
  const bankDepth = 2 + .5 * Math.sin(x / 19 + z / 31) + .3 * Math.sin(x / 5.3 - z / 7.1) + .2 * Math.cos(x / 2.7 + z / 3.9);
  return WATER_LEVEL - riverbedDepth(distance) - bankDepth * Math.exp(-distance / 18) + relief;
}

export function isWaterAt(x: number, z: number) {
  let inside = false;
  for (const ring of chicago.environment.shorelines) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1]!, b = ring[i]!;
    if ((a[1]! > z) !== (b[1]! > z) && x < (b[0]! - a[0]!) * (z - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
  }
  return inside;
}
