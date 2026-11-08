export type WallPoint = readonly number[];

// Adjacent segments share the same cross-section, rather than overlapping extended boxes.
export function wallSections(line: readonly WallPoint[], halfWidth = .06) {
  const points = line.filter((p, i) => !i || Math.hypot(p[0]! - line[i - 1]![0]!, p[1]! - line[i - 1]![1]!) > 1e-6);
  const closed = points.length > 2 && Math.hypot(points[0]![0]! - points.at(-1)![0]!, points[0]![1]! - points.at(-1)![1]!) < 1e-6;
  const count = closed ? points.length - 1 : points.length;
  const normal = (a: WallPoint, b: WallPoint) => {
    const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, length = Math.hypot(dx, dz);
    return [-dz / length, dx / length];
  };
  if (count < 2) return [];
  const sections = points.slice(0, count).map((p, i) => {
    const before = i || closed ? normal(points[(i + count - 1) % count]!, p) : normal(p, points[1]!);
    const after = i < count - 1 || closed ? normal(p, points[(i + 1) % count]!) : before;
    const dot = 1 + before[0]! * after[0]! + before[1]! * after[1]!;
    let nx = dot > 1e-6 ? (before[0]! + after[0]!) / dot : after[0]!;
    let nz = dot > 1e-6 ? (before[1]! + after[1]!) / dot : after[1]!;
    const scale = halfWidth / Math.max(1, Math.hypot(nx, nz) / 4);
    nx *= scale; nz *= scale;
    return { point: p, left: [p[0]! + nx, p[1]! + nz], right: [p[0]! - nx, p[1]! - nz] };
  });
  if (closed) sections.push(sections[0]!);
  return sections;
}
