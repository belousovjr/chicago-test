import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import '@babylonjs/core/Collisions/collisionCoordinator.js';
import { initialPlayerState, stepPlayer } from '../src/player.ts';
import { WATER_LEVEL, isWaterAt } from '../src/water.ts';
import chicago from '../src/generated/chicago.json' with { type: 'json' };

function setup() {
  const engine = new NullEngine(), scene = new Scene(engine);
  scene.collisionsEnabled = true;
  const floor = MeshBuilder.CreateBox('floor', {width: 1000, height: 1, depth: 1000}, scene);
  floor.material=new StandardMaterial('floor',scene);floor.position.y=-.5; floor.checkCollisions=true; floor.metadata={worldId:'floor'};
  const body=MeshBuilder.CreateBox('body',{},scene);
  body.ellipsoid.set(.35,.9,.35);body.ellipsoidOffset.set(0,.9,0);
  body.position.y=.01;body.surroundingMeshes=[floor];
  const state=initialPlayerState();
  const input={x:0,z:0,yaw:-Math.PI/2,run:false,pitch:0,jump:false,fly:false,up:false,down:false,forwardPressed:false,forwardReleased:false};
  const step=(count=1)=>{for(let i=0;i<count;i++) {floor.computeWorldMatrix(true);stepPlayer(scene,body,state,input,1/60);}};
  return {scene,floor,body,state,input,step,dispose:()=>{scene.dispose();engine.dispose();}};
}

test('quick forward retap while sprinting enables 3.5x gallop, release and slow retap do not',()=>{
  const f=setup(),{body,state,input,step}=f;
  input.z=1;input.run=true;step(60);
  assert.ok(Math.abs(body.position.z-7)<.05);
  input.z=0;step(5);input.z=1;step();
  assert.equal(state.superRunning,true);
  const z=body.position.z;step(60);assert.ok(Math.abs(body.position.z-z-24.5)<.05);
  input.run=false;step();assert.equal(state.superRunning,false);
  input.run=true;step();input.z=0;step(30);input.z=1;step();assert.equal(state.superRunning,false);
  // Keyup and keydown can both happen between two simulation ticks.
  input.forwardPressed=input.forwardReleased=true;step();assert.equal(state.superRunning,true);
  f.dispose();
});

test('second jump activates hover; flight has three speeds and lands on surface contact',()=>{
  const f=setup(),{body,state,input,step}=f;
  step(3);input.jump=true;step();input.jump=false;step(12);
  assert.equal(state.mode,'walk');input.jump=true;input.fly=true;step();input.jump=false;input.fly=false;
  assert.equal(state.mode,'fly');const y=body.position.y;step(60);assert.ok(Math.abs(body.position.y-y)<.001);
  input.up=true;step(30);input.up=false;assert.ok(body.position.y>y+1.5);step(60);
  input.z=1;step(60);const z=body.position.z;step(60);assert.ok(Math.abs(body.position.z-z-25.6)<.05);
  input.run=true;input.z=0;step();input.z=1;step();assert.equal(state.superRunning,false);
  // Run, release, retap to reach the third speed in flight too.
  step();input.z=0;step();input.z=1;step();assert.equal(state.superRunning,true);
  step(120);const fast=body.position.z;step(30);assert.ok(Math.abs(body.position.z-fast-98)<.05);
  body.position.x=body.position.z=0;
  input.z=0;input.run=false;input.down=true;step(180);
  assert.equal(state.mode,'walk');assert.ok(Math.abs(body.position.y)<.05);assert.equal(state.grounded,true);
  f.dispose();
});

test('swimming starts at 70% immersion only in deep water, floats, and ends on shallows',()=>{
  const f=setup(),{body,state,input,step,floor}=f;
  const tri=[...chicago.environment.water].sort((a,b)=>Math.abs((b[1][0]-b[0][0])*(b[2][1]-b[0][1])-(b[1][1]-b[0][1])*(b[2][0]-b[0][0]))-Math.abs((a[1][0]-a[0][0])*(a[2][1]-a[0][1])-(a[1][1]-a[0][1])*(a[2][0]-a[0][0])))[0];
  const x=tri.reduce((s,p)=>s+p[0],0)/3,z=tri.reduce((s,p)=>s+p[1],0)/3;
  assert.equal(isWaterAt(x,z),true);assert.equal(isWaterAt(10000,10000),false);
  floor.position.set(x,WATER_LEVEL-10.5,z);body.position.set(x,WATER_LEVEL-1.2,z);step();assert.equal(state.mode,'walk');
  body.position.y=WATER_LEVEL-1.27;step();assert.equal(state.mode,'swim');
  step(180);assert.ok(Math.abs(body.position.y-(WATER_LEVEL-1.35))<.04);
  input.z=1;step(10);assert.equal(state.mode,'swim');
  floor.position.y=WATER_LEVEL-1.5;step();assert.equal(state.mode,'walk');
  body.position.set(10000,WATER_LEVEL-2,10000);step();assert.equal(state.mode,'walk');
  f.dispose();
});

test('local character includes valid distinct movement animation clips',()=>{
  const data=readFileSync('public/models/character.glb');
  assert.ok(data.length<4*1024*1024);
  const gltf=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
  const binaryOffset=28+data.readUInt32LE(12);
  const primitive=gltf.meshes[0].primitives[0];
  const weights=gltf.accessors[primitive.attributes.WEIGHTS_0];
  const view=gltf.bufferViews[weights.bufferView];
  const offset=binaryOffset+(view.byteOffset??0)+(weights.byteOffset??0);
  for(let i=0;i<weights.count;i++) {
    const start=offset+i*(view.byteStride??16);
    const sum=[0,1,2,3].reduce((s,j)=>s+data.readFloatLE(start+j*4),0);
    assert.ok(Math.abs(sum-1)<.001, 'packed skin weights remain normalized');
  }
  for(const name of ['Gallop_Loop','Fly_Loop','Fly_Idle_Loop','Swim_Fwd_Loop','Swim_Idle_Loop','Jump_Land']) {
    const clip=gltf.animations.find(a=>a.name===name);assert.ok(clip,name);
    assert.ok(clip.channels.length>20);
    for(const channel of clip.channels) assert.ok(gltf.nodes[channel.target.node]);
  }
});

test('fast flight stops at walls and walking off a ledge cannot trigger flight',()=>{
  const f=setup(),{scene,body,state,input,step,floor}=f;
  body.position.y=3;input.jump=true;step();input.jump=false;assert.equal(state.mode,'walk');
  const wall=MeshBuilder.CreateBox('flight-wall',{width:20,height:20,depth:1},scene);
  wall.position.set(0,5,5);wall.material=floor.material;wall.checkCollisions=true;wall.metadata={worldId:'wall'};wall.computeWorldMatrix(true);
  body.surroundingMeshes=[floor,wall];body.position.set(0,3,0);
  state.mode='fly';state.flightVelocity.set(0,0,196);state.superRunning=true;state.forwardDown=true;input.z=1;input.run=true;
  step(30);assert.equal(state.mode,'walk');assert.equal(state.flightVelocity.length(),0);assert.ok(body.position.z<4.2,'fast flight cannot tunnel through a wall');
  f.dispose();
});

test('flight steers vertically with the camera and lands before its pitched pose enters a floor',()=>{
  const f=setup(),{body,state,input,step}=f;
  state.mode='fly';body.position.y=20;input.z=1;input.pitch=Math.PI/6;
  step(30);const y=body.position.y;step(30);assert.ok(Math.abs(body.position.y-y-6.4)<.02);
  assert.ok(Math.abs(state.pitch-Math.PI/6)<.001);
  input.run=true;input.pitch=0;step(60);const z=body.position.z;step(30);assert.ok(Math.abs(body.position.z-z-28)<.02,'fast flight is 56 m/s');
  input.pitch=-1;state.flightVelocity.set(0,0,0);body.position.set(0,2,0);
  let earlyLanding=false;
  for(let i=0;i<120;i++) {
    const flying=state.mode==='fly';step();
    if(flying && state.mode==='walk' && body.position.y>.1) earlyLanding=true;
    assert.ok(body.position.y>=-.005,'collision feet never enter the floor');
  }
  assert.ok(earlyLanding,'pitch is removed before the horizontal pose touches the floor');
  assert.equal(state.grounded,true);f.dispose();
});

test('swimming follows camera pitch and Space/C and cannot rise beyond the surface',()=>{
  const f=setup(),{body,state,input,step,floor}=f;
  const tri=chicago.environment.water.find(t=>isWaterAt(t.reduce((s,p)=>s+p[0],0)/3,t.reduce((s,p)=>s+p[1],0)/3));
  const x=tri.reduce((s,p)=>s+p[0],0)/3,z=tri.reduce((s,p)=>s+p[1],0)/3;
  body.position.set(x,WATER_LEVEL-3,z);floor.position.set(x,WATER_LEVEL-20,z);
  step();assert.equal(state.mode,'swim');
  input.down=true;const start=body.position.y;step(20);assert.ok(body.position.y<start-.5);
  input.down=false;input.z=1;input.pitch=-.5;const dive=body.position.y;step(15);assert.ok(body.position.y<dive-.2);
  input.z=0;input.up=true;step(180);
  assert.equal(state.mode,'swim');assert.ok(body.position.y<=WATER_LEVEL-1.25);
  assert.ok(body.position.y>WATER_LEVEL-1.4);f.dispose();
});

test('hover has subtle joint motion with a seamless loop',()=>{
  const data=readFileSync('public/models/character.glb'),jsonSize=data.readUInt32LE(12);
  const gltf=JSON.parse(data.subarray(20,20+jsonSize).toString());
  const clip=gltf.animations.find(a=>a.name==='Fly_Idle_Loop');
  let movingJoints=0;
  for(const channel of clip.channels.filter(c=>c.target.path==='rotation')) {
    const accessor=gltf.accessors[clip.samplers[channel.sampler].output],view=gltf.bufferViews[accessor.bufferView];
    const offset=28+jsonSize+(view.byteOffset??0)+(accessor.byteOffset??0);
    const values=Array.from({length:accessor.count},(_,i)=>Array.from({length:4},(_,k)=>data.readFloatLE(offset+i*16+k*4)));
    assert.deepEqual(values[0],values.at(-1),'loop closes without a pose jump');
    let amplitude=0;
    for(let k=0;k<4;k++) amplitude=Math.max(amplitude,Math.max(...values.map(v=>v[k]))-Math.min(...values.map(v=>v[k])));
    assert.ok(amplitude<.1,'hover motion stays small');
    if(amplitude>.0001)movingJoints++;
    for(const v of values)assert.ok(Math.abs(Math.hypot(...v)-1)<1e-5);
  }
  assert.ok(movingJoints>10,'hover animates the body rather than only translating the whole mesh');
});

test('free camera look preserves flight and swim heading until steering is held',()=>{
  for(const mode of ['fly','swim'] as const) {
    const f=setup(),{body,state,input,step}=f;
    if(mode==='swim') {
      const tri=chicago.environment.water.find(t=>isWaterAt(t.reduce((s,p)=>s+p[0],0)/3,t.reduce((s,p)=>s+p[1],0)/3));
      const x=tri.reduce((s,p)=>s+p[0],0)/3,z=tri.reduce((s,p)=>s+p[1],0)/3;
      body.position.set(x,WATER_LEVEL-3,z);f.floor.position.set(x,WATER_LEVEL-20,z);
    } else body.position.y=20;
    state.mode=mode;input.z=1;
    step();
    const originalYaw=state.moveYaw,originalPitch=state.movePitch;
    const controls=input as typeof input & {steer:boolean};
    controls.steer=false;input.yaw=0;input.pitch=-.6;
    step();assert.equal(state.moveYaw,originalYaw);assert.equal(state.movePitch,originalPitch);
    controls.steer=true;step();assert.equal(state.moveYaw,0);assert.equal(state.movePitch,-.6);
    controls.steer=false;input.yaw=1;input.pitch=.3;step();
    assert.equal(state.moveYaw,0);assert.equal(state.movePitch,-.6);
    f.dispose();
  }
});

test('flight request works during a fall and swimming without a preceding jump',()=>{
  const falling=setup();
  falling.body.position.y=20;falling.step(5);
  assert.equal(falling.state.mode,'walk');assert.ok(falling.state.verticalSpeed<0);
  falling.input.fly=true;falling.step();falling.input.fly=false;
  assert.equal(falling.state.mode,'fly');assert.equal(falling.state.verticalSpeed,0);
  const y=falling.body.position.y;falling.step(30);assert.ok(Math.abs(falling.body.position.y-y)<.001);
  falling.dispose();
  const swimming=setup();
  const tri=chicago.environment.water.find(t=>isWaterAt(t.reduce((s,p)=>s+p[0],0)/3,t.reduce((s,p)=>s+p[1],0)/3));
  const x=tri.reduce((s,p)=>s+p[0],0)/3,z=tri.reduce((s,p)=>s+p[1],0)/3;
  swimming.body.position.set(x,WATER_LEVEL-3,z);swimming.floor.position.set(x,WATER_LEVEL-20,z);
  swimming.step();assert.equal(swimming.state.mode,'swim');
  swimming.input.fly=true;swimming.step();swimming.input.fly=false;swimming.step(5);
  assert.equal(swimming.state.mode,'fly','water does not cancel the explicit flight request on the following tick');
  assert.ok(swimming.body.position.y+1.8<WATER_LEVEL,'the entire character starts underwater');
  swimming.input.up=true;swimming.step(30);swimming.input.up=false;
  assert.equal(swimming.state.mode,'fly');
  assert.ok(swimming.body.position.y>WATER_LEVEL,'flight crosses the water surface without the swim height limit');
  swimming.step(60);const hover=swimming.body.position.y;swimming.step(15);
  assert.ok(Math.abs(swimming.body.position.y-hover)<.001);
  swimming.dispose();
});

test('flight cancellation restores gravity in air and swimming underwater; a single descent does not cancel',()=>{
  const f=setup(),{body,state,input,step}=f;
  state.mode='fly';body.position.y=20;input.down=true;step();assert.equal(state.mode,'fly');
  input.down=false;
  const controls=input as typeof input & {stopFlight:boolean};controls.stopFlight=true;step();controls.stopFlight=false;
  assert.equal(state.mode,'walk');assert.ok(state.verticalSpeed<0);
  const y=body.position.y;step(15);assert.ok(body.position.y<y);
  const tri=chicago.environment.water.find(t=>isWaterAt(t.reduce((s,p)=>s+p[0],0)/3,t.reduce((s,p)=>s+p[1],0)/3));
  const x=tri.reduce((s,p)=>s+p[0],0)/3,z=tri.reduce((s,p)=>s+p[1],0)/3;
  body.position.set(x,WATER_LEVEL-3,z);f.floor.position.set(x,WATER_LEVEL-20,z);state.mode='fly';
  controls.stopFlight=true;step();controls.stopFlight=false;
  assert.equal(state.mode,'swim');step();assert.equal(state.mode,'swim');
  f.dispose();
});

test('flight turns and brakes progressively, with greater inertia at higher speeds',()=>{
  for(const speed of [25.6,56,196]) {
    const f=setup(),{body,state,input,step}=f;
    body.position.y=100;state.mode='fly';state.flightVelocity.set(0,0,speed);
    input.z=1;input.yaw=0;input.run=speed>25.6;
    state.superRunning=speed===196;state.forwardDown=true;
    step();
    assert.ok(state.flightVelocity.z>speed-4.01,'previous direction persists after steering');
    assert.ok(state.flightVelocity.x<0 && state.flightVelocity.x>=-4.01,'turn acceleration is bounded');
    const turn=Math.atan2(-state.flightVelocity.x,state.flightVelocity.z);
    assert.ok(turn<4.5/speed,'angular response decreases as speed grows');
    input.z=0;const before=state.flightVelocity.length();step();
    assert.ok(Math.abs(state.flightVelocity.length()-(before-160/60))<1e-6);
    assert.equal(state.moving,true,'coasting keeps the flight animation active');
    step(Math.ceil(before/160*60)+1);
    assert.equal(state.flightVelocity.length(),0);assert.equal(state.moving,false);
    const stopped=body.position.clone();step(10);assert.ok(body.position.equalsWithEpsilon(stopped));
    f.dispose();
  }
});
