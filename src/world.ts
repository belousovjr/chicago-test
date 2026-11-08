import chicago from './generated/chicago.json' with { type: 'json' };
import { PROFILES } from './profiles.ts';
import type { Profile } from './profiles.ts';
export const WORLD_STORAGE_KEY = 'block-district-chicago-v3';

export type Kind = 'building' | 'ground' | 'obstacle';
export type Triple = [number, number, number];
export interface ObjectTemplate {
  id: string;
  name: string;
  kind: Kind;
  size: Triple;
  color: string;
  profile?: Profile;
  lodDistances?: number[];
}
export interface WorldObject {
  id: string;
  templateId: string;
  name?: string;
  position: Triple;
  yaw: number;
  size?: Triple;
  color?: string;
}
export interface WorldData {
  version: 3;
  environment?: 'chicago-loop';
  spawn: Triple;
  templates: ObjectTemplate[];
  objects: WorldObject[];
}
export function defaultTemplates(): ObjectTemplate[] {
  return [
    { id: 'building', name: 'Здание', kind: 'building', size: [9, 10, 9], color: '#9caba9' },
    { id: 'ground', name: 'Земля', kind: 'ground', size: [64, 1, 64], color: '#39484e' },
    { id: 'obstacle', name: 'Препятствие', kind: 'obstacle', size: [3, 1, 3], color: '#d4a663' },
  ];
}
export function objectProperties(world: WorldData, object: WorldObject) {
  const template = world.templates.find(t => t.id === object.templateId)!;
  return { kind: template.kind, size: object.size ?? template.size, color: object.color ?? template.color };
}
export function setObjectSize(world: WorldData, object: WorldObject, size: Triple) {
  const template = world.templates.find(t => t.id === object.templateId)!;
  if (size.every((n, i) => Math.abs(n - template.size[i]!) < 1e-6)) delete object.size;
  else object.size = [...size];
}
export const CELL_SIZE = 256;
export const WORLD_LIMIT = 4096;
export const MAX_SIZE = 768;
export function cellAt(x: number, z: number): string {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
}

// Validate and copy the whole map before replacing the current scene. V1 maps migrate without losing IDs or transforms.
export function parseWorld(input: unknown): WorldData {
  const fail = (): never => { throw new Error('Некорректная карта: проверьте версию, шаблоны, ID, координаты и размеры.'); };
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const id = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,80}$/.test(v);
  const color = (v: unknown): v is string => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
  const kind = (v: unknown): v is Kind => v === 'building' || v === 'ground' || v === 'obstacle';
  const triple = (v: unknown, size = false): v is Triple => Array.isArray(v) && v.length === 3 &&
    v.every(n => typeof n === 'number' && Number.isFinite(n) && (size ? n >= 0.25 && n <= MAX_SIZE : Math.abs(n) <= WORLD_LIMIT));
  if (!record(input) || (input.version !== 1 && input.version !== 2 && input.version !== 3) || !triple(input.spawn) || input.spawn[1] < 0 ||
    !Array.isArray(input.objects) || input.objects.length > 2000) return fail();
  const sourceTemplates = input.version === 1 ? defaultTemplates() : input.templates;
  if (!Array.isArray(sourceTemplates) || sourceTemplates.length === 0 || sourceTemplates.length > 256) return fail();
  const templateIds = new Set<string>();
  const templates: ObjectTemplate[] = sourceTemplates.map(t => {
    if (!record(t) || !id(t.id) || templateIds.has(t.id) || typeof t.name !== 'string' || !t.name.trim() || t.name.length > 80 ||
      !kind(t.kind) || !triple(t.size, true) || !color(t.color)) return fail();
    templateIds.add(t.id);
    if (t.profile !== undefined && !PROFILES.includes(t.profile as Profile)) return fail();
    if (t.lodDistances !== undefined && (!Array.isArray(t.lodDistances) || t.lodDistances.length > 2 || t.lodDistances.some((n, i, a) => typeof n !== 'number' || !Number.isFinite(n) || n < 10 || n > 3000 || (i > 0 && n <= Number(a[i - 1]))))) return fail();
    const template: ObjectTemplate = { id: t.id, name: t.name.trim(), kind: t.kind, size: [...t.size], color: t.color };
    if (t.profile !== undefined) template.profile = t.profile as Profile;
    if (t.lodDistances !== undefined) template.lodDistances = [...t.lodDistances] as number[];
    return template;
  });
  const ids = new Set<string>();
  const objects: WorldObject[] = input.objects.map(o => {
    if (!record(o) || !id(o.id) || ids.has(o.id) || !triple(o.position) || typeof o.yaw !== 'number' || !Number.isFinite(o.yaw) || Math.abs(o.yaw) > Math.PI * 2) return fail();
    const legacy = input.version === 1;
    if (legacy && (!kind(o.kind) || !triple(o.size, true) || !color(o.color))) return fail();
    const templateId = legacy ? o.kind : o.templateId;
    if (!id(templateId) || !templateIds.has(templateId) || (o.size !== undefined && !triple(o.size, true)) || (o.color !== undefined && !color(o.color))) return fail();
    ids.add(o.id);
    const result: WorldObject = { id: o.id, templateId, position: [...o.position], yaw: o.yaw };
    if (o.name !== undefined) { if (typeof o.name !== 'string' || o.name.length > 160) return fail(); result.name = o.name; }
    if (triple(o.size, true)) result.size = [...o.size];
    if (color(o.color)) result.color = o.color;
    return result;
  });
  if (input.environment !== undefined && input.environment !== 'chicago-loop') return fail();
  return { version: 3, ...(input.environment ? { environment: 'chicago-loop' as const } : {}), spawn: [...input.spawn], templates, objects };
}

export function createWorld(): WorldData {
  return parseWorld(chicago.world);
}
