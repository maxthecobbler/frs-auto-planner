import { plannerRobot } from '../shared/robots';
import { drawField, drawPathLine, drawRobot, fitView, toCanvas } from '../shared/draw';
import { buttonIds, gameOf, mirrorRoutine, parseRoutine, type Routine } from '../shared/routine';
import { samplePath } from '../shared/path';
import { allianceOfX } from '../shared/field';
import type { Runner } from './runner';
import type { Recorder } from './recorder';
import { store } from './storage';
import { syncFromPlanner } from './sync';
import { GAME, readDriverDisplay, readMode, readPhase, robotInfo } from './game';

// Fall theme to match FRS's Thanksgiving look: warm browns, cream text, gold accents.
const CSS = `
:host { all: initial; }
.box { position: fixed; top: 64px; left: 12px; z-index: 2147483647; width: 300px; background: rgba(15,17,23,0.94);
  display: flex; flex-direction: column; box-sizing: border-box; max-width: 100vw; max-height: 100vh;
  color: #e5e7eb; font: 12px/1.4 system-ui, -apple-system, sans-serif; border: 1px solid #334155; border-radius: 10px;
  box-shadow: 0 8px 30px rgba(0,0,0,0.5); user-select: none; }
.hd { touch-action: none; flex: none; display: flex; align-items: center; gap: 6px; padding: 8px 10px; cursor: move; border-bottom: 1px solid #1f2937; }
.hd b { font-size: 13px; letter-spacing: .3px; color: #facc15; }
.hd .sp { flex: 1; }
.ic { background: none; border: 0; color: #94a3b8; cursor: pointer; font-size: 14px; padding: 0 4px; }
.ic:hover { color: #fff; }
.bd { padding: 8px 10px 10px; display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; flex: 1 1 auto; gap: 8px; overflow-y: auto; min-height: 0; overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: #475569 transparent; }
.st { padding: 6px 8px; border-radius: 6px; background: #111827; border: 1px solid #1f2937; min-height: 18px; }
.st.running { border-color: #22c55e; } .st.recording { border-color: #ef4444; } .st.rec-armed { border-color: #f87171; } .st.armed { border-color: #facc15; } .st.calibrating { border-color: #06b6d4; }
:host { all: initial;
  --bg: rgba(27,19,14,0.96); --card: #231912; --card-2: #2b1f16; --line: #3b2c20; --line-2: #4a3727;
  --text: #f5ede3; --muted: #b8a796; --gold: #f2b950; --gold-2: #f7c96b; --gold-ink: #2a1a0a;
  --ember: #e0692b; --leaf: #c2581f; --danger: #8f2a1c; --danger-line: #b23a24; }
.box { position: fixed; top: 64px; left: 12px; z-index: 2147483647; width: 300px; background: var(--bg);
  display: flex; flex-direction: column; max-height: calc(100vh - 76px);
  color: var(--text); font: 12px/1.4 system-ui, -apple-system, sans-serif; border: 1px solid var(--line-2); border-radius: 12px;
  box-shadow: 0 10px 34px rgba(0,0,0,0.55), inset 0 1px 0 rgba(242,185,80,0.06); user-select: none; overflow: hidden; }
.hd { position: relative; flex: none; display: flex; align-items: center; gap: 6px; padding: 9px 10px 9px 30px; cursor: move;
  border-bottom: 1px solid var(--line); background: linear-gradient(180deg, rgba(242,185,80,0.07), transparent); }
.hd .leaf { position: absolute; left: 8px; top: 50%; width: 16px; height: 16px; margin-top: -8px; color: var(--leaf); transform: rotate(-18deg); }
.hd b { font-size: 13px; letter-spacing: .4px; color: var(--gold); }
.hd .sp { flex: 1; }
.ic { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 14px; padding: 0 4px; }
.ic:hover { color: var(--gold-2); }
.bd { padding: 9px 10px 11px; display: grid; gap: 8px; overflow-y: auto; min-height: 0; overscroll-behavior: contain;
  scrollbar-width: thin; scrollbar-color: var(--line-2) transparent; }
.st { padding: 7px 9px; border-radius: 8px; background: var(--card); border: 1px solid var(--line); min-height: 18px; }
.st.running { border-color: #6fbf73; } .st.recording { border-color: var(--ember); } .st.rec-armed { border-color: #e8955e; }
.st.armed { border-color: var(--gold); box-shadow: 0 0 0 1px rgba(242,185,80,0.25); } .st.calibrating { border-color: #d9a441; }
.row { display: flex; gap: 6px; align-items: center; }
select, input, textarea { background: #1a120d; color: var(--text); border: 1px solid var(--line-2); border-radius: 7px; padding: 4px 6px; font: inherit; }
select:focus, input:focus, textarea:focus { outline: none; border-color: var(--gold); }
select { flex: 1; min-width: 0; }
textarea { width: 100%; box-sizing: border-box; height: 70px; resize: vertical; font-family: ui-monospace, monospace; font-size: 11px; }
input[type='checkbox'] { accent-color: var(--gold); }
button.b { flex: 1; background: var(--card-2); color: var(--text); border: 1px solid var(--line-2); border-radius: 8px; padding: 7px 4px; cursor: pointer;
  font: 700 12px system-ui, sans-serif; letter-spacing: .2px; }
button.b:hover { background: #33251a; border-color: #5a4330; }
button.go { background: var(--gold); color: var(--gold-ink); border-color: var(--gold); flex: 1.45; white-space: nowrap; }
button.go:hover { background: var(--gold-2); border-color: var(--gold-2); }
button.stop { background: var(--danger); border-color: var(--danger-line); color: #fde6dc; }
button.stop:hover { background: #a3321f; }
button.rec { background: #3a1d12; border-color: #7a3a1d; color: #ffd8c2; }
button.rec:hover { background: #4a2516; }
button.sync { flex: none; padding: 5px 8px; }
.recres { padding: 7px 9px; border-radius: 8px; background: var(--card); border: 1px solid var(--line); display: grid; gap: 6px; }
canvas { width: 100%; border-radius: 8px; display: block; border: 1px solid var(--line); box-sizing: border-box; }
details summary { cursor: pointer; color: var(--muted); }
details summary:hover { color: var(--gold-2); }
details[open] summary { color: var(--gold); }
details .grid { display: grid; grid-template-columns: 1fr 70px; gap: 4px 8px; margin-top: 6px; align-items: center; }
details input { width: 100%; box-sizing: border-box; }
.muted { color: #94a3b8; font-size: 11px; }
[data-resize] { align-self: flex-end; flex: none; width: 20px; height: 14px; border: 0; padding: 0;
  background: transparent; color: #94a3b8; cursor: nwse-resize; touch-action: none; line-height: 12px; }
.min .bd, .min [data-resize] { display: none; }
.box.min { height: auto !important; }
.hopper-area { position: fixed; inset: 8px; z-index: 2147483647; pointer-events: none; }
[data-hopper] { position: absolute; width: max-content; max-width: 100%; box-sizing: border-box;
  padding: .2em .55em; border-radius: .35em; background: rgba(15,17,23,.94); color: #facc15;
  font: 700 24px/1.25 system-ui, sans-serif; font-variant-numeric: tabular-nums;
  touch-action: none; user-select: none; pointer-events: auto; cursor: grab; }
[data-hopper]:active { cursor: grabbing; }
.muted { color: var(--muted); font-size: 11px; }
.min .bd { display: none; }
`;

// maple leaf, like the one by FRS's logo
const LEAF = `<svg class="leaf" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 1.5l1.9 4.1 2.4-1.2-.6 4.4 3.6-2.5.3 2.3 3.1-.6-1.7 3.6 1.9 1-4.9 4 .7 2-5-1-.3 4.9h-1.6l-.3-4.9-5 1 .7-2-4.9-4 1.9-1L1.3 8l3.1.6.3-2.3 3.6 2.5-.6-4.4 2.4 1.2z"/></svg>`;

export function mountHud(runner: Runner, recorder: Recorder) {
  document.getElementById('frs-auto-hud')?.remove();
  const host = document.createElement('div');
  host.id = 'frs-auto-hud';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>
  <div class="box">
    <div class="hd">${LEAF}<b>FRS AUTO</b><span class="muted">${GAME.name}</span><span class="muted" data-phase></span><span class="sp"></span>
      <button class="ic" data-min title="Minimize">–</button><button class="ic" data-close title="Close">×</button></div>
    <div class="bd">
      <div class="st" data-status></div>
      <div class="muted" data-mode></div>
      <div data-driver hidden><strong data-robot></strong><div class="muted" data-team></div></div>
      <div class="row"><select data-routines></select><button class="ic" data-rename>Rename</button><button class="ic" data-del title="Delete routine">🗑</button></div>
      <div class="row"><select data-routines></select><button class="b sync" data-sync title="Get your latest autos from the planner website">↻ Sync</button><button class="ic" data-del title="Delete routine">🗑</button></div>
      <canvas data-map width="560" height="280"></canvas>
      <div class="row">
        <button class="b go" data-arm title="Start automatically when Auto begins">Arm for Auto</button>
        <button class="b" data-run title="Run right now (practice, any phase)">Run now</button>
        <button class="b stop" data-stop>Stop</button>
      </div>
      <details><summary>Hopper display</summary>
        <div class="grid"><label for="hopper-size">Text size</label><input id="hopper-size" type="range" min="12" max="72"></div>
        <div class="row"><button class="b" data-hopper-center>Move to top center</button></div>
        <div class="muted">Drag the hopper count to place it anywhere.</div>
      </details>
      <details data-rec><summary>Record a drive</summary>
        <div class="muted" style="margin-top:6px">Drive the auto yourself. Your path, stops, and button presses (intake, shoot, climb, …) become a routine you can import into the planner.</div>
        <div class="row" style="margin-top:6px">
          <button class="b rec" data-rec-auto title="Starts when Auto begins, stops when Auto ends">⏺ Record next Auto</button>
          <button class="b rec" data-rec-now title="Start recording right now">⏺ Now</button>
          <button class="b stop" data-rec-stop>⏹ Stop</button>
        </div>
        <div class="recres" data-rec-result style="margin-top:6px; display:none">
          <div data-rec-summary></div>
          <button class="b" data-rec-rename>Rename recording</button>
          <div class="row">
            <button class="b" data-rec-download>Download .json</button>
            <button class="b" data-rec-copy>Copy JSON</button>
          </div>
          <div class="row"><button class="b" data-rec-add>Add to my autos</button></div>
        </div>
      </details>
      <details data-load><summary>Load routine</summary>
        <div style="margin-top:6px"><textarea data-json placeholder="Paste a routine from the FRS Auto planner (Copy routine)…"></textarea></div>
        <div class="row" style="margin-top:6px"><button class="b" data-paste>Load</button></div>
      </details>
      <details><summary>Setup &amp; calibration</summary>
        <label class="row"><input style="width:auto" type="checkbox" data-auto-cal>Use current robot’s drive calibration</label>
        <div class="muted" data-cal-source></div>
        <div class="row" style="margin-top:6px"><button class="b go" data-calibrate>Calibrate (needs ~4 m clear ahead)</button></div>
        <div class="muted" style="margin-top:4px">Drive into open space first, like the middle of the neutral zone.</div>
        <div class="grid">
          <span>Top speed (m/s)</span><input data-cal="maxVel" type="number" step="0.1">
          <span>Turn rate (rad/s)</span><input data-cal="maxOmega" type="number" step="0.1">
          <span>Stick deadzone</span><input data-cal="deadzone" type="number" step="0.01">
          <span>Position gain</span><input data-gain="kP" type="number" step="0.1">
          <span>Heading gain</span><input data-gain="kTheta" type="number" step="0.1">
          <span>Robot front axis</span><select data-front>${(GAME.id === 'rebuilt' ? ['-x', '+x', '-z', '+z'] : ['front', 'back', 'left', 'right']).map((o) => `<option>${o}</option>`).join('')}</select>
          <span>Re-arm after each auto</span><input data-rearm type="checkbox">
          ${buttonIds(GAME).map((b) => `<span>${GAME.buttons[b].label} (pad #)</span><input data-btn="${b}" type="number" min="0" max="16">`).join('')}
        </div>
        <div class="muted" style="margin-top:6px">Esc, any key, or a real controller hands control back to you instantly.</div>
      </details>
    </div>
    <button data-resize title="Resize window (drag or use arrow keys)" aria-label="Resize window">◢</button>
  </div>
  <div class="hopper-area"><div data-hopper hidden title="Drag to move hopper count"></div></div>`;
  document.body.appendChild(host);

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T;
  const box = $<HTMLDivElement>('.box');
  const status = $<HTMLDivElement>('[data-status]');
  const phaseEl = $<HTMLSpanElement>('[data-phase]');
  const modeEl = $<HTMLDivElement>('[data-mode]');
  const driverEl = $<HTMLDivElement>('[data-driver]');
  const robotEl = $('[data-robot]');
  const teamEl = $('[data-team]');
  const hopperEl = $<HTMLDivElement>('[data-hopper]');
  const hopperArea = $<HTMLDivElement>('.hopper-area');
  const size = $<HTMLInputElement>('#hopper-size');
  const layout = { ...store.settings().hopperLayout };
  const applyLayout = () => {
    const x = layout.x * 100 + '%';
    const y = layout.y * 100 + '%';
    hopperEl.style.left = x;
    hopperEl.style.top = y;
    hopperEl.style.transform = `translate(-${x}, -${y})`;
    hopperEl.style.fontSize = layout.fontSize + 'px';
  };
  const saveLayout = () => store.setSettings({ hopperLayout: { ...layout } });
  size.value = String(layout.fontSize);
  size.addEventListener('input', () => {
    layout.fontSize = size.valueAsNumber;
    applyLayout();
  });
  size.addEventListener('change', saveLayout);
  $('[data-hopper-center]').addEventListener('click', () => {
    layout.x = 0.5;
    layout.y = 0;
    applyLayout();
    saveLayout();
  });
  applyLayout();

  let drag: { id: number; dx: number; dy: number } | null = null;
  hopperEl.addEventListener('pointerdown', (e) => {
    if (drag || e.button !== 0) return;
    e.preventDefault();
    const rect = hopperEl.getBoundingClientRect();
    drag = { id: e.pointerId, dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    hopperEl.setPointerCapture(e.pointerId);
  });
  hopperEl.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const area = hopperArea.getBoundingClientRect();
    const rect = hopperEl.getBoundingClientRect();
    // Store fractions of the available travel so the badge stays visible after resizing.
    const fraction = (offset: number, travel: number) => Math.max(0, Math.min(1, offset / Math.max(1, travel)));
    layout.x = fraction(e.clientX - area.left - drag.dx, area.width - rect.width);
    layout.y = fraction(e.clientY - area.top - drag.dy, area.height - rect.height);
    applyLayout();
  });
  hopperEl.addEventListener('lostpointercapture', () => {
    drag = null;
    saveLayout();
  });
  const recResult = $<HTMLDivElement>('[data-rec-result]');
  const recSummary = $<HTMLDivElement>('[data-rec-summary]');
  // whichever of runner / recorder acted last owns the status line
  let owner: 'runner' | 'recorder' = 'runner';
  const sel = $<HTMLSelectElement>('[data-routines]');
  const map = $<HTMLCanvasElement>('[data-map]');
  const ctx = map.getContext('2d')!;

  // keep keystrokes in the HUD from driving the robot / triggering game shortcuts
  // (only while typing in a field; after clicking a button, blur it so R etc. reach the game)
  for (const type of ['keydown', 'keyup', 'keypress'])
    root.addEventListener(type, (e) => {
      const t = e.target as HTMLElement;
      if (t.matches('input, textarea, select')) e.stopPropagation();
    });
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.matches('button')) t.blur();
  });

  const savedSize = store.settings().panelSize;
  if (savedSize) {
    box.style.width = savedSize.width + 'px';
    box.style.height = savedSize.height + 'px';
  }
  function place(left: number, top: number) {
    const rect = box.getBoundingClientRect();
    box.style.left = Math.max(0, Math.min(left, window.innerWidth - rect.width)) + 'px';
    box.style.top = Math.max(0, Math.min(top, window.innerHeight - rect.height)) + 'px';
  }
  const fitWindow = () => {
    const rect = box.getBoundingClientRect();
    place(rect.left, rect.top);
  };
  const panelBounds = new ResizeObserver(() => { if (box.offsetWidth) fitWindow(); });
  panelBounds.observe(box);
  window.addEventListener('resize', fitWindow);

  const hd = $<HTMLDivElement>('.hd');
  const grip = $<HTMLButtonElement>('[data-resize]');
  function resizePanel(width: number, height: number) {
    const { left, top } = box.getBoundingClientRect();
    box.style.width = Math.min(window.innerWidth - left, Math.max(240, width)) + 'px';
    box.style.height = Math.min(window.innerHeight - top, Math.max(100, height)) + 'px';
  }
  function saveSize() {
    const { width, height } = box.getBoundingClientRect();
    store.setSettings({ panelSize: { width, height } });
  }
  const dragControls: HTMLElement[] = [hd, grip];
  for (const control of dragControls) {
    control.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary || (control === hd && (event.target as HTMLElement).closest('button'))) return;
      const start = box.getBoundingClientRect();
      control.setPointerCapture(event.pointerId);
      const move = (ev: PointerEvent) => {
        if (ev.pointerId !== event.pointerId) return;
        const dx = ev.clientX - event.clientX;
        const dy = ev.clientY - event.clientY;
        if (control === grip) resizePanel(start.width + dx, start.height + dy);
        else place(start.left + dx, start.top + dy);
      };
      const end = (ev: PointerEvent) => {
        if (ev.pointerId !== event.pointerId) return;
        control.removeEventListener('pointermove', move);
        control.removeEventListener('lostpointercapture', end);
        if (control === grip && box.style.height) saveSize();
      };
      control.addEventListener('pointermove', move);
      control.addEventListener('lostpointercapture', end);
    });
  }
  grip.addEventListener('keydown', (ev) => {
    const steps: Record<string, [number, number]> = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] };
    const step = steps[ev.key];
    if (!step) return;
    ev.preventDefault();
    ev.stopPropagation();
    resizePanel(box.offsetWidth + step[0], box.offsetHeight + step[1]);
    saveSize();
  });

  root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  $('[data-min]').addEventListener('click', () => { box.classList.toggle('min'); fitWindow(); });
  $('[data-close]').addEventListener('click', () => {
    runner.stop('Closed.');
    host.style.display = 'none';
  });

  const refreshRoutines = () => {
    const cur = store.selected();
    sel.innerHTML = store.routines().length
      ? store.routines().map((r) => `<option value="${r.id}" ${cur?.id === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')
      : '<option>(no autos yet: click ↻ Sync)</option>';
    cachedPath = null;
  };
  const rename = (routine: Routine | null) => {
    if (!routine) return;
    const name = window.prompt('Auto name', routine.name)?.trim();
    if (!name || name === routine.name) return;
    const updatedAt = Date.now();
    store.rename(routine.id, name, updatedAt);
    if (recorder.result?.id === routine.id) {
      recorder.result = { ...recorder.result, name, updatedAt };
      recorder.saveResult();
      recorder.message = `Renamed recording to "${name}".`;
      recorder.onChange();
    }
    refreshRoutines();
  };
  $('[data-rename]').addEventListener('click', () => rename(store.selected()));
  $('[data-rec-rename]').addEventListener('click', () => rename(recorder.result));
  sel.addEventListener('change', () => {
    store.select(sel.value);
    cachedPath = null;
  });
  $('[data-sync]').addEventListener('click', () => {
    const setMsg = (m: string) => {
      runner.t.message = m;
      runner.onChange();
    };
    setMsg('Syncing with the planner…');
    syncFromPlanner((list) => store.upsertMany(list))
      .then((n) => {
        refreshRoutines();
        setMsg(n ? `Synced ${n} ${GAME.name} auto${n === 1 ? '' : 's'} from the planner.` : `Synced, but the planner has no ${GAME.name} autos yet.`);
      })
      .catch((e: Error) => setMsg(e.message));
  });
  $('[data-del]').addEventListener('click', () => {
    const r = store.selected();
    if (r) {
      store.remove(r.id);
      refreshRoutines();
    }
  });

  const quietRecorder = () => {
    if (recorder.state !== 'idle') recorder.stop();
  };
  const quietRunner = () => {
    if (runner.t.state !== 'idle') runner.stop('Stopped (recording instead).');
  };
  $('[data-arm]').addEventListener('click', () => (quietRecorder(), runner.arm()));
  $('[data-run]').addEventListener('click', () => (quietRecorder(), runner.runNow()));
  $('[data-rec-auto]').addEventListener('click', () => (quietRunner(), recorder.armForAuto()));
  $('[data-rec-now]').addEventListener('click', () => (quietRunner(), recorder.startNow()));
  $('[data-rec-stop]').addEventListener('click', () => recorder.stop());
  const recFileName = (r: Routine) => (r.name.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'recorded-auto') + '.json';
  $('[data-rec-download]').addEventListener('click', () => {
    const r = recorder.result;
    if (!r) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    a.download = recFileName(r);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('[data-rec-copy]').addEventListener('click', async () => {
    const r = recorder.result;
    if (!r) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(r));
      recorder.message = 'Copied. In the planner: Import → paste.';
    } catch {
      recorder.message = "Couldn't copy here. Use Download .json instead.";
    }
    recorder.onChange();
  });
  $('[data-rec-add]').addEventListener('click', () => {
    const r = recorder.result;
    if (!r) return;
    store.upsert(r);
    refreshRoutines();
    recorder.message = `Added "${r.name}" to your autos. Arm it to replay.`;
    recorder.onChange();
  });
  $('[data-stop]').addEventListener('click', () => (quietRecorder(), runner.stop()));
  $('[data-calibrate]').addEventListener('click', () => void runner.calibrate());
  $('[data-paste]').addEventListener('click', () => {
    const ta = $<HTMLTextAreaElement>('[data-json]');
    try {
      loadRoutines(ta.value);
      ta.value = '';
      refreshRoutines();
      runner.t.message = 'Routine loaded.';
      ($('[data-load]') as HTMLDetailsElement).open = false;
    } catch (e) {
      runner.t.message = 'Could not load: ' + (e as Error).message;
    }
    render();
  });

  // settings inputs
  const s0 = store.settings();
  const autoCal = $<HTMLInputElement>('[data-auto-cal]');
  const calSource = $('[data-cal-source]');
  const measureButton = $<HTMLButtonElement>('[data-calibrate]');
  autoCal.checked = s0.autoCalibrate;
  autoCal.addEventListener('change', () => {
    if (runner.t.state === 'calibrating') runner.stop();
    store.setSettings({ autoCalibrate: autoCal.checked });
    render();
  });
  const calInputs = root.querySelectorAll<HTMLInputElement>('[data-cal]');
  calInputs.forEach((inp) => {
    const k = inp.dataset.cal as keyof typeof s0.cal;
    inp.value = String(s0.cal[k]);
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (Number.isFinite(v) && v > 0) store.setSettings({ cal: { ...store.settings().cal, [k]: v } });
    });
  });
  root.querySelectorAll<HTMLInputElement>('[data-gain]').forEach((inp) => {
    const k = inp.dataset.gain as 'kP' | 'kTheta';
    inp.value = String(s0[k]);
    inp.addEventListener('change', () => {
      const v = parseFloat(inp.value);
      if (Number.isFinite(v) && v >= 0) store.setSettings({ [k]: v });
    });
  });
  root.querySelectorAll<HTMLInputElement>('[data-btn]').forEach((inp) => {
    const k = inp.dataset.btn as keyof typeof s0.buttonMap;
    inp.value = String(s0.buttonMap[k]);
    inp.addEventListener('change', () => {
      const v = parseInt(inp.value, 10);
      if (v >= 0 && v <= 16) store.setSettings({ buttonMap: { ...store.settings().buttonMap, [k]: v } });
    });
  });
  const front = $<HTMLSelectElement>('[data-front]');
  front.value = s0.front;
  front.addEventListener('change', () => store.setSettings({ front: front.value as never }));
  const rearm = $<HTMLInputElement>('[data-rearm]');
  rearm.checked = s0.autoRearm;
  rearm.addEventListener('change', () => store.setSettings({ autoRearm: rearm.checked }));

  // minimap
  let cachedPath: { id: string; alliance: string; path: ReturnType<typeof samplePath> } | null = null;
  const view = fitView(map.width, map.height, 8, GAME);
  function render() {
    const t = runner.t;
    if (owner === 'recorder') {
      status.textContent = recorder.message + (recorder.state === 'recording' ? '  ·  ' + recorder.liveSummary() : '');
      status.className = 'st ' + (recorder.state === 'recording' ? 'recording' : recorder.state === 'armed' ? 'rec-armed' : '');
    } else {
      status.textContent = t.message + (t.state === 'running' ? `  ·  ${t.elapsed.toFixed(1)} s` : '');
      status.className = 'st ' + t.state;
    }
    const res = recorder.result;
    recResult.style.display = res && recorder.state === 'idle' ? '' : 'none';
    if (res) recSummary.textContent = `${res.name} · ${res.waypoints.length} waypoints · ${res.actions.length} actions`;
    const ph = readPhase();
    phaseEl.textContent = ph ? '· ' + ph : '';
    driverEl.hidden = true;
    let rates: { maxVel: number; maxOmega: number } | null = null;
    if (ph) {
      const mode = readMode();
      const label = { singleplayer: 'Singleplayer', multiplayer: 'Multiplayer', ranked: 'Ranked', spectating: 'Spectating', event: 'Event', unknown: 'Unknown mode' }[mode.kind];
      modeEl.textContent = mode.allowed
        ? `${label}${mode.alliance ? ' · ' + mode.alliance : ''}`
        : `${label}: ${mode.reason}`;
      if (mode.kind === 'singleplayer' || mode.kind === 'multiplayer') {
        const { profile, team, balls, driveRates } = readDriverDisplay(mode.kind);
        if (autoCal.checked) rates = driveRates;
        robotEl.textContent = profile?.robotName ?? (team == null ? 'Looking for your robot…' : 'Your robot');
        teamEl.textContent = [team != null && `Team ${team}`, profile?.name, profile?.region].filter(Boolean).join(' · ');
        hopperEl.textContent = balls === null ? 'Hopper count unavailable' : `Hopper: ${balls} ${balls === 1 ? 'ball' : 'balls'}`;
        driverEl.hidden = false;
      }
      modeEl.style.color = mode.allowed ? '' : '#fca5a5';
    } else modeEl.textContent = '';

    const plannedRobot = autoCal.checked ? plannerRobot(store.selected()?.robotId) : undefined;
    const liveRates = rates;
    rates ??= plannedRobot ?? null;
    hopperEl.hidden = driverEl.hidden;
    measureButton.disabled = autoCal.checked;
    calSource.textContent = autoCal.checked
      ? (liveRates ? 'Using the current robot’s speed and turn rate.' : plannedRobot ? `Using planner robot ${plannedRobot.label} until live calibration is available.` : 'Using saved settings until the robot profile is available.')
      : 'Using manual calibration.';
    for (const input of calInputs) {
      const key = input.dataset.cal as keyof typeof s0.cal;
      input.disabled = autoCal.checked && key !== 'deadzone';
      if (root.activeElement !== input) {
        const value = rates && key !== 'deadzone' ? rates[key] : store.settings().cal[key];
        input.value = String(+value.toFixed(4));
      }
    }

    drawField(ctx, view, GAME, { bg: '#21170f', edge: '#5a4330' });
    let path = t.state === 'running' && t.schedule ? t.schedule.path : null;
    if (!path) {
      const r = store.selected();
      if (r) {
        const al = t.pose ? allianceOfX(GAME, t.pose.x) : 'blue';
        if (!cachedPath || cachedPath.id !== r.id + r.updatedAt || cachedPath.alliance !== al) {
          const drawnFor = r.waypoints.length ? allianceOfX(GAME, r.waypoints[0].x) : 'blue';
          cachedPath = { id: r.id + r.updatedAt, alliance: al, path: samplePath((drawnFor === al ? r : mirrorRoutine(r)).waypoints) };
        }
        path = cachedPath.path;
      }
    }
    if (path) drawPathLine(ctx, view, path, 'rgba(250,204,21,0.8)', 3);
    if (t.trail.length > 1) {
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2;
      ctx.beginPath();
      t.trail.forEach((p, i) => {
        const { cx, cy } = toCanvas(view, p.x, p.y);
        if (i) ctx.lineTo(cx, cy);
        else ctx.moveTo(cx, cy);
      });
      ctx.stroke();
    }
    if (recorder.state === 'recording' && recorder.samples.length > 1) {
      ctx.strokeStyle = '#e0692b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      recorder.samples.forEach((p, i) => {
        if (i % 3 && i !== recorder.samples.length - 1) return;
        const { cx, cy } = toCanvas(view, p.x, p.y);
        if (i) ctx.lineTo(cx, cy);
        else ctx.moveTo(cx, cy);
      });
      ctx.stroke();
    }
    if (t.state === 'running' && t.ref) drawRobot(ctx, view, t.ref, { size: GAME.robotSize, stroke: '#facc15', fill: 'rgba(250,204,21,0.1)', alpha: 0.8 });
    if (t.pose) drawRobot(ctx, view, t.pose, { size: GAME.robotSize, stroke: '#22c55e', fill: 'rgba(34,197,94,0.3)' });
  }
  refreshRoutines();
  fitWindow();
  runner.onChange = () => {
    owner = 'runner';
    render();
  };
  recorder.onChange = () => {
    owner = 'recorder';
    render();
  };
  const iv = setInterval(() => {
    try {
      render();
    } catch {
      /* ignore */
    }
  }, 100);
  render();
  return {
    show() {
      host.style.display = '';
      fitWindow();
      refreshRoutines();
    },
    refresh: refreshRoutines,
    destroy() {
      panelBounds.disconnect();
      window.removeEventListener('resize', fitWindow);
      clearInterval(iv);
      host.remove();
    },
  };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Accepts a single routine or an array of routines (JSON text or already-parsed). */
export function loadRoutines(input: string | unknown) {
  const text = typeof input === 'string' ? input.trim() : JSON.stringify(input);
  if (!text) throw new Error('Nothing pasted.');
  const data = JSON.parse(text);
  const list: unknown[] = Array.isArray(data) ? data : [data];
  let last: Routine | null = null;
  let other = 0;
  for (const item of list) {
    const r = parseRoutine(JSON.stringify(item));
    store.upsert(r);
    if (gameOf(r).id === GAME.id) last = r;
    else other++;
  }
  if (last) store.select(last.id);
  else if (other) throw new Error(`That routine is for a different game, not ${GAME.name}.`);
}
