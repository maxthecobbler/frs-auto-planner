// Records the driver's own run (pose + mechanism buttons) so it can be turned into a routine.
// Read-only: it never drives, so the real controller/keyboard reach the game untouched.
import { recordingToRoutine, type RecSample } from '../shared/recording';
import { buttonIds, type ButtonId, type Routine } from '../shared/routine';
import { AutoWatch, GAME, readMode, readPose } from './game';
import { realPads } from './pad';
import { store } from './storage';

export type RecState = 'idle' | 'armed' | 'recording';

/**
 * FRS's default keyboard bindings for this game (Settings → Keyboard), by KeyboardEvent.code.
 * If you rebind keys in FRS, record with a controller or update the game's `keys` in
 * shared/field.ts; controller buttons follow the pad numbers in Setup & calibration.
 */
export const KEY_BINDINGS: Record<string, ButtonId> = Object.fromEntries(
  buttonIds(GAME).flatMap((b) => GAME.buttons[b].keys.map((code) => [code, b] as const)),
);

const LAST_KEY = 'frsAuto:lastRecording:' + GAME.id;
const MAX_SECONDS = 180;

export class Recorder {
  state: RecState = 'idle';
  message = '';
  samples: RecSample[] = [];
  /** the routine made from the last finished recording */
  result: Routine | null = null;
  private gated = false;
  private startAt = 0;
  private raf = 0;
  private watch = new AutoWatch();
  private keys = new Set<string>();
  onChange: () => void = () => {};

  private down = (e: KeyboardEvent) => {
    if (!(e.target as HTMLElement | null)?.closest?.('#frs-auto-hud')) this.keys.add(e.code);
  };
  private up = (e: KeyboardEvent) => this.keys.delete(e.code);
  private blur = () => this.keys.clear();

  constructor() {
    window.addEventListener('keydown', this.down, { capture: true, passive: true });
    window.addEventListener('keyup', this.up, { capture: true, passive: true });
    window.addEventListener('blur', this.blur);
    try {
      const saved = localStorage.getItem(LAST_KEY);
      if (saved) this.result = JSON.parse(saved) as Routine;
    } catch {
      /* ignore */
    }
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private set(state: RecState, message: string) {
    this.state = state;
    this.message = message;
    this.onChange();
  }

  private guard(): string | null {
    const mode = readMode();
    if (!mode.allowed) return mode.reason;
    if (!readPose(store.settings().front)) return 'Start a match first, then record.';
    return null;
  }

  /** Start recording when the next Auto begins; stop when it ends. */
  armForAuto() {
    const err = this.guard();
    if (err) return this.set('idle', err);
    this.watch.reset();
    this.gated = true;
    this.set('armed', 'Recording starts when Auto begins (press R to restart the match). Drive your auto!');
  }

  /** Start recording right now (stop it with Stop). */
  startNow() {
    const err = this.guard();
    if (err) return this.set('idle', err);
    this.gated = false;
    this.begin();
  }

  private begin() {
    this.samples = [];
    this.startAt = performance.now();
    this.set('recording', 'Recording…');
  }

  stop() {
    if (this.state === 'recording') this.finish();
    else this.set('idle', this.state === 'armed' ? 'Recording cancelled.' : this.message);
  }

  saveResult() {
    try {
      if (this.result) localStorage.setItem(LAST_KEY, JSON.stringify(this.result));
    } catch {
      /* The recording can still be exported if storage is unavailable. */
    }
  }

  private finish() {
    const dur = this.samples.length ? this.samples[this.samples.length - 1].t : 0;
    if (this.samples.length < 10 || dur < 0.5) {
      this.set('idle', 'Recording was too short.');
      return;
    }
    try {
      this.result = recordingToRoutine(this.samples, { game: GAME.id });
      this.saveResult();
      const r = this.result;
      this.set('idle', `Recorded ${dur.toFixed(1)} s · ${r.waypoints.length} waypoints · ${r.actions.length} actions.`);
    } catch (e) {
      this.set('idle', "Couldn't convert the recording: " + (e as Error).message);
    }
  }

  /** Mechanism buttons the driver is holding right now (keyboard + real controller). */
  private held(): ButtonId[] {
    const on = new Set<ButtonId>();
    for (const code of this.keys) {
      const b = KEY_BINDINGS[code];
      if (b) on.add(b);
    }
    const map = store.settings().buttonMap;
    for (const pad of realPads()) {
      for (const b of buttonIds(GAME)) {
        const btn = pad.buttons[map[b]];
        if (btn && (btn.pressed || btn.value > 0.5)) on.add(b);
      }
    }
    return [...on];
  }

  private loop() {
    this.raf = requestAnimationFrame(this.loop);
    try {
      this.tick();
    } catch (e) {
      this.set('idle', 'Recorder error: ' + (e as Error).message);
    }
  }

  private tick() {
    const { started, ended } = this.watch.update();
    if (this.state === 'armed') {
      if (started) this.begin();
      return;
    }
    if (this.state !== 'recording') return;
    if (this.gated && started) return this.begin(); // match restarted: start over
    if (this.gated && ended) return this.finish();

    const pose = readPose(store.settings().front);
    if (!pose) return;
    const t = (performance.now() - this.startAt) / 1000;
    const last = this.samples[this.samples.length - 1];
    if (last && Math.hypot(pose.x - last.x, pose.y - last.y) > 1) {
      // teleport = match reset: start the recording over from here
      this.begin();
      return;
    }
    this.samples.push({ t, x: pose.x, y: pose.y, heading: pose.heading, buttons: this.held() });
    if (t > MAX_SECONDS) this.finish();
  }

  /** Short summary of what's held right now, for the status line. */
  liveSummary(): string {
    const last = this.samples[this.samples.length - 1];
    if (!last) return '';
    const names = last.buttons.join(', ');
    return `${last.t.toFixed(1)} s${names ? ' · ' + names : ''}`;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.down, { capture: true });
    window.removeEventListener('keyup', this.up, { capture: true });
    window.removeEventListener('blur', this.blur);
  }
}
