import { PERFORMANCE_OPTIONS } from './performanceControls.ts';
import type { DayNight } from './dayNight.ts';

export function mountUI() {
  const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <canvas id="renderCanvas" tabindex="0" aria-label="Игровой мир. WASD — движение, Shift — бег, Space — прыжок, второй прыжок — полёт, C — вниз, повтор W с Shift — галоп, Tab — редактор."></canvas>
  <header><div class="brand"><span class="mark">B/</span><div>CHICAGO / LOOP<small>ЛОКАЛЬНАЯ ЛОКАЦИЯ · МАСШТАБ 1:1</small></div></div><button id="mode">Редактор <kbd>Tab</kbd></button></header>
  <div id="intro"><span class="eyebrow">ПЕСОЧНИЦА / ОФЛАЙН</span><h1>Chicago Loop<br>от улицы до силуэта.</h1><p>Река, мосты и архитектура центра Чикаго.</p></div>
  <aside id="editor" hidden aria-label="Редактор карты">
    <div class="panel-heading"><span class="eyebrow">МАСТЕРСКАЯ</span><h2>Редактор локации</h2></div>
    <label for="day-time">Время суток <output id="day-time-label" for="day-time">14:00</output></label>
    <input id="day-time" type="range" min="0" max="23.95" step="0.05" value="14" aria-label="Время суток">
    <details id="performance-panel"><summary>Производительность · тесты</summary>
      <p class="muted">Флажки действуют и в игре. Сохраняются в этом браузере. Выключенный LOD фиксирует текущую детализацию.</p>
      ${PERFORMANCE_OPTIONS.map(([key, label]) => `<label class="check"><input id="perf-${key}" type="checkbox" checked> ${label}</label>`).join('')}
      <button id="perf-reset" type="button">Включить всё</button>
    </details>
    <p id="camera-coordinates" class="muted"></p>
    <p class="muted">Клик по объекту — выбор. ПКМ + WASD — полёт. Q / E — вниз / вверх.</p>
    <div class="tools"><button data-tool="position" class="active">Перенос</button><button data-tool="rotation">Поворот</button><button data-tool="scale">Размер</button></div>
    <label class="check"><input id="snap" type="checkbox" checked> Привязка · перенос 1 м / размер 0,25 м / 15°</label>
    <label>Шаблон<select id="template"></select></label>
    <details><summary>Свойства шаблона</summary>
      <label>Название<input id="template-name" maxlength="80"></label>
      <label>Категория<select id="template-kind"><option value="building">Здание</option><option value="ground">Земля</option><option value="obstacle">Препятствие</option></select></label>
      <label>Размеры X / Y / Z, м</label><div class="tools"><input id="template-x" type="number" min="0.25" max="768" step="0.25" aria-label="Ширина шаблона"><input id="template-y" type="number" min="0.25" max="768" step="0.25" aria-label="Высота шаблона"><input id="template-z" type="number" min="0.25" max="768" step="0.25" aria-label="Глубина шаблона"></div>
      <label>Архитектура<select id="template-profile"></select></label>
      <label>Дистанции LOD, м<input id="template-lod" placeholder="180, 650" aria-label="Дистанции переключения LOD"></label>
      <p class="muted">0–2 расстояния по возрастанию: 1–3 уровня. LOD 0 — самый подробный.</p>
      <label>Цвет<input id="template-color" type="color"></label>
      <button id="save-template">Применить ко всем связанным объектам</button>
      <button id="delete-template" class="danger quiet">Удалить неиспользуемый шаблон</button>
      <p class="muted">Индивидуальные размеры и цвет сохраняются. Позиции объектов не меняются.</p>
    </details>
    <div class="tools"><button id="add">+ Добавить</button><button id="duplicate">Копия</button><button id="delete" class="danger">Удалить</button></div>
    <label>LOD выбранного объекта<select id="lod-preview"><option value="-1">Автоматически</option><option value="0">LOD 0 · ближний</option><option value="1">LOD 1 · средний</option><option value="2">LOD 2 · дальний</option></select></label>
    <div class="tools"><button id="city-overview">Обзор города</button><button id="focus-object">К объекту</button></div>
    <p class="muted"><a href="/maps/chicago.svg" target="_blank">Карта и масштаб ↗</a> · уличный слой генерируется отдельно.</p>
    <div id="selection">Выберите объект в сцене</div>
    <div class="tools"><button id="assign-template">Назначить шаблон</button><button id="reset-overrides">Сбросить изменения</button></div>
    <button id="template-from-object">Новый шаблон из выбранного объекта</button>
    <div class="tools"><button id="save">Сохранить</button><button id="export">Экспорт JSON</button></div>
    <label class="file-button">Импорт JSON<input id="import" type="file" accept=".json,application/json"></label>
    <button id="spawn">Точка старта ← позиция игрока</button>
    <p class="muted">Сохранение — в этом браузере. Экспортируйте JSON для резервной копии и Git.</p>
    <button id="reset" class="danger quiet">Восстановить Chicago Loop</button>
  </aside>
  <div id="notice" role="status" aria-live="polite">Загрузка персонажа…</div>
  <footer><div id="help"><span><kbd>W A S D</kbd> движение</span><span><kbd>Shift</kbd> бег</span><span><kbd>W</kbd> повтор с Shift · галоп</span><span><kbd>Space ×2</kbd> полёт</span><span><kbd>Space / C</kbd> вверх / вниз · C ×2 — выйти из полёта</span><span>ЛКМ · камера / ПКМ · направление</span><span><kbd>R</kbd> на старт</span></div><div id="stats">—</div></footer><a id="attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a>`;
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function notify(message: string) { $('notice').textContent = message; }

export function bindTimeControls(lighting: DayNight) {
  const timeStorageKey = 'block-district-time-of-day-v1';
  try {
    const saved = localStorage.getItem(timeStorageKey);
    if (saved !== null && Number.isFinite(Number(saved)) && Number(saved) >= 0 && Number(saved) < 24) lighting.setTime(Number(saved));
  } catch { /* Time controls remain available without storage. */ }
  function describeTime() {
    const minutes = Math.round(lighting.hour * 60) % 1440;
    $('day-time-label').textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  $<HTMLInputElement>('day-time').value = String(lighting.hour);
  describeTime();
  $('day-time').oninput = () => { lighting.setTime(Number($<HTMLInputElement>('day-time').value)); describeTime(); };
  $('day-time').onchange = () => { try { localStorage.setItem(timeStorageKey, String(lighting.hour)); } catch { /* Storage is optional. */ } };
}
