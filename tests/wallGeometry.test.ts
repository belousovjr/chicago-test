import {strict as assert} from 'node:assert';
import {wallSections} from '../src/wallGeometry.ts';

const corner=wallSections([[0,0],[10,0],[10,10]]);
assert.deepEqual(corner[1]!.left,[9.94,.06]);
assert.deepEqual(corner[1]!.right,[10.06,-.06]);
assert.deepEqual(corner[0]!.left,[0,.06],'open ends are not extended past their endpoints');
const ring=wallSections([[0,0],[10,0],[10,10],[0,10],[0,0]]);
assert.equal(ring[0],ring.at(-1),'closed loops share the exact seam section');
for(const line of [[[0,0],[0,0],[10,0]],[[0,0],[10,0],[.001,.001]],[[0,0]]]) {
  for(const s of wallSections(line)) for(const p of [s.left,s.right]) {
    assert.ok(p.every(Number.isFinite));
    assert.ok(Math.hypot(p[0]!-s.point[0]!,p[1]!-s.point[1]!)<=.240001,'acute corners cannot form long spikes');
  }
}
