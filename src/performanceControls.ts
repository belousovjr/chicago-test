export const PERFORMANCE_OPTIONS = [
  ['shadows', 'Динамические тени'],
  ['textures', 'Все текстуры'],
  ['materials', 'Детали материалов · normal / AO / блеск'],
  ['city', 'Город · здания и уличная геометрия'],
  ['trees', 'Деревья'],
  ['physics', 'Физика героя · движение'],
  ['film', 'Сепия и зерно'],
  ['animation', 'Анимация героя'],
  ['reflections', 'Отражения'],
  ['water', 'Вода и дно'],
  ['atmosphere', 'Небо и дымка'],
  ['localLights', 'Ночные локальные огни'],
  ['camera', 'Коллизии камеры'],
  ['lod', 'Обновления и переходы LOD'],
  ['beacons', 'Маяки на шпилях'],
] as const;
export type PerformanceFlags = Record<typeof PERFORMANCE_OPTIONS[number][0], boolean>;
const STORAGE_KEY = 'city-performance';
export function createPerformanceFlags(): PerformanceFlags {
  const flags = Object.fromEntries(PERFORMANCE_OPTIONS.map(([key]) => [key, true])) as PerformanceFlags;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    for (const [key] of PERFORMANCE_OPTIONS) if (typeof saved?.[key] === 'boolean') flags[key] = saved[key];
  } catch { /* Storage may be unavailable or contain invalid JSON. */ }
  return flags;
}
export function bindPerformanceControls(flags: PerformanceFlags, apply: () => void) {
  const save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(flags)); } catch { /* Keep controls usable when storage is unavailable. */ }
    apply();
  };
  for (const [key] of PERFORMANCE_OPTIONS) {
    const input = document.getElementById(`perf-${key}`) as HTMLInputElement;
    input.checked = flags[key];
    input.onchange = () => { flags[key] = input.checked; save(); };
  }
  document.getElementById('perf-reset')!.onclick = () => {
    for (const [key] of PERFORMANCE_OPTIONS) {
      flags[key] = true;
      (document.getElementById(`perf-${key}`) as HTMLInputElement).checked = true;
    }
    save();
  };
  apply();
}
