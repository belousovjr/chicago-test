import { GizmoManager } from '@babylonjs/core/Gizmos/gizmoManager.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { createWorld, parseWorld, objectProperties, setObjectSize, WORLD_LIMIT, MAX_SIZE, WORLD_STORAGE_KEY } from './world.ts';
import type { Kind, Triple, ObjectTemplate, WorldObject } from './world.ts';
import { setArchitectureStatic, PROFILES } from './architecture.ts';
import type { Profile } from './architecture.ts';
import type { WorldRenderer } from './worldRenderer.ts';
import type { SceneCameras } from './sceneCameras.ts';
import type { GameInput } from './gameInput.ts';
import { $, notify } from './ui.ts';

export function createEditor({ scene, canvas, city, cameras, player, input, changed, respawn, updateLODs }: {
  scene: Scene; canvas: HTMLCanvasElement; city: WorldRenderer; cameras: SceneCameras; player: Mesh; input: GameInput;
  changed: () => void; respawn: () => void; updateLODs: () => void;
}) {
  const { camera, editorCamera, followCamera, cameraBoom } = cameras;
  let previewLod = -1;
  function rebuild() {
    select(null); refreshTemplates(); city.rebuild(editing); updateLODs(); changed();
  }
  function describeEditorCamera() {
    const p = editorCamera.position;
    $('camera-coordinates').textContent = `Камера · X ${p.x.toFixed(1)} / Y ${p.y.toFixed(1)} / Z ${p.z.toFixed(1)} м`;
  }
  let editing = false;
  let selected: Mesh | null = null;
  let dirty = false;
  const gizmos = new GizmoManager(scene);
  gizmos.usePointerToAttachGizmos = false;
  gizmos.positionGizmoEnabled = true;
  gizmos.clearGizmoOnEmptyPointerEvent = false;
  let tool: 'position' | 'rotation' | 'scale' = 'position';
  function markDirty() { dirty = true; $('save').textContent = 'Сохранить •'; }
  function syncObjects() {
    city.activeCell = '';
    for (const o of city.world.objects) {
      const mesh = city.meshes.get(o.id)!;
      o.position = mesh.position.asArray() as Triple;
      const size = mesh.scaling.asArray().map(n => Math.max(0.25, Math.min(MAX_SIZE, n))) as Triple;
      setObjectSize(city.world, o, size);
      mesh.scaling.copyFromFloats(...size);
      const yaw = mesh.rotationQuaternion ? mesh.rotationQuaternion.toEulerAngles().y : mesh.rotation.y;
      o.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      city.updateCellCoverage(mesh);
    }
    changed();
  }
  function describeSelection() {
    if (!selected) { $('selection').textContent = 'Выберите объект в сцене'; return; }
    const p = selected.position, s = selected.scaling;
    const object = city.world.objects.find(o => o.id === selected!.name)!;
    const template = city.world.templates.find(t => t.id === object.templateId)!;
    $('selection').textContent = `${object.name ?? template.name} · ${template.kind}\nLOD ${selected.metadata.lod ?? 0} / ${Math.max(0, (city.modelLevels.get(selected)?.length ?? 1) - 1)} · △ ${(city.modelLevels.get(selected) ?? []).map(m => m.getTotalIndices() / 3).join(' / ')}\n${object.size || object.color ? 'Есть индивидуальные изменения' : 'Наследует шаблон'}\n${selected.name}\nXYZ ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\nРазмер ${s.x.toFixed(1)} × ${s.y.toFixed(1)} × ${s.z.toFixed(1)} м`;
  }
  function select(mesh: Mesh | null) {
    selected = mesh; gizmos.attachToMesh(editing ? mesh : null);
    for (const id of ['assign-template', 'reset-overrides', 'template-from-object']) $(id).toggleAttribute('disabled', !mesh);
    const lodSelect = $<HTMLSelectElement>('lod-preview');
    lodSelect.disabled = !mesh; $('focus-object').toggleAttribute('disabled', !mesh);
    const maxLod = mesh ? city.modelLevels.get(mesh)!.length - 1 : 0;
    for (const option of lodSelect.options) option.disabled = Number(option.value) > maxLod;
    if (previewLod > maxLod) { previewLod = -1; lodSelect.value = '-1'; }
    if (mesh) {
      $<HTMLSelectElement>('template').value = city.world.objects.find(o => o.id === mesh.name)!.templateId;
      showTemplate();
    }
    $('duplicate').toggleAttribute('disabled', !mesh); $('delete').toggleAttribute('disabled', !mesh);
    describeSelection();
  }
  function configureGizmos() {
    scene.skipPointerMovePicking = !editing;
    scene.skipPointerDownPicking = !editing;
    scene.skipPointerUpPicking = !editing;
    for (const layer of [gizmos.utilityLayer, gizmos.keepDepthUtilityLayer]) {
      layer.pickingEnabled = editing; layer.shouldRender = editing;
    }
    gizmos.attachToMesh(null);
    gizmos.positionGizmoEnabled = tool === 'position';
    gizmos.rotationGizmoEnabled = tool === 'rotation';
    gizmos.scaleGizmoEnabled = tool === 'scale';
    const snap = $<HTMLInputElement>('snap').checked;
    if (gizmos.gizmos.positionGizmo) gizmos.gizmos.positionGizmo.snapDistance = snap ? 1 : 0;
    if (gizmos.gizmos.rotationGizmo) {
      const g = gizmos.gizmos.rotationGizmo;
      // World Y rotation supports the nonuniform dimensions of our box objects.
      g.updateGizmoRotationToMatchAttachedMesh = false;
      g.snapDistance = snap ? Math.PI / 12 : 0;
      g.xGizmo.isEnabled = false; g.zGizmo.isEnabled = false;
    }
    if (gizmos.gizmos.scaleGizmo) {
      gizmos.gizmos.scaleGizmo.incrementalSnap = true;
      gizmos.gizmos.scaleGizmo.snapDistance = snap ? 0.25 : 0;
    }
    gizmos.attachToMesh(editing ? selected : null);
  }
  const hooked = new Set<unknown>();
  function watchGizmos() {
    for (const g of [gizmos.gizmos.positionGizmo, gizmos.gizmos.rotationGizmo, gizmos.gizmos.scaleGizmo]) {
      if (g && !hooked.has(g)) {
        g.onDragEndObservable.add(() => { syncObjects(); markDirty(); describeSelection(); });
        hooked.add(g);
      }
    }
  }
  function setMode() {
    syncObjects(); editing = !editing; input.reset();
    for (const root of [...city.meshes.values(), ...city.furnitureRoots]) setArchitectureStatic(root, !editing);
    $('editor').hidden = !editing; $('intro').hidden = editing;
    $('mode').innerHTML = editing ? 'Играть <kbd>Tab</kbd>' : 'Редактор <kbd>Tab</kbd>';
    if (editing) {
      cameraBoom.reset();
      camera.detachControl();
      if (!cameras.hasEditorCameraPose) {
        editorCamera.position.copyFrom(player.position).addInPlaceFromFloats(0, 18, -18);
        editorCamera.setTarget(player.position.add(new Vector3(0, 1, 0)));
        cameras.hasEditorCameraPose = true;
      }
      describeEditorCamera();
      scene.activeCamera = editorCamera; editorCamera.attachControl(canvas, true);
      // Keep editor keyboard flight scoped to the canvas, not form controls.
      const mouse = editorCamera.inputs.attached.mouse;
      if (mouse && 'buttons' in mouse) (mouse as { buttons: number[] }).buttons = [2];
      for (const m of city.meshes.values()) m.setEnabled(true);
      notify('Редактор · изменения применяются сразу. Сохраните карту перед выходом.');
    } else {
      cameras.saveEditorCamera();
      editorCamera.detachControl(); scene.activeCamera = followCamera; camera.attachControl(true, true, 1);
      select(null); respawn(); notify('Режим игры · карта применена');
    }
    configureGizmos(); watchGizmos();
    canvas.focus();
  }
  $('mode').onclick = setMode;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tool]')) button.onclick = () => {
    tool = button.dataset.tool as typeof tool;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('active', b === button));
    configureGizmos(); watchGizmos();
  };
  $('snap').onchange = configureGizmos;
  scene.onPointerObservable.add(info => {
    if (info.type !== 1 || !editing || (info.event as PointerEvent).button !== 0) return;
    const mesh = info.pickInfo?.pickedMesh;
    if (mesh?.metadata?.worldId && city.meshes.has(mesh.metadata.worldId)) select(city.meshes.get(mesh.metadata.worldId)!);
  });
  function chosenTemplate() { return city.world.templates.find(t => t.id === $<HTMLSelectElement>('template').value)!; }
  function showTemplate() {
    const t = chosenTemplate();
    if (!t) return;
    $<HTMLInputElement>('template-name').value = t.name;
    $<HTMLSelectElement>('template-kind').value = t.kind;
    ['x', 'y', 'z'].forEach((axis, i) => { $<HTMLInputElement>(`template-${axis}`).value = String(t.size[i]); });
    $<HTMLInputElement>('template-color').value = t.color;
    $<HTMLSelectElement>('template-profile').value = t.profile ?? 'box';
    $<HTMLInputElement>('template-lod').value = (t.lodDistances ?? []).join(', ');
  }
  function refreshTemplates() {
    const select = $<HTMLSelectElement>('template'), previous = select.value;
    select.replaceChildren(...city.world.templates.map(t => new Option(t.name, t.id)));
    if (city.world.templates.some(t => t.id === previous)) select.value = previous;
    showTemplate();
  }
  function rebuildKeepingSelection(id = selected?.name) {
    cameraBoom.reset(); rebuild();
    if (id) select(city.meshes.get(id) ?? null);
  }
  $<HTMLSelectElement>('template-profile').replaceChildren(...PROFILES.map(p => new Option(p, p)));
  $('template').onchange = showTemplate;
  $('lod-preview').onchange = () => { previewLod = Number($<HTMLSelectElement>('lod-preview').value); updateLODs(); describeSelection(); };
  $('city-overview').onclick = () => { editorCamera.position.set(900, 850, 1100); editorCamera.setTarget(new Vector3(0, 70, 0)); canvas.focus(); };
  $('focus-object').onclick = () => { if (!selected) return; editorCamera.position.copyFrom(selected.position).addInPlaceFromFloats(40, 25, -65); editorCamera.setTarget(selected.position); canvas.focus(); };

  $('save-template').onclick = () => {
    try {
      syncObjects();
      const t = chosenTemplate();
      const candidate = structuredClone(city.world);
      const updated: ObjectTemplate = {
        id: t.id, name: $<HTMLInputElement>('template-name').value,
        kind: $<HTMLSelectElement>('template-kind').value as Kind,
        size: ['x', 'y', 'z'].map(axis => Number($<HTMLInputElement>(`template-${axis}`).value)) as Triple,
        color: $<HTMLInputElement>('template-color').value,
        profile: $<HTMLSelectElement>('template-profile').value as Profile,
        lodDistances: $<HTMLInputElement>('template-lod').value.trim() ? $<HTMLInputElement>('template-lod').value.split(',').map(Number) : [],
      };
      candidate.templates[candidate.templates.findIndex(item => item.id === t.id)] = updated;
      city.world = parseWorld(candidate); rebuildKeepingSelection(); markDirty();
      notify('Шаблон обновлён. Индивидуальные изменения экземпляров сохранены.');
    } catch (error) { notify(String(error)); }
  };
  $('delete-template').onclick = () => {
    const t = chosenTemplate();
    if (city.world.objects.some(o => o.templateId === t.id)) { notify('Шаблон используется. Сначала назначьте его экземплярам другой шаблон или удалите их.'); return; }
    if (city.world.templates.length === 1) { notify('В каталоге должен остаться хотя бы один шаблон.'); return; }
    city.world.templates = city.world.templates.filter(item => item.id !== t.id);
    refreshTemplates(); markDirty();
  };
  $('assign-template').onclick = () => {
    if (!selected) return;
    syncObjects();
    const o = city.world.objects.find(o => o.id === selected!.name)!;
    o.templateId = chosenTemplate().id; delete o.size; delete o.color;
    rebuildKeepingSelection(); markDirty();
  };
  $('reset-overrides').onclick = () => {
    if (!selected) return;
    syncObjects(); const o = city.world.objects.find(o => o.id === selected!.name)!;
    delete o.size; delete o.color; rebuildKeepingSelection(); markDirty();
  };
  $('template-from-object').onclick = () => {
    if (!selected) return;
    if (city.world.templates.length >= 256) { notify('Лимит: 256 шаблонов.'); return; }
    syncObjects(); const o = city.world.objects.find(o => o.id === selected!.name)!;
    const name = prompt('Название нового шаблона:', `${chosenTemplate().name} — копия`);
    if (name === null) return;
    if (!name.trim() || name.length > 80) { notify('Название: от 1 до 80 символов.'); return; }
    const p = objectProperties(city.world, o);
    const source = city.world.templates.find(t => t.id === o.templateId)!;
    const t: ObjectTemplate = { ...structuredClone(source), id: crypto.randomUUID(), name: name.trim(), kind: p.kind, size: [...p.size], color: p.color };
    city.world.templates.push(t); o.templateId = t.id; delete o.size; delete o.color;
    rebuildKeepingSelection(); markDirty(); notify('Шаблон создан из выбранного объекта.');
  };
  $('add').onclick = () => {
    const t = chosenTemplate();
    const center = editorCamera.position.add(editorCamera.getForwardRay().direction.scale(18));
    const o: WorldObject = { id: crypto.randomUUID(), templateId: t.id, position: [Math.round(center.x), t.kind === 'ground' ? -t.size[1] / 2 : t.size[1] / 2, Math.round(center.z)], yaw: 0 };
    if (city.world.objects.length >= 2000 || Math.abs(o.position[0]) > WORLD_LIMIT || Math.abs(o.position[2]) > WORLD_LIMIT) { notify('Лимит: 2000 объектов, координаты ±4096 м.'); return; }
    city.world.objects.push(o); select(city.addMesh(o, editing)); changed(); markDirty();
  };
  $('duplicate').onclick = () => {
    if (!selected || city.world.objects.length >= 2000) return;
    syncObjects();
    const source = city.world.objects.find(o => o.id === selected!.name)!;
    const copy = structuredClone(source); copy.id = crypto.randomUUID(); copy.position[0] += objectProperties(city.world, copy).size[0] + 1;
    if (Math.abs(copy.position[0]) > WORLD_LIMIT) { notify('Объект выходит за границы карты.'); return; }
    city.world.objects.push(copy); select(city.addMesh(copy, editing)); changed(); markDirty();
  };
  $('delete').onclick = () => {
    if (!selected) return;
    const mesh = selected; select(null);
    city.world.objects = city.world.objects.filter(o => o.id !== mesh.name);
    city.removeMesh(mesh); changed(); markDirty();
  };
  function snapshot() { syncObjects(); return parseWorld(city.world); }
  $('save').onclick = () => {
    try {
      const data = snapshot(); localStorage.setItem(WORLD_STORAGE_KEY, JSON.stringify(data));
      dirty = false; $('save').textContent = 'Сохранить'; notify('Карта сохранена в этом браузере.');
    } catch (e) { notify(`Не удалось сохранить: ${e instanceof Error ? e.message : 'хранилище недоступно'}`); }
  };
  $('export').onclick = () => {
    try {
      const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = 'block-district.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('JSON экспортирован.');
    } catch (e) { notify(String(e)); }
  };
  $<HTMLInputElement>('import').onchange = async event => {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
    try {
      if (file.size > 4_000_000) throw new Error('Файл больше 4 МБ.');
      const next = parseWorld(JSON.parse(await file.text()));
      if (dirty && !confirm('Заменить карту? Несохранённые изменения будут потеряны.')) return;
      city.world = next; rebuild(); respawn(); markDirty(); notify('Карта импортирована. Нажмите «Сохранить», чтобы оставить её в браузере.');
    } catch (e) { notify(`Импорт отменён: ${e instanceof Error ? e.message : 'ошибка файла'}`); }
    finally { input.value = ''; }
  };
  $('spawn').onclick = () => { city.world.spawn = player.position.asArray() as Triple; city.world.spawn[1] = Math.max(1, city.world.spawn[1]); markDirty(); notify('Точка старта обновлена по позиции игрока.'); };
  $('reset').onclick = () => {
    if (!confirm('Заменить текущую карту исходным Chicago Loop?')) return;
    city.world = createWorld(); rebuild(); respawn(); markDirty(); notify('Chicago Loop восстановлен. Сохранение в браузере пока не изменено.');
  };
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  return {
    get editing() { return editing; },
    get selected() { return selected; },
    get previewLod() { return previewLod; },
    toggle: setMode,
    describeSelection,
    describeEditorCamera,
    rebuild,
    initialize() { rebuild(); configureGizmos(); watchGizmos(); respawn(); },
  };
}
