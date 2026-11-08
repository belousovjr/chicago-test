import {strict as assert} from 'node:assert';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial.js';
import '@babylonjs/core/Collisions/collisionCoordinator.js';
import {Character} from '../src/character.ts';

const engine=new NullEngine(),scene=new Scene(engine),character=new Character(scene,new StandardMaterial('body',scene));
character.body.position.y=10;character.state.mode='fly';character.visual.rotation.set(1,0,.2);
character.step({x:0,z:0,yaw:0,run:false,jump:false,stopFlight:true},1/60);
assert.equal(character.state.mode,'walk');
assert.ok(character.visual.rotation.x>0 && character.visual.rotation.x<1,'leaving flight eases the body upright');
assert.ok(character.visual.rotation.z>0 && character.visual.rotation.z<.2);
character.state.grounded=true;character.visual.rotation.x=Math.PI/2;
scene.onAfterAnimationsObservable.notifyObservers(scene);
character.visual.computeWorldMatrix(true);
for(const mesh of character.visual.getChildMeshes()) {
  mesh.computeWorldMatrix(true);
  assert.ok(mesh.getBoundingInfo().boundingBox.minimumWorld.y>=character.body.position.y-1e-5,'smooth landing pose stays above the supporting surface');
}
scene.dispose();engine.dispose();
