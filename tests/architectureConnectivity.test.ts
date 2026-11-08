import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { buildArchitecture, PROFILES } from '../src/architecture.ts';

const epsilon=1e-6;
function directions(vectors: Vector3[]) {
  const unique=new Map<string,Vector3>();
  for(const vector of vectors) {
    if(vector.lengthSquared()<1e-16) continue;
    const n=vector.normalize();
    const first=[n.x,n.y,n.z].find(v=>Math.abs(v)>epsilon)!;
    if(first<0)n.scaleInPlace(-1);
    unique.set(n.asArray().map(v=>v.toFixed(6)).join(','),n);
  }
  return [...unique.values()];
}
function solid(mesh: Mesh) {
  const raw=mesh.getVerticesData('position')!,indices=mesh.getIndices()!,matrix=mesh.computeWorldMatrix(true);
  const points=Array.from({length:raw.length/3},(_,i)=>Vector3.TransformCoordinates(Vector3.FromArray(raw,i*3),matrix));
  const edges: Vector3[]=[],normals: Vector3[]=[];
  for(let i=0;i<indices.length;i+=3) {
    const [a,b,c]=[points[indices[i]],points[indices[i+1]],points[indices[i+2]]];
    const ab=b.subtract(a),ac=c.subtract(a);
    edges.push(ab,ac,c.subtract(b));normals.push(Vector3.Cross(ab,ac));
  }
  const bounds=mesh.getBoundingInfo().boundingBox;
  return {points,edges:directions(edges),normals:directions(normals),min:bounds.minimumWorld.clone(),max:bounds.maximumWorld.clone()};
}
type Solid=ReturnType<typeof solid>;
function touching(a: Solid,b: Solid) {
  if(['x','y','z'].some(k=>a.max[k]+epsilon<b.min[k]||b.max[k]+epsilon<a.min[k]))return false;
  // Convex primitive SAT includes containment and touching; overlapping boxes alone are insufficient.
  const axes=[...a.normals,...b.normals,...directions(a.edges.flatMap(x=>b.edges.map(y=>Vector3.Cross(x,y))))];
  return axes.every(axis=>{
    const pa=a.points.map(p=>Vector3.Dot(p,axis)),pb=b.points.map(p=>Vector3.Dot(p,axis));
    return Math.max(...pa)+epsilon>=Math.min(...pb)&&Math.max(...pb)+epsilon>=Math.min(...pa);
  });
}

test('all architectural details connect through real solid contacts to the base at every LOD',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('body',scene);
  const original=Mesh.MergeMeshes;
  let captures:Solid[][]=[];
  const spy=mock.method(Mesh,'MergeMeshes',(...args: Parameters<typeof Mesh.MergeMeshes>)=>{
    captures.push(args[0].map(solid));return original(...args);
  });
  const failures:string[]=[];
  try {
    for(const profile of PROFILES) {
      captures=[];
      const meshes=buildArchitecture({id:profile,name:profile,kind:'building',size:[36,100,30],color:'#ffffff',profile,lodDistances:[100,200]},scene,material,material,[0],()=>material);
      for(const [lod,parts] of captures.entries()) {
        const connected=new Set(parts.flatMap((p,i)=>p.min.y<=-.5+epsilon&&p.max.y>=-.5-epsilon?[i]:[]));
        let changed=true;
        while(changed) {
          changed=false;
          for(let i=0;i<parts.length;i++) if(!connected.has(i)&&[...connected].some(j=>touching(parts[i],parts[j]))) {
            connected.add(i);changed=true;
          }
        }
        const floating=parts.flatMap((p,i)=>connected.has(i)?[]:[`${i} at ${p.min.asArray().map(v=>v.toFixed(4))}`]);
        if(floating.length)failures.push(`${profile} LOD ${lod}: ${floating.join('; ')}`);
      }
      meshes.forEach(m=>m.dispose());
    }
    assert.deepEqual(failures,[]);
  } finally { spy.mock.restore();scene.dispose();engine.dispose(); }
});

test('solid contact accepts touching and containment but rejects mere bounding-box overlap',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try {
    const a=MeshBuilder.CreateBox('a',{size:1},scene),b=MeshBuilder.CreateBox('b',{size:1},scene);
    b.position.x=1;assert.ok(touching(solid(a),solid(b)));
    b.position.x=1.001;assert.equal(touching(solid(a),solid(b)),false);
    b.position.x=0;b.scaling.setAll(.2);assert.ok(touching(solid(a),solid(b)));
    const cylinder=MeshBuilder.CreateCylinder('cylinder',{height:1,diameter:1,tessellation:12},scene);
    b.position.set(.49,0,.49);b.scaling.setAll(.02);
    assert.equal(touching(solid(cylinder),solid(b)),false);
  } finally {scene.dispose();engine.dispose();}
});
