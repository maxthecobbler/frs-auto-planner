import { plannerRobot } from '../shared/robots';
import { allianceOfX, wrapAngle, type Pose } from '../shared/field';
import { mirrorRoutine, type Routine } from '../shared/routine';
import { buildSchedule, buttonsAt, referenceAt, type Schedule } from '../shared/schedule';
import { stickFromVelocity } from '../shared/stick';
import { AutoWatch, GAME, driveFrame, isAutoPhase, readDriverDisplay, readMode, readPose, robotInfo } from './game';
import { isActive, realInputActive, setActive, setButtons, setSticks } from './pad';
import { store } from './storage';

export type RunState = 'idle' | 'armed' | 'running' | 'calibrating';

export interface Telemetry {
  state: RunState;
  message: string;
  schedule: Schedule | null;
  alliance: 'blue' | 'red';
  elapsed: number;
  pose: Pose | null;
  ref: Pose | null;
  trail: { x: number; y: number }[];
}

const END_TOL = 0.08; // m: how close we want to be before moving past a stop/end
const MAX_CATCHUP = 1.0; // s: how long the clock may wait for a lagging robot at a step boundary

export class Runner {
  t: Telemetry = { state: 'idle', message: 'Idle', schedule: null, alliance: 'blue', elapsed: 0, pose: null, ref: null, trail: [] };
  private raf = 0;
  private startAt = 0;
  private clockOffset = 0;
  private stepIdx = 0;
  private waited = 0;
  private lastFrame = 0;
  private gated = false;
  private plannedRobot = plannerRobot();
  private watch = new AutoWatch();
  /** when Auto started while armed; we retry briefly because FRS rebuilds the robot on restart */
  private pendingStart = 0;
  private keyHandler = (e: KeyboardEvent) => {
    if (this.t.state !== 'running' && this.t.state !== 'calibrating') return;
    if ((e.target as HTMLElement | null)?.closest?.('#frs-auto-hud')) return;
    if (e.key === 'r' || e.key === 'R') return; // restarting the match is handled by the phase/clock logic
    this.stop(e.key === 'Escape' ? 'Stopped (Esc).' : `Stopped: driver pressed "${e.key}".`);
  };
  onChange: () => void = () => {};

  constructor() {
    window.addEventListener('keydown', this.keyHandler, true);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  private set(state: RunState, message: string) {
    this.t.state = state;
    this.t.message = message;
    this.onChange();
  }

  /** Refuse anything that is not a one-robot (singleplayer) match. */
  private guard(): string | null {
    const mode = readMode();
    if (!mode.allowed) return mode.reason;
    robotInfo();
    if (!readPose(store.settings().front)) {
      return mode.kind === 'multiplayer' ? "Couldn't find your robot yet. Try again once the match is on screen." : 'Start a Singleplayer or Multiplayer match first.';
    }
    return null;
  }

  arm() {
    const err = this.guard();
    if (err) return this.set('idle', err);
    if (!store.selected()) return this.set('idle', 'No routine loaded. Paste one in "Load routine".');
    this.watch.reset();
    // armed in the first second of auto (e.g. right after pressing R): just go
    if (isAutoPhase(this.watch.phase) && (this.watch.clock ?? 0) >= 19) {
      this.begin(true);
      return;
    }
    this.set('armed', isAutoPhase(this.watch.phase) ? 'Armed. Auto is already running, so this waits for the next one (press R to restart the match).' : 'Armed. Runs when Auto starts (press R to restart the match).');
  }

  /** Run immediately (practice / teleop testing). */
  runNow() {
    this.pendingStart = 0;
    this.begin(false);
  }

  stop(reason = 'Stopped.') {
    this.pendingStart = 0;
    setActive(false);
    this.set('idle', reason);
  }

  /** Start running. With `quiet`, a failed guard returns its message instead of changing state. */
  private begin(gated: boolean, quiet = false): string | null {
    const err = this.guard();
    if (err) {
      if (!quiet) this.set('idle', err);
      return err;
    }
    const routine = store.selected();
    if (!routine) {
      this.set('idle', 'No routine loaded.');
      return null;
    }
    const pose = readPose(store.settings().front)!;
    const alliance = readMode().alliance ?? allianceOfX(GAME, pose.x);
    const drawnFor = routine.waypoints.length ? allianceOfX(GAME, routine.waypoints[0].x) : 'blue';
    const r: Routine = drawnFor === alliance ? routine : mirrorRoutine(routine);
    const schedule = buildSchedule(r);
    if (!schedule.path.samples.length) {
      this.set('idle', 'Routine has no path.');
      return null;
    }
    this.plannedRobot = plannerRobot(routine.robotId);
    this.t.schedule = schedule;
    this.t.alliance = alliance;
    this.t.trail = [];
    this.gated = gated;
    this.startAt = performance.now();
    this.clockOffset = 0;
    this.stepIdx = 0;
    this.waited = 0;
    setActive(true);
    const start = schedule.path.samples[0];
    const off = Math.hypot(start.x - pose.x, start.y - pose.y);
    this.set('running', `Running "${routine.name}" (${alliance})` + (off > 0.5 ? `. The robot started ${off.toFixed(1)} m from the path start` : ''));
    return null;
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    try {
      this.tick(now, dt);
    } catch (e) {
      // never let an exception reach the page (FRS shows it as an error toast)
      setActive(false);
      this.set('idle', 'Error: ' + (e as Error).message);
    }
  }

  private tick(now: number, dt: number) {
    const st = this.t.state;
    const settings = store.settings();
    const { started: autoStarted } = this.watch.update();
    const phase = this.watch.phase;

    if (st === 'armed') {
      if (autoStarted) this.pendingStart = now;
      if (this.pendingStart && now - this.pendingStart > 100) {
        const err = this.begin(true, true);
        if (!err) this.pendingStart = 0;
        else if (now - this.pendingStart > 1500) {
          this.pendingStart = 0;
          this.set('armed', `Auto started but: ${err} Still armed.`);
        }
      }
      this.t.pose = readPose(settings.front);
      return;
    }
    if (st !== 'running') {
      if (isActive() && st === 'idle') setActive(false);
      this.t.pose = readPose(settings.front);
      return;
    }

    // running
    if (this.gated && autoStarted) {
      // match restarted mid-run: start over once the new robot is in place
      setActive(false);
      this.pendingStart = now;
      return this.set('armed', 'Match restarted…');
    }
    if (this.gated && phase !== null && !isAutoPhase(phase)) {
      setActive(false);
      if (settings.autoRearm) {
        return this.set('armed', 'Auto finished. Re-armed for the next match.');
      }
      return this.set('idle', 'Auto finished.');
    }
    if (realInputActive()) return this.stop('Stopped: a real controller was used.');
    const mode = readMode();
    if (!mode.allowed) return this.stop(mode.reason);
    const pose = readPose(settings.front);
    if (!pose) return this.stop('Lost the robot (match ended?).');
    const sched = this.t.schedule!;

    let el = (now - this.startAt) / 1000 - this.clockOffset;
    // if the robot is lagging at the end of a drive step, pause the clock briefly so it catches up
    const steps = sched.steps;
    const cur = steps[this.stepIdx];
    if (cur && el >= cur.t1) {
      const endPose = cur.kind === 'drive' ? cur.traj[cur.traj.length - 1] : cur.pose;
      const err = Math.hypot(endPose.x - pose.x, endPose.y - pose.y);
      if (cur.kind === 'drive' && err > END_TOL && this.waited < MAX_CATCHUP) {
        this.waited += dt;
        this.clockOffset += el - cur.t1;
        el = cur.t1;
      } else {
        this.stepIdx++;
        this.waited = 0;
      }
    }
    this.t.elapsed = el;

    const ref = referenceAt(sched, el);
    const ex = ref.pose.x - pose.x;
    const ey = ref.pose.y - pose.y;
    const eh = wrapAngle(ref.pose.heading - pose.heading);
    let vx = ref.vx + settings.kP * ex;
    let vy = ref.vy + settings.kP * ey;
    const rates = GAME.id === 'rebuilt' && settings.autoCalibrate && (mode.kind === 'singleplayer' || mode.kind === 'multiplayer')
      ? readDriverDisplay(mode.kind).driveRates ?? this.plannedRobot : null;
    const cal = rates ? { ...settings.cal, ...rates } : settings.cal;
    const vmax = cal.maxVel;
    const m = Math.hypot(vx, vy);
    if (m > vmax) {
      vx *= vmax / m;
      vy *= vmax / m;
    }
    // small deadband near the target so the robot settles instead of twitching
    if (Math.hypot(ex, ey) < 0.02 && Math.hypot(ref.vx, ref.vy) < 1e-3) vx = vy = 0;
    let omega = ref.omega + settings.kTheta * eh;
    if (Math.abs(eh) < 0.015 && Math.abs(ref.omega) < 1e-3) omega = 0;

    // FRS's own auto-align is driving (e.g. Reefscape reef poles): let go of the sticks,
    // since any stick input over 15% would cancel it
    const assisting = sched.assists.some((w) => el >= w.t0 && el < w.t1);
    if (assisting) setSticks(0, 0, 0);
    else {
      const s = stickFromVelocity(vx, vy, omega, this.t.alliance, cal, driveFrame());
      setSticks(s.lx, s.ly, s.rx);
    }
    const pressed = new Set<number>();
    for (const b of buttonsAt(sched, el)) pressed.add(settings.buttonMap[b]);
    setButtons(pressed);

    this.t.pose = pose;
    this.t.ref = ref.pose;
    const last = this.t.trail[this.t.trail.length - 1];
    if (!last || Math.hypot(last.x - pose.x, last.y - pose.y) > 0.05) this.t.trail.push({ x: pose.x, y: pose.y });

    // practice run (not gated by Auto): finish once everything is done and the robot has settled
    if (!this.gated && el > sched.total + 0.75) this.stop(`Done in ${sched.total.toFixed(1)} s.`);
  }

  /**
   * Measure the robot's speed and turn rate, then extrapolate to full stick (FRS's stick
   * response is linear past the deadzone). Drives at partial stick toward whichever direction
   * has the most open field, then back. Best done in the open neutral zone. Takes ~4 s.
   */
  async calibrate() {
    const err = this.guard();
    if (err) return this.set('idle', err);
    const front = store.settings().front;
    const cal = store.settings().cal;
    const p0 = readPose(front)!;
    const alliance = readMode().alliance ?? allianceOfX(GAME, p0.x);
    // field-frame direction with the most room (walls only; the user should avoid obstacles)
    const room = [
      { dx: 1, dy: 0, d: GAME.field.length - p0.x },
      { dx: -1, dy: 0, d: p0.x },
      { dx: 0, dy: 1, d: GAME.field.width - p0.y },
      { dx: 0, dy: -1, d: p0.y },
    ].sort((p, q) => q.d - p.d)[0];
    const LEVEL = 0.6;
    const toStick = (dx: number, dy: number) => stickFromVelocity(dx, dy, 0, alliance, { maxVel: 1, maxOmega: 1, deadzone: 0 }, driveFrame());
    const dir = toStick(room.dx, room.dy);
    this.set('calibrating', 'Calibrating: driving…');
    setActive(true);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const abort = () => this.t.state !== 'calibrating';
    /** run sticks for `ms`, return the peak speed over 150 ms windows */
    const measure = async (lx: number, ly: number, rx: number, ms: number, angular: boolean) => {
      setSticks(lx, ly, rx);
      const hist: { t: number; x: number; y: number; h: number }[] = [];
      let unwrapped = readPose(front)!.heading;
      let lastH = unwrapped;
      const end = performance.now() + ms;
      let peak = 0;
      while (performance.now() < end) {
        await wait(30);
        if (abort()) return 0;
        const p = readPose(front);
        if (!p) return 0;
        unwrapped += wrapAngle(p.heading - lastH);
        lastH = p.heading;
        const now = performance.now();
        hist.push({ t: now, x: p.x, y: p.y, h: unwrapped });
        const old = hist.find((q) => now - q.t <= 150);
        if (old && now - old.t > 100) {
          const dt = (now - old.t) / 1000;
          const v = angular ? Math.abs(unwrapped - old.h) / dt : Math.hypot(p.x - old.x, p.y - old.y) / dt;
          peak = Math.max(peak, v);
        }
      }
      setSticks(0, 0, 0);
      return peak;
    };
    try {
      const travel = Math.min(1100, Math.max(500, (room.d - 1) * 400));
      const v = await measure(dir.lx * LEVEL, dir.ly * LEVEL, 0, travel, false);
      if (abort()) return;
      this.set('calibrating', 'Calibrating: coming back…');
      await measure(-dir.lx * LEVEL, -dir.ly * LEVEL, 0, travel, false);
      await wait(300);
      if (abort()) return;
      this.set('calibrating', 'Calibrating: turning…');
      const w = await measure(0, 0, LEVEL, 900, true);
      await measure(0, 0, -LEVEL, 900, true);
      const frac = (LEVEL - cal.deadzone) / (1 - cal.deadzone);
      const vel = v / frac;
      const omega = w / frac;
      if (!(vel > 0.5 && vel < 12) || !(omega > 0.5 && omega < 40)) {
        this.stop(`Calibration looked wrong (speed ${vel.toFixed(2)} m/s, turn ${omega.toFixed(2)} rad/s). Try again in open space.`);
        return;
      }
      store.setSettings({ cal: { ...store.settings().cal, maxVel: +vel.toFixed(2), maxOmega: +omega.toFixed(2) } });
      this.stop(`Calibrated: ${vel.toFixed(2)} m/s, ${omega.toFixed(2)} rad/s at full stick.`);
    } catch (e) {
      this.stop('Calibration failed: ' + (e as Error).message);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.keyHandler, true);
    setActive(false);
  }
}
