import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { boxEntry, FollowCamera, MIN_CAMERA_DISTANCE } from '../src/followCamera.ts';

test('box sweep handles thickness, corners, rotated boxes, starting inside and parallel misses', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const wall = MeshBuilder.CreateBox('wall', {width:4,height:4,depth:0.1}, scene);
  wall.position.z = 4;
  const origin = Vector3.Zero(), direction = new Vector3(0,0,1);
  assert.ok(Math.abs(boxEntry(origin,direction,9,wall,0.3)! - 3.65)<1e-5);
  assert.equal(boxEntry(origin,direction,3,wall,0.3),null);
  assert.equal(boxEntry(new Vector3(3,0,0),direction,9,wall,0.3),null);
  assert.notEqual(boxEntry(new Vector3(2.2,0,0),direction,9,wall,0.3),null,'sphere edge catches corner');
  assert.equal(boxEntry(new Vector3(0,0,4),direction,9,wall,0.3),0);
  wall.rotation.y=Math.PI/4;wall.scaling.x=2;
  assert.notEqual(boxEntry(origin,direction,9,wall,0.3),null);
  scene.dispose();engine.dispose();
});

test('boom retracts safely, predicts lateral movement, restores zoom and opacity without shared-material changes', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const wall=MeshBuilder.CreateBox('wall',{width:2,height:4,depth:0.1},scene);
  wall.position.set(0,1,4);wall.checkCollisions=true;wall.metadata={kind:'building'};
  const other=MeshBuilder.CreateBox('other',{},scene);other.position.x=30;
  const mat=new StandardMaterial('shared',scene);wall.material=mat;other.material=mat;
  const boom=new FollowCamera(),target=new Vector3(0,1,0),desired=new Vector3(0,1,9);
  boom.update(target,desired,[wall],1/60);
  assert.ok(boom.position.z>3.66 && boom.position.z<9,'unexpected wall starts a smooth retraction');
  for(let i=0;i<20;i++)boom.update(target,desired,[wall],1/60);
  assert.ok(wall.visibility<0.3);assert.equal(other.visibility,1);assert.equal(mat.alpha,1);
  wall.setEnabled(false);boom.update(target,desired,[wall],1/60);
  assert.ok(boom.position.z>3.66 && boom.position.z<9,'smooth release');
  for(let i=0;i<180;i++)boom.update(target,desired,[wall],1/60);
  assert.ok(boom.position.z>8.99);assert.equal(wall.visibility,1);
  wall.setEnabled(true);boom.reset();
  boom.update(new Vector3(1.6,1,0),new Vector3(1.6,1,9),[wall],1/60);
  boom.update(new Vector3(1.5,1,0),new Vector3(1.5,1,9),[wall],1/60);
  assert.equal(boom.position.z,9,'partial coverage cannot activate prediction or zoom');
  assert.equal(wall.visibility,1,'partial coverage cannot activate fading');
  boom.reset();assert.equal(wall.visibility,1);
  boom.update(new Vector3(0,1,3.5),new Vector3(0,1,-5.5),[wall],1/60);
  boom.update(new Vector3(0,1,3.6),new Vector3(0,1,-5.4),[wall],1/60);
  assert.ok(boom.position.subtract(new Vector3(0,1,3.6)).length()>8.99,'prediction cannot push target through a wall');
  scene.dispose();engine.dispose();
});

test('small occlusions keep opacity and only full occlusion retracts camera', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const wall=MeshBuilder.CreateBox('wall',{size:1},scene);
  wall.checkCollisions=true;wall.metadata={kind:'building'};
  const target=new Vector3(0,1.15,0), desired=new Vector3(0,1.15,9);
  const boom=new FollowCamera();
  const checkClear=(message: string) => {
    boom.reset();
    for(let i=0;i<30;i++)boom.update(target,desired,[wall],1/60);
    assert.ok(Math.abs(boom.position.z-9)<1e-6,message);
    assert.equal(wall.visibility,1,message);
  };
  wall.scaling.set(4,0.6,0.1);wall.position.set(0,0.3,4);
  checkClear('low wall leaves head visible');
  wall.scaling.set(0.1,4,0.1);wall.position.set(0,1,4);
  checkClear('thin pole leaves sides visible');
  wall.scaling.set(4,4,0.1);wall.position.z=-1;
  checkClear('wall behind avatar does not occlude it');
  wall.scaling.set(1,4,0.1);wall.position.set(0.8,1,0.1);
  checkClear('nearby wall is not an occluder');
  wall.scaling.set(4,4,0.1);wall.position.set(0,1,4);
  for(let i=0;i<30;i++)boom.update(target,desired,[wall],1/60);
  assert.ok(boom.position.z<4);assert.ok(wall.visibility<0.3);
  wall.scaling.y=0.5;wall.position.y=0.25;
  boom.update(target,desired,[wall],1/60);
  assert.equal(wall.visibility,1,'restore opacity as soon as any sample becomes visible');
  scene.dispose();engine.dispose();
});

test('minimum camera distance survives close walls, prediction, zoom and resets', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const wall=MeshBuilder.CreateBox('close-wall',{width:4,height:4,depth:0.1},scene);
  wall.position.set(0,1,0.7);wall.checkCollisions=true;wall.metadata={kind:'building'};
  const boom=new FollowCamera(),target=new Vector3(0,1.15,0),desired=new Vector3(0,1.15,9);
  for(let i=0;i<60;i++) {
    boom.update(target,desired,[wall],1/60);
    assert.ok(boom.position.subtract(target).length()>=MIN_CAMERA_DISTANCE);
  }
  assert.ok(wall.visibility<0.3,'close blocker still fades');
  boom.reset();
  boom.update(target,new Vector3(0,1.15,1),[],1/60);
  assert.equal(boom.position.subtract(target).length(),MIN_CAMERA_DISTANCE,'minimum also applies to requested zoom');
  wall.setEnabled(false);
  for(let i=0;i<180;i++)boom.update(target,desired,[wall],1/60);
  assert.ok(boom.position.subtract(target).length()>8.99,'normal zoom recovers');
  scene.dispose();engine.dispose();
});

test('low-angle camera retracts above opaque ground and restores zoom in the air', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const ground=MeshBuilder.CreateBox('ground',{width:100,height:1,depth:100},scene);
  ground.position.y=-0.5;ground.checkCollisions=true;ground.metadata={kind:'ground'};
  const boom=new FollowCamera(),target=new Vector3(0,1.15,0);
  const arm=new Vector3(0,-Math.sin(Math.PI/10),Math.cos(Math.PI/10));
  const desired=target.add(arm.scale(9));
  for(let i=0;i<30;i++)boom.update(target,desired,[ground],1/60);
  assert.ok(boom.position.y>=0.3,'camera volume stays above ground');
  assert.ok(boom.position.y<target.y,'can look up at avatar');
  assert.ok(boom.position.subtract(target).length()<9,'floor retracts camera');
  assert.equal(ground.visibility,1);
  // Raised floor can leave less space than the usual 2.5 m minimum.
  ground.position.y=0.1;
  boom.update(target,desired,[ground],1/60);
  assert.ok(boom.position.y>=0.9,'raised floor wins over minimum radius');
  assert.ok(boom.position.subtract(target).length()<MIN_CAMERA_DISTANCE);
  const airTarget=new Vector3(0,8,0),airDesired=airTarget.add(arm.scale(9));
  for(let i=0;i<180;i++)boom.update(airTarget,airDesired,[ground],1/60);
  assert.ok(boom.position.subtract(airTarget).length()>8.99,'recovers full zoom above floor');
  assert.equal(ground.visibility,1);
  scene.dispose();engine.dispose();
});

test('four or more covered samples fade blockers without retracting camera', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const wall=MeshBuilder.CreateBox('wall',{width:4,height:1.1,depth:0.1},scene);
  wall.position.set(0,0.5,4);wall.checkCollisions=true;wall.metadata={kind:'building'};
  const boom=new FollowCamera(),target=new Vector3(0,1.15,0),desired=new Vector3(0,1.15,9);
  for(let i=0;i<30;i++)boom.update(target,desired,[wall],1/60);
  assert.ok(wall.visibility<0.3,'two lower rows (6/9) fade the obstacle');
  assert.equal(boom.position.z,9,'partial coverage preserves camera distance');
  wall.scaling.y=0.2;
  boom.update(target,desired,[wall],1/60);
  assert.equal(wall.visibility,1,'below threshold restores opacity');
  scene.dispose();engine.dispose();
});

test('unexpected occlusion retracts continuously with frame-rate independent damping', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const wall=MeshBuilder.CreateBox('wall',{width:4,height:4,depth:0.1},scene);
  wall.position.set(0,1,4);wall.checkCollisions=true;wall.metadata={kind:'building'};
  const target=new Vector3(0,1.15,0),desired=new Vector3(0,1.15,9);
  const boom=new FollowCamera();
  boom.update(target,desired,[],1/60);
  boom.update(target,desired,[wall],0);
  assert.equal(boom.position.z,9,'no instantaneous collision snap');
  let previous=9;
  for(let i=0;i<30;i++) {
    boom.update(target,desired,[wall],1/60);
    assert.ok(boom.position.z<previous,'approaches obstacle monotonically');
    assert.ok(boom.position.z>3.6,'does not overshoot');
    previous=boom.position.z;
  }
  assert.ok(boom.position.z<3.62,'settles quickly');
  const distances=[];
  for(const dt of [1/30,1/60,1/120]) {
    boom.reset();boom.update(target,desired,[],0);
    for(let i=0;i<Math.round(0.2/dt);i++)boom.update(target,desired,[wall],dt);
    distances.push(boom.position.z);
  }
  assert.ok(Math.max(...distances)-Math.min(...distances)<1e-8);
  scene.dispose();engine.dispose();
});
