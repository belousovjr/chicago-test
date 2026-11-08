import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { GameInput } from '../src/gameInput.ts';

test('double Space and C work even when both presses arrive before one simulation tick', () => {
  const input = new GameInput();
  input.press('Space',false,0);input.release('Space');input.press('Space',false,350);
  assert.equal(input.consume(0,0).fly,true);
  assert.equal(input.consume(0,0).fly,false,'one-shot is consumed once');
  input.reset();input.press('Space',false,0);input.press('Space',true,100);
  assert.equal(input.consume(0,0).fly,false,'key repeat is not a second press');
  input.release('Space');input.press('Space',false,400);
  assert.equal(input.consume(0,0).fly,false,'slow presses stay independent');
  input.press('KeyC',false,500);input.release('KeyC');input.press('KeyC',false,600);
  const event=input.consume(0,0);assert.equal(event.stopFlight,true);assert.equal(event.down,true);
  assert.equal(input.consume(0,0).stopFlight,false);
});

test('held movement and right-mouse steering survive consumption, reset clears gestures and keys', () => {
  const input=new GameInput();input.steering=true;
  input.press('ShiftLeft',false,0);input.press('KeyW',false,0);
  const first=input.consume(1,.2);assert.equal(first.run,true);assert.equal(first.forwardPressed,true);assert.equal(first.steer,true);
  assert.equal(input.consume(1,.2).forwardPressed,false);assert.equal(input.consume(1,.2).z,1);
  input.release('KeyW');input.press('KeyW',false,10);
  const retap=input.consume(1,.2);assert.equal(retap.forwardReleased,true);assert.equal(retap.forwardPressed,true);
  input.press('Space',false,20);input.reset();input.press('Space',false,30);
  const reset=input.consume(0,0);assert.equal(reset.fly,false);assert.equal(reset.run,false);assert.equal(reset.z,0);assert.equal(reset.steer,false);
});
