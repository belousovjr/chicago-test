import { strict as assert } from 'node:assert';
import { test, mock } from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { buildArchitecture } from '../src/architecture.ts';
import layout from '../src/facadeLayout.json' with { type: 'json' };

test('facade ribs and belts fit opaque texture gaps, including bases and roofs at every LOD', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const body = new StandardMaterial('body', scene), detail = new StandardMaterial('detail', scene);
  const base = new StandardMaterial('base', scene), roof = new StandardMaterial('roof', scene);
  const original = Mesh.MergeMeshes;
  let captures = [];
  const spy = mock.method(Mesh, 'MergeMeshes', (...args: Parameters<typeof Mesh.MergeMeshes>) => {
    captures.push(args[0].map(mesh => {
      const matrix = mesh.computeWorldMatrix(true), positions = mesh.getVerticesData('position'), uv = mesh.getVerticesData('uv'), normals = mesh.getVerticesData('normal');
      const face = [];
      for (let i = 0; i < positions.length; i += 3) if (normals[i + 2] > .9) {
        face.push({ point: Vector3.TransformCoordinates(Vector3.FromArray(positions, i), matrix), u: uv[i / 3 * 2], v: uv[i / 3 * 2 + 1] });
      }
      return { material: mesh.material, face, bounds: mesh.getBoundingInfo().boundingBox };
    }));
    return original(...args);
  });
  try {
    for (const profile of ['glass', 'stone'] as const) {
      captures = [];
      const levels = buildArchitecture({ id: profile, name: profile, profile, kind: 'building', size: [36, 100, 30], color: '#ffffff', lodDistances: [100, 200] }, scene, body, detail, [0],
        (_lod, accent, _light, role) => role === 'base' ? base : role === 'roof' ? roof : accent ? detail : body);
      const grid = profile === 'glass' ? layout.glass : layout.masonry;
      for (const [lod, parts] of captures.entries()) {
        const face = parts.find(part => part.material === body).face;
        // Recover UV projection from actual generated vertices, rather than assuming its formula.
        const a = face[0], x = face.find(p => Math.abs(p.point.x - a.point.x) > .1), y = face.find(p => Math.abs(p.point.y - a.point.y) > .1);
        const u = value => a.u + (value - a.point.x) * (x.u - a.u) / (x.point.x - a.point.x);
        const v = value => a.v + (value - a.point.y) * (y.v - a.v) / (y.point.y - a.point.y);
        assert.ok(Math.abs(v(parts.find(part => part.material === base).bounds.maximumWorld.y)) < 1e-6);
        assert.ok(Math.abs(v(parts.find(part => part.material === roof).bounds.minimumWorld.y) - 1) < 1e-6);
        let checked = 0;
        for (const part of parts.filter(part => part.material === detail)) {
          const { minimumWorld: min, maximumWorld: max } = part.bounds;
          const belt = max.x - min.x > 1 && max.y - min.y < .02;
          const rib = max.x - min.x < .03 && max.y - min.y > .8;
          if (!belt && !rib) continue;
          const lo = belt ? v(min.y) : u(min.x), hi = belt ? v(max.y) : u(max.x);
          const count = belt ? grid.rows : grid.columns;
          for (let cell = 0; cell < count; cell++) {
            const start = (Math.round(cell * layout.size / count) + (belt ? grid.insetTop : grid.insetX)) / layout.size;
            const end = (Math.round((cell + 1) * layout.size / count) - (belt ? grid.insetBottom : grid.insetX + 1)) / layout.size;
            assert.ok(hi <= start + 1e-6 || lo >= end - 1e-6, `${profile}: ${belt ? 'belt' : 'rib'} overlaps window ${cell}`);
          }
          checked++;
        }
        assert.equal(checked, lod === 0 ? (profile === 'glass' ? 13 : 19) : 0);
      }
      levels.forEach(level => level.dispose());
    }
  } finally { spy.mock.restore(); scene.dispose(); engine.dispose(); }
});

test('Marina window rows stay aligned with every ring at every LOD', () => {
  const engine=new NullEngine(),scene=new Scene(engine);
  const body=new StandardMaterial('windows',scene),detail=new StandardMaterial('rings',scene),roof=new StandardMaterial('roof',scene);
  const original=Mesh.MergeMeshes;
  let checked=0;
  const spy=mock.method(Mesh,'MergeMeshes',(...args:Parameters<typeof Mesh.MergeMeshes>)=>{
    const parts=args[0],core=parts.find(p=>p.material===body)!;
    const positions=core.getVerticesData('position')!,uv=core.getVerticesData('uv')!,normals=core.getVerticesData('normal')!;
    const side=[];
    for(let i=0;i<positions.length;i+=3) if(Math.abs(normals[i+1]!)<.1) {
      side.push({y:positions[i+1]!*core.scaling.y+core.position.y,v:uv[i/3*2+1]!});
    }
    const lo=side.reduce((a,b)=>a.y<b.y?a:b),hi=side.reduce((a,b)=>a.y>b.y?a:b);
    const rowAt=(y:number)=>(lo.v+(y-lo.y)*(hi.v-lo.v)/(hi.y-lo.y))*layout.glass.rows;
    const rings=parts.filter(p=>p.material===detail && Math.abs(p.scaling.y-.015)<1e-6);
    assert.equal(rings.length,layout.marina.rings);
    for(const [i,ring] of rings.entries()) {
      assert.ok(Math.abs(rowAt(ring.position.y)-i)<1e-5,'ring centre falls on a window-row boundary');
      assert.ok(Math.abs(rowAt(ring.position.y+.0075)-(i+.15))<1e-5,'visible gaps retain the same window phase');
    }
    checked++;
    return original(...args);
  });
  try {
    const levels=buildArchitecture({id:'marina',name:'Marina',profile:'marina',kind:'building',size:[38,179,38],color:'#ffffff',lodDistances:[180,650]},scene,body,detail,[0],
      (_lod,accent,_light,role)=>role==='roof'?roof:accent?detail:body);
    assert.equal(checked,3);levels.forEach(m=>m.dispose());
  } finally {spy.mock.restore();scene.dispose();engine.dispose();}
});

test('masonry wall parts contain whole windows of at least 1.5 m, at all LODs and building heights', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const body = new StandardMaterial('body', scene), detail = new StandardMaterial('detail', scene);
  const original = Mesh.MergeMeshes;
  let height = 0, panelled = false, checked = 0;
  const spy = mock.method(Mesh, 'MergeMeshes', (...args: Parameters<typeof Mesh.MergeMeshes>) => {
    for (const mesh of args[0].filter(m => m.material === body)) {
      const positions = mesh.getVerticesData('position')!, uv = mesh.getVerticesData('uv')!, normals = mesh.getVerticesData('normal')!;
      const bottom = Math.max(mesh.position.y - mesh.scaling.y / 2, panelled ? layout.bodyBottom : -.5);
      const top = Math.min(mesh.position.y + mesh.scaling.y / 2, panelled ? layout.bodyTop : .5);
      for (const axis of [0, 2]) {
        const face = [];
        for (let i = 0; i < positions.length; i += 3) if (normals[i + axis]! > .9) {
          face.push({ y: positions[i + 1]! * mesh.scaling.y + mesh.position.y, u: uv[i / 3 * 2]!, v: uv[i / 3 * 2 + 1]! });
        }
        const lo = face.reduce((a,b) => a.y < b.y ? a : b), hi = face.reduce((a,b) => a.y > b.y ? a : b);
        if (hi.v === lo.v) { assert.ok(height * (top - bottom) < 1.5 / .703125 + 1e-5); continue; }
        const v = (y: number) => lo.v + (y - lo.y) * (hi.v - lo.v) / (hi.y - lo.y);
        const rows = (v(top) - v(bottom)) * layout.masonry.rows;
        assert.ok(Math.abs(v(bottom)) < 1e-6);
        assert.ok(Math.abs(rows - Math.round(rows)) < 1e-5 && rows > 0 && rows <= 16);
        assert.ok(height * (top - bottom) / rows * .703125 >= 1.5 - 1e-5);
        const columns = (Math.max(...face.map(p => p.u)) - Math.min(...face.map(p => p.u))) * layout.masonry.columns;
        assert.ok(Math.abs(columns - Math.round(columns)) < 1e-5 && columns >= 1);
        // Any horizontal belt crossing this wall must stay in a texture gutter.
        for (const belt of args[0].filter(m => m.material === detail && m.scaling.y < .02 && Math.abs(m.scaling.x - mesh.scaling.x - .005) < 1e-6)) {
          if (belt.position.y <= bottom || belt.position.y >= top) continue;
          const centre = v(belt.position.y) * layout.masonry.rows;
          assert.ok(Math.abs(centre - Math.round(centre)) < 1e-5);
        }
        checked++;
      }
    }
    return original(...args);
  });
  try {
    for (const profile of ['box', 'stone', 'deco', 'clock', 'gothic'] as const) for (height of [1, 8, 20, 36, 100, 200]) {
      panelled = profile === 'stone' || profile === 'deco';
      const levels = buildArchitecture({ id: profile, name: profile, profile, kind: 'building', size: [36,height,30], color:'#ffffff', lodDistances:[100,200] }, scene, body, detail, [0],
        (_lod, accent, _light, role) => accent || role ? detail : body);
      levels.forEach(m => m.dispose());
    }
    assert.ok(checked > 100);
  } finally { spy.mock.restore(); scene.dispose(); engine.dispose(); }
});

test('bundled tower maps complete glass windows onto all nine stepped volumes at every LOD', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const body = new StandardMaterial('windows', scene), detail = new StandardMaterial('structure', scene);
  const original = Mesh.MergeMeshes;
  let checked = 0;
  const spy = mock.method(Mesh, 'MergeMeshes', (...args: Parameters<typeof Mesh.MergeMeshes>) => {
    const volumes = args[0].filter(mesh => mesh.material === body);
    assert.equal(volumes.length, 9);
    for (const mesh of volumes) {
      assert.ok(Math.abs((mesh.position.y - mesh.scaling.y / 2) + .5) < 1e-6);
      assert.ok(Math.abs(mesh.scaling.y * layout.glass.rows - Math.round(mesh.scaling.y * layout.glass.rows)) < 1e-6,
        'every setback ends on the shared floor grid');
      const uv = mesh.getVerticesData('uv')!, positions = mesh.getVerticesData('position')!, normals = mesh.getVerticesData('normal')!;
      for (let i = 0; i < positions.length; i += 3) if (Math.abs(normals[i + 1]!) < .1) {
        const worldY = positions[i + 1]! * mesh.scaling.y + mesh.position.y;
        assert.ok(Math.abs(uv[i / 3 * 2 + 1]! - (worldY + .5)) < 1e-6,
          'all tubes use exactly the same vertical texture scale and phase');
      }
    }
    for (const mesh of volumes) for (const axis of [0, 2]) {
      const uv = mesh.getVerticesData('uv')!, normals = mesh.getVerticesData('normal')!;
      const us: number[] = [], vs: number[] = [];
      for (let i = 0; i < normals.length; i += 3) if (Math.abs(normals[i + axis]!) > .9) {
        us.push(uv[i / 3 * 2]! * layout.glass.columns);
        vs.push(uv[i / 3 * 2 + 1]! * layout.glass.rows);
      }
      for (const values of [us, vs]) {
        assert.ok(Math.abs(Math.min(...values)) < 1e-6);
        const end = Math.max(...values);
        assert.ok(end >= 1 && Math.abs(end - Math.round(end)) < 1e-5, 'wall ends on a full window-cell boundary');
      }
      checked++;
    }
    return original(...args);
  });
  try {
    const levels = buildArchitecture({id:'willis',name:'Willis',kind:'building',profile:'bundled',size:[70,442,70],color:'#ffffff',lodDistances:[100,200]}, scene, body, detail, [0],
      (_lod, accent, _light, role) => accent || role ? detail : body);
    assert.equal(checked, 54);
    levels.forEach(m => m.dispose());
  } finally { spy.mock.restore(); scene.dispose(); engine.dispose(); }
});

test('Marina concrete cylinders unwrap continuously and ground floor starts at a whole row', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const body = new StandardMaterial('windows', scene), concrete = new StandardMaterial('concrete', scene), base = new StandardMaterial('base', scene), roof = new StandardMaterial('roof', scene);
  const original = Mesh.MergeMeshes;
  let checked = 0;
  const spy = mock.method(Mesh, 'MergeMeshes', (...args: Parameters<typeof Mesh.MergeMeshes>) => {
    const parts = args[0], core = parts.find(m => m.material === body)!;
    assert.ok(Math.abs(core.position.y - core.scaling.y / 2 - layout.marina.bottom) < 1e-6);
    const plinth = parts.find(m => m.material === base)!;
    assert.ok(Math.abs(plinth.position.y + plinth.scaling.y / 2 - layout.marina.bottom) < 1e-6);
    for (const mesh of parts.filter(m => m.material === concrete)) {
      const uv = mesh.getVerticesData('uv')!, normals = mesh.getVerticesData('normal')!, positions = mesh.getVerticesData('position')!;
      const bottom = [];
      for (let i = 0; i < positions.length; i += 3) if (Math.abs(normals[i + 1]!) < .1 && positions[i + 1]! < 0) bottom.push(uv[i / 3 * 2]!);
      const steps = bottom.slice(1).map((u,i) => u - bottom[i]!);
      assert.ok(steps.length >= 6);
      for (const step of steps) assert.ok(Math.abs(step - steps[0]!) < 1e-5, 'no projection switch or stretched cylinder face');
    }
    checked++;
    return original(...args);
  });
  try {
    buildArchitecture({id:'marina',name:'Marina',profile:'marina',kind:'building',size:[38,179,38],color:'#ffffff',lodDistances:[180,650]},scene,body,concrete,[0],
      (_lod,accent,_light,role)=>role==='base'?base:role==='roof'?roof:accent?concrete:body).forEach(m=>m.dispose());
    assert.equal(checked,3);
  } finally { spy.mock.restore(); scene.dispose(); engine.dispose(); }
});

test('roofed facade volumes never retain a coincident upward-facing cap',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),body=new StandardMaterial('body',scene),detail=new StandardMaterial('roof-and-details',scene);
  const original=Mesh.MergeMeshes;let checked=0;
  const spy=mock.method(Mesh,'MergeMeshes',(...args: Parameters<typeof Mesh.MergeMeshes>)=>{
    for(const mesh of args[0].filter(m=>m.material===body)) {
      const normals=mesh.getVerticesData('normal')!,indices=mesh.getIndices()!;
      for(let i=0;i<indices.length;i+=3) assert.ok(!indices.slice(i,i+3).every(index=>normals[index*3+1]!>.5),'facade cap must be removed underneath the roof');
      checked++;
    }
    return original(...args);
  });
  try {
    for(const profile of ['box','glass','stone','deco','bundled','rounded','marina','gothic','clock'] as const) {
      buildArchitecture({id:profile,name:profile,kind:'building',profile,size:[36,100,30],color:'#ffffff',lodDistances:[100,200]},scene,body,detail,[0],
        (_lod,accent,_light,role)=>accent||role?detail:body).forEach(mesh=>mesh.dispose());
    }
    assert.ok(checked>30);
  } finally {spy.mock.restore();scene.dispose();engine.dispose();}
});
