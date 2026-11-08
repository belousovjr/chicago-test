import { strict as assert } from 'node:assert';
import { cellAt, createWorld, parseWorld, objectProperties, setObjectSize, defaultTemplates } from '../src/world.ts';
const world = createWorld();
assert.deepEqual(parseWorld(JSON.parse(JSON.stringify(world))), world);
assert.equal(new Set(world.objects.map(o => o.id)).size, world.objects.length);
assert.equal(cellAt(-0.1, 256), '-1,1');
assert.equal(cellAt(255.9, -256), '0,-1');
for (const mutate of [
  (w: any) => { w.version = 99; },
  (w: any) => { w.objects[0].position[0] = NaN; },
  (w: any) => { w.objects[0].size = [1, -1, 1]; },
  (w: any) => { w.objects[0].color = 'url(bad)'; },
  (w: any) => { w.objects.push(w.objects[0]); },
  (w: any) => { w.spawn = [0, -10, 0]; },
  (w: any) => { w.objects = Array(2001).fill(w.objects[0]); },
]) {
  const invalid = structuredClone(world); mutate(invalid);
  assert.throws(() => parseWorld(invalid));
}
console.log('World: round trip, cell boundaries, IDs and import validation passed.');

// Templates are shared defaults; explicit overrides remain local and survive a round trip.
const edited = parseWorld({version:3,spawn:[0,1,0],templates:defaultTemplates(),objects:[{id:'a',templateId:'ground',position:[0,-.5,0],yaw:0},{id:'b',templateId:'ground',position:[64,-.5,0],yaw:0}]});
const ground = edited.objects[0]!;
const sibling = edited.objects.find(o => o.id !== ground.id && o.templateId === ground.templateId)!;
const template = edited.templates.find(t => t.id === ground.templateId)!;
assert.equal(ground.size, undefined);
template.color = '#112233';
assert.equal(objectProperties(edited, ground).color, '#112233');
assert.equal(objectProperties(edited, sibling).color, '#112233');
setObjectSize(edited, ground, [20, 2, 20]);
template.size = [40, 1, 40];
assert.deepEqual(objectProperties(edited, ground).size, [20, 2, 20]);
assert.deepEqual(objectProperties(edited, sibling).size, [40, 1, 40]);
setObjectSize(edited, ground, [40, 1, 40]); assert.equal(ground.size, undefined);
assert.deepEqual(parseWorld(edited), edited);
for (const mutate of [
  (w: any) => { w.objects[0].templateId = 'missing'; },
  (w: any) => { w.templates.push(w.templates[0]); },
  (w: any) => { w.templates[0].size = [0, 1, 1]; },
  (w: any) => { w.templates[0].name = ' '; },
  (w: any) => { w.templates[0].color = 'invalid'; },
  (w: any) => { w.templates = []; },
]) { const invalid = structuredClone(edited); mutate(invalid); assert.throws(() => parseWorld(invalid)); }
const legacy = { version: 1, spawn: [0, 1, 0], objects: [{ id: 'old-house', kind: 'building', position: [4, 5, 6], size: [8, 10, 8], yaw: 1, color: '#abcdef' }] };
const migrated = parseWorld(legacy);
assert.equal(migrated.version, 3); assert.equal(migrated.objects[0].id, 'old-house');
assert.deepEqual(objectProperties(migrated, migrated.objects[0]), { kind: 'building', size: [8, 10, 8], color: '#abcdef' });
assert.deepEqual(migrated.objects[0].position, [4, 5, 6]); assert.equal(migrated.objects[0].yaw, 1);
assert.deepEqual(parseWorld(migrated), migrated);
assert.ok(createWorld().objects.every(o => world.templates.some(t => t.id === o.templateId)));
console.log('Templates: inheritance, overrides, reset, validation, V1 migration passed.');
