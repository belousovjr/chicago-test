import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createPerformanceFlags, bindPerformanceControls, PERFORMANCE_OPTIONS } from '../src/performanceControls.ts';

test('performance settings restore validated values, save changes and reset persistently', () => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let value = '{"trees":false,"shadows":"false","unknown":false}';
  const elements = Object.fromEntries([...PERFORMANCE_OPTIONS.map(([key]) => [`perf-${key}`, { checked: true, onchange: null }]), ['perf-reset', { onclick: null }]]);
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => value, setItem: (_key, next) => { value = next; } } });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: id => elements[id] } });
    const flags = createPerformanceFlags();
    assert.equal(flags.trees, false);
    assert.equal(flags.shadows, true);
    assert.equal('unknown' in flags, false);
    let applied = 0;
    bindPerformanceControls(flags, () => applied++);
    assert.equal(elements['perf-trees'].checked, false);
    assert.equal(applied, 1);
    elements['perf-film'].checked = false;
    elements['perf-film'].onchange();
    assert.equal(createPerformanceFlags().film, false);
    elements['perf-reset'].onclick();
    assert.ok(Object.values(createPerformanceFlags()).every(Boolean));
    value = 'broken';
    assert.ok(Object.values(createPerformanceFlags()).every(Boolean));
    value = 'null';
    assert.ok(Object.values(createPerformanceFlags()).every(Boolean));
  } finally {
    if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else delete globalThis.localStorage;
    if (document) Object.defineProperty(globalThis, 'document', document); else delete globalThis.document;
  }
});
