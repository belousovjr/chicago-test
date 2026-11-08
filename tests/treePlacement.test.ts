import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { treeOverlapsRoad } from '../src/treePlacement.ts';

test('tree footprint cannot touch asphalt, including triangle corners and reversed winding',()=>{
  const road=[[[0,0],[10,0],[0,10]]];
  for(const triangles of [road,[road[0]!.toReversed()]]) {
    assert.ok(treeOverlapsRoad(2,2,triangles));
    assert.ok(treeOverlapsRoad(0,0,triangles));
    assert.ok(treeOverlapsRoad(-.2,2,triangles),'centre is on sidewalk but trunk reaches asphalt');
    assert.ok(treeOverlapsRoad(-.15,-.15,triangles),'trunk catches a junction corner');
    assert.equal(treeOverlapsRoad(-.3,2,triangles),false);
    assert.equal(treeOverlapsRoad(-.3,-.3,triangles),false);
    assert.ok(treeOverlapsRoad(5.1,5.1,triangles),'diagonal asphalt edge');
  }
});
