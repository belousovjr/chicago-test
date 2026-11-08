import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Material } from '@babylonjs/core/Materials/material.js';

export function treeVariant(id: string) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 6;
}

export function buildTree(scene: Scene, bark: Material, leaves: Material, lods: number, variant: number, farLeaves = leaves) {
  const [spread, rise, lean] = [[1.25,.8,0],[.65,1.25,0],[1.1,1.05,0],[1.15,.95,.16],[1.8,.65,-.1],[.95,1.15,-.15]][variant % 6]!;
  return Array.from({length:lods}, (_,lod) => {
    let seed = 101 + variant * 719;
    const random = () => ((seed = Math.imul(seed,1664525)+1013904223|0)>>>0)/4294967296;
    const parts: Mesh[] = [];
    const far = lod > 0 && lod === lods - 1;
    const branch = (a: Vector3,b: Vector3,width: number) => {
      const mesh = MeshBuilder.CreateCylinder('tree-wood',{height:Vector3.Distance(a,b),diameterBottom:width,diameterTop:width>=.06?width:width*.45,tessellation:far?4:width>=.06?12:5},scene);
      mesh.position.copyFrom(a.add(b).scale(.5));
      mesh.setDirection(b.subtract(a),0,Math.PI/2);
      mesh.material=bark;parts.push(mesh);return mesh;
    };
    const trunk=branch(new Vector3(0,-.5,0),new Vector3(0,.12,0),.06);
    const collisionSource=lod===0?trunk.clone('tree-trunk-collision',null,true)!:null;
    collisionSource?.setEnabled(false);
    if (far) for (const [pitch, yaw] of [[0, 0], [0, Math.PI / 2], [-Math.PI / 2, 0]]) {
      const crown=MeshBuilder.CreatePlane('tree-crown',{size:1.05,sideOrientation:Mesh.DOUBLESIDE},scene);
      // The billboard cross stays on the trunk axis, including asymmetric crown variants.
      crown.position.set(0,.15,0);crown.rotation.set(pitch!,yaw!,0);crown.material=farLeaves;
      crown.setVerticesData('normal', Array.from({length:crown.getTotalVertices()},()=>[0,1,0]).flat());parts.push(crown);
    }
    for(let cluster=0;!far && cluster<9;cluster++) {
      const angle=cluster*2.399+variant*.6, radius=cluster===8?0:.2+random()*.19;
      const centre=new Vector3(Math.cos(angle)*radius*spread!+lean!, (cluster===8?.29:-.01+random()*.27)*rise!, Math.sin(angle)*radius*spread!);
      if(lod===0 || cluster%2===0) branch(new Vector3(0,-.05,0),centre,.025);
      for(let plane=0;plane<3;plane++) {
        const yaw=angle+plane*Math.PI/3, tilt=(random()-.5)*.65;
        if(lod===1 && plane===2 || lod>=2 && (plane!==0 || cluster%2!==0))continue;
        const mesh=MeshBuilder.CreatePlane('tree-leaves',{width:.68,height:.68*212/228,sideOrientation:Mesh.DOUBLESIDE},scene);
        mesh.position.copyFrom(centre);mesh.rotation.set(tilt,yaw,0);mesh.material=leaves;
        // Rounded crown normals keep cutout cards from looking like dark intersecting boards.
        const p=mesh.getVerticesData('position')!, normals=mesh.getVerticesData('normal')!;
        for(let i=0;i<p.length;i+=3) {
          const n=new Vector3(centre.x+p[i]!*.4,.5+centre.y,centre.z+p[i+2]!*.4).normalize();
          normals[i]=n.x;normals[i+1]=n.y;normals[i+2]=n.z;
        }
        mesh.setVerticesData('normal',normals);parts.push(mesh);
      }
    }
    for (const part of parts) part.setVerticesData('color', Array.from({length:part.getTotalVertices()},()=>[1,1,1,1]).flat());
    const result=Mesh.MergeMeshes(parts,true,true,undefined,false,true)!;
    if (collisionSource) {
      collisionSource.parent=result;
      result.metadata={collisionSource};
    }
    result.setEnabled(false);return result;
  });
}
