import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { createWorld } from '../src/world.ts';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import '@babylonjs/core/Collisions/collisionCoordinator.js';
import '@babylonjs/core/Culling/ray.js';
import { attachCollisionGeometry, buildArchitecture, createCollisionPrototype } from '../src/architecture.ts';
import { NearbyMeshes } from '../src/nearbyMeshes.ts';
import { initialPlayerState, stepPlayer } from '../src/player.ts';

// Node resolves exact package paths; the application imports use .js too.
test('fixed-step movement normalizes diagonals, walls block, jump lands without falling through', () => {
  const engine = new NullEngine(); const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  const ground = MeshBuilder.CreateBox('ground', {width:100, height:1, depth:100}, scene);
  ground.position.y = -0.5; ground.checkCollisions = true; ground.metadata = {worldId:'ground'};
  const wall = MeshBuilder.CreateBox('wall', {width:10,height:5,depth:1}, scene);
  wall.position.set(0,2.5,5); wall.checkCollisions = true; wall.metadata = {worldId:'wall'};
  const body = MeshBuilder.CreateBox('player',{},scene); body.isPickable=false;
  body.ellipsoid.set(0.35,0.9,0.35); body.ellipsoidOffset.set(0,0.9,0);
  const input = {x:0,z:0,yaw:-Math.PI/2,run:false,jump:false};
  let state = initialPlayerState(); body.position.set(0,1,0);
  const nearby=new NearbyMeshes();nearby.setSources([ground,wall]);
  const step = (n=1) => { for(let i=0;i<n;i++) { scene.meshes.forEach(m=>m.computeWorldMatrix(true)); body.surroundingMeshes=nearby.get(body.position,12); stepPlayer(scene,body,state,input,1/60); } };
  step(90); assert.ok(Math.abs(body.position.y)<0.05); assert.equal(state.grounded,true);
  input.z=1; step(180); assert.ok(body.position.z<4.2 && body.position.z>3.9,`wall: ${body.position.z}`);
  body.position.set(20,0.01,0); input.x=1; step(60);
  assert.ok(Math.abs(Math.hypot(body.position.x-20,body.position.z)-3.2)<0.05);
  input.x=0;input.z=0; input.jump=true;step(); input.jump=false;step(15);
  assert.ok(body.position.y>0.8,'jump rises');
  step(90);assert.ok(Math.abs(body.position.y)<0.05,'lands'); assert.equal(state.grounded,true);
  state=initialPlayerState();body.position.set(20,0.01,0);input.z=1;input.run=true;step(60);
  assert.ok(Math.abs(body.position.z-7)<0.05,'run speed');
  scene.dispose();engine.dispose();
});


test('building colliders block consecutive simulation steps without rendering', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  scene.collisionsEnabled=true;
  const source=MeshBuilder.CreateBox('collision-prototype',{size:1},scene);
  source.setEnabled(false);
  const wall=source.clone('building',null,true)!;
  wall.setEnabled(true);wall.isVisible=false;wall.isPickable=false;
  wall.position.set(0,50,20);wall.scaling.set(50,100,20);
  wall.checkCollisions=true;wall.metadata={worldId:'building'};
  wall.computeWorldMatrix(true);
  const body=MeshBuilder.CreateBox('player',{},scene);
  body.ellipsoid.set(.35,.9,.35);body.ellipsoidOffset.set(0,.9,0);
  body.position.set(0,1,0);
  const state=initialPlayerState();
  for(let i=0;i<240;i++) {
    state.verticalSpeed=0;
    stepPlayer(scene,body,state,{x:0,z:1,yaw:-Math.PI/2,run:true,jump:false},1/60);
  }
  assert.ok(body.position.z<9.66,`building wall penetrated: ${body.position.z}`);
  scene.dispose();engine.dispose();
});


test('player stops outside the visible plinth of large rotated buildings', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  scene.collisionsEnabled=true;
  const source=createCollisionPrototype(scene);
  const wall=source.clone('building',null,true)!;
  wall.setEnabled(true);wall.isVisible=false;wall.checkCollisions=true;
  wall.position.set(0,50,0);wall.scaling.set(100,100,100);
  const body=MeshBuilder.CreateBox('player',{},scene);
  body.ellipsoid.set(.35,.9,.35);body.ellipsoidOffset.set(0,.9,0);
  for(const yaw of [0,Math.PI/4,Math.PI/2]) {
    wall.rotation.y=yaw;wall.computeWorldMatrix(true);
    body.position.set(-60*Math.sin(yaw),1,-60*Math.cos(yaw));
    const state=initialPlayerState();
    for(let i=0;i<240;i++) {
      state.verticalSpeed=0;
      stepPlayer(scene,body,state,{x:0,z:1,yaw:-Math.PI/2-yaw,run:true,jump:false},1/60);
    }
    const distance=-(body.position.x*Math.sin(yaw)+body.position.z*Math.cos(yaw));
    assert.ok(distance>=51.5+.34,`player enters visible plinth at yaw ${yaw}: ${distance}`);
    assert.ok(distance<52,'player reaches the facade');
  }
  scene.dispose();engine.dispose();
});


test('shared collision geometry blocks facades, tree trunks and lamps independently of visual LOD', () => {
  for(const [profile,front] of [['stone',15.45],['tree',.15],['lamp',.065]] as const) {
    const engine=new NullEngine(),scene=new Scene(engine);
    scene.collisionsEnabled=true;
    const ground=MeshBuilder.CreateBox('ground',{width:100,height:1,depth:100},scene);
    ground.position.y=-.5;ground.checkCollisions=true;ground.metadata={worldId:'ground'};
    ground.computeWorldMatrix(true);
    const template=createWorld().templates.find(t=>t.profile===profile)!;
    const material=new StandardMaterial('surface',scene);
    const sources=buildArchitecture(template,scene,material,material);
    const prototype=createCollisionPrototype(scene),root=prototype.clone('object',null,true)!;
    root.setEnabled(true);root.isVisible=false;
    root.scaling.copyFromFloats(...template.size);
    root.position.y=template.size[1]/2;
    const collider=attachCollisionGeometry(root,sources[0]);
    assert.equal(collider.geometry,(sources[0].metadata?.collisionSource ?? sources[0]).geometry,'collision geometry is shared');
    const body=MeshBuilder.CreateBox('player',{},scene);
    body.collisionMask=1;body.ellipsoid.set(.35,.9,.35);body.ellipsoidOffset.set(0,.9,0);
    body.position.set(0,.01,-front-3);
    const state=initialPlayerState();
    for(let i=0;i<180;i++) stepPlayer(scene,body,state,{x:0,z:1,yaw:-Math.PI/2,run:true,jump:false},1/60);
    assert.ok(body.position.z<=-front-.34,`${profile} lets the player through: ${body.position.z}`);
    assert.ok(body.position.z>-front-.5,`${profile} is blocked by oversized editor bounds`);
    assert.ok(collider.isEnabled() && sources.every(source=>!source.isEnabled()),'hidden visual LODs keep collisions');
    root.dispose();
    assert.ok(collider.isDisposed(),'deleting the object also deletes its collider');
    scene.dispose();engine.dispose();
  }
});


test('cached ground checks do not fall back to a scene-wide pick, including empty neighborhoods', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  scene.collisionsEnabled=true;
  const ground=MeshBuilder.CreateBox('ground',{width:20,height:1,depth:20},scene);
  ground.position.y=-.5;ground.checkCollisions=true;ground.isVisible=false;ground.metadata={worldId:'ground'};
  ground.computeWorldMatrix(true);
  const body=MeshBuilder.CreateBox('player',{},scene);
  body.ellipsoid.set(.35,.9,.35);body.ellipsoidOffset.set(0,.9,0);
  body.position.y=.01;body.surroundingMeshes=[ground];
  scene.pickWithRay=()=>{throw new Error('unexpected whole-scene ground scan');};
  const state=initialPlayerState(),input={x:0,z:0,yaw:0,run:false,jump:false};
  stepPlayer(scene,body,state,input,1/60);
  assert.equal(state.grounded,true);
  body.position.set(100,10,100);body.surroundingMeshes=[];
  stepPlayer(scene,body,state,input,1/60);
  assert.equal(state.grounded,false);
  assert.ok(body.position.y<10,'falls normally after teleporting off the ground');
  scene.dispose();engine.dispose();
});
