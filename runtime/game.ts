// Hooks into the running FRS page. Everything here is specific to FRS's current build;
// see docs/recon.md. All functions fail closed (return null / throw a readable Error).
import { GAMES, SIDE_OFFSET, gameFromHost, simToField, type GameDef, type Pose } from '../shared/field';
import type { DriveFrame } from '../shared/stick';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/**
 * Which way the robot's front points. Rebuilt reads the 3D model, so this is a model axis
 * ('-x' etc.); Reefscape and Crescendo read FRS's own yaw, so it's a robot side.
 */
export type FrontAxis = '-x' | '+x' | '-z' | '+z' | 'front' | 'back' | 'left' | 'right';

/** The game on this page (by host); Rebuilt if it can't tell. */
export const GAME: GameDef = GAMES[gameFromHost(location.hostname) ?? 'rebuilt'];
export const DEFAULT_FRONT: FrontAxis = GAME.id === 'rebuilt' ? '-x' : 'front';
const SCENE_BASED = GAME.id === 'rebuilt';

let three: Any = null;
let modules: Map<unknown, Any> | null = null;
/** Shared with any earlier copy of the runtime that already hooked the renderer. */
interface HookState {
  scene: Any;
  seenAt: number;
  checked: WeakSet<object>;
}
let hook: HookState = { scene: null, seenAt: 0, checked: new WeakSet() };
let robot: Any = null;
let robotCount = 0;
let robotScanAt = 0;

function getTurbopackContext(): Promise<Any> {
  const T = (window as Any).TURBOPACK;
  if (!T || typeof T.push !== 'function') return Promise.reject(new Error('This page is not FRS (game bundle not found).'));
  return new Promise((resolve, reject) => {
    const id = 'frsauto-' + Math.random().toString(36).slice(2);
    let done = false;
    try {
      T.push([id + '-a.js', id, (ctx: Any) => {
        done = true;
        resolve(ctx);
      }]);
      T.push([id + '-b.js', { otherChunks: [], runtimeModuleIds: [id] }]);
    } catch (e) {
      reject(new Error('Could not reach the game modules: ' + (e as Error).message));
      return;
    }
    setTimeout(() => {
      if (!done) reject(new Error('Could not reach the game modules (timed out).'));
    }, 3000);
  });
}

/** Find Three.js inside the game bundle and start watching for the match scene. */
export async function attach(): Promise<void> {
  if (three) return;
  const ctx = await getTurbopackContext();
  const cache: Map<unknown, Any> | undefined = ctx && ctx.c;
  if (!cache || typeof cache.values !== 'function') throw new Error('Game module cache not found (FRS may have updated).');
  modules = cache;
  for (const m of cache.values()) {
    try {
      const e = m && m.exports;
      if (e && e.Object3D && e.Vector3 && e.Object3D.prototype && typeof e.Object3D.prototype.updateMatrixWorld === 'function') {
        three = e;
        break;
      }
    } catch {
      /* some exports throw on access */
    }
  }
  if (!three) throw new Error('Three.js not found in the game (FRS may have updated).');
  const proto = three.Object3D.prototype;
  if (proto.__frsAutoHook) {
    hook = proto.__frsAutoHook;
    return;
  }
  const state = hook;
  const orig = proto.updateMatrixWorld;
  proto.updateMatrixWorld = function (this: Any, force?: boolean) {
    if (this.isScene) {
      if (this !== state.scene && !state.checked.has(this)) {
        state.checked.add(this);
        try {
          if (this.getObjectByName('field')) state.scene = this;
        } catch {
          /* ignore */
        }
      }
      if (this === state.scene) state.seenAt = performance.now();
    }
    return orig.call(this, force);
  };
  proto.__frsAutoHook = state;
}

function isWarmup(o: Any): boolean {
  for (let p = o.parent; p; p = p.parent) if (p.name === 'shader-warmup-robot') return true;
  return false;
}

function scanRobots() {
  robotScanAt = performance.now();
  const found: Any[] = [];
  if (hook.scene) {
    hook.scene.traverse((o: Any) => {
      if (/^robot:\d+$/.test(o.name) && !isWarmup(o)) found.push(o);
    });
  }
  robotCount = found.length;
  robot = pickMine(found);
}

/**
 * Which of the robots on the field is ours. Offline there is only one (or the one with our
 * team number). Online we ask the game's network view for our robot (by localId) and take
 * the rendered robot closest to it.
 */
function pickMine(found: Any[]): Any {
  if (found.length === 0) return null;
  const net = netState();
  if (!net || net.status === 'off') {
    if (found.length === 1) return found[0];
    const team = gameState()?.team;
    return found.find((o) => o.name === `robot:${team}`) ?? null;
  }
  const me = localNetRobot();
  if (!me || !Array.isArray(me.pos)) return null;
  let best: Any = null;
  let bestD = Infinity;
  for (const o of found) {
    o.updateWorldMatrix(true, false);
    const m = o.matrixWorld.elements as number[];
    let d = (m[12] - me.pos[0]) ** 2 + (m[14] - me.pos[2]) ** 2;
    if (me.team !== undefined && o.name !== `robot:${me.team}`) d += 4; // prefer our team's model
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return bestD < 1.5 * 1.5 + 4 ? best : null;
}

// ---------- game state stores (found by shape, since module ids change between builds) ----------

let storesScanAt = 0;
let netStore: Any = null; // { status, room, ranked?, spectating?/watching?, you?/myId?, ... }
let gameStore: Any = null; // { alliance, team|teamNumber, matchId, cameraMode?, online?, ... }
let netView: Any = null; // { view: { robots }, localId, ... }
let posePublic: Any = null; // Crescendo: { position, yaw, shooterDir, ready }
let teamDefs: Any[] | null = null; // robot definitions (number, intake.side, ...)

interface TeamProfile {
  number: number;
  shownAs?: { number: number };
  robotName: string;
  name: string;
  region: string;
  drive?: { feel?: { maxSpeed: number; turnRate: number } };
}
let roster: TeamProfile[] | null = null;

function findStores() {
  if (!modules || performance.now() - storesScanAt < 2000) return;
  if (netStore && gameStore && netView && roster) return;
  if (netStore && gameStore && netView && (GAME.id !== 'crescendo' || (posePublic && teamDefs))) return;
  storesScanAt = performance.now();
  for (const m of modules.values()) {
    let e: Any;
    try {
      e = m && m.exports;
    } catch {
      continue;
    }
    if (!e || typeof e !== 'object') continue;
    for (const k of Object.keys(e)) {
      let v: Any;
      try {
        v = e[k];
      } catch {
        continue;
      }
      if (!v) continue;
      if (!roster && k === 'ALL_TEAMS' && Array.isArray(v) && v.some(team => team?.hopper && typeof team.robotName === 'string')) roster = v;
      if (typeof v === 'function' && typeof v.getState === 'function') {
        let st: Any;
        try {
          st = v.getState();
        } catch {
          continue;
        }
        if (!st || typeof st !== 'object') continue;
        if (!netStore && 'room' in st && 'status' in st && ('myId' in st || 'you' in st || 'spectating' in st)) netStore = v;
        if (!gameStore && 'alliance' in st && ('team' in st || 'teamNumber' in st) && 'matchId' in st) gameStore = v;
      } else if (Array.isArray(v)) {
        if (!teamDefs && v.length > 3 && v.every((t: Any) => t && typeof t.number === 'number' && t.intake)) teamDefs = v;
      } else if (typeof v === 'object') {
        if (!netView && 'localId' in v && 'view' in v) netView = v;
        if (!posePublic && 'position' in v && 'yaw' in v && 'shooterDir' in v && 'ready' in v) posePublic = v;
      }
    }
  }
}

function netState(): Any {
  findStores();
  try {
    return netStore ? netStore.getState() : null;
  } catch {
    return null;
  }
}

function gameState(): Any {
  findStores();
  try {
    return gameStore ? gameStore.getState() : null;
  } catch {
    return null;
  }
}

function localNetRobot(): Any {
  findStores();
  const v = netView?.view;
  if (!v || !Array.isArray(v.robots)) return null;
  return v.robots.find((r: Any) => r.id === netView.localId) ?? null;
}

export interface ModeInfo {
  kind: 'singleplayer' | 'multiplayer' | 'ranked' | 'spectating' | 'event' | 'unknown';
  allowed: boolean;
  reason: string;
  /** our alliance according to the game, if it says */
  alliance: 'blue' | 'red' | null;
}

/**
 * What kind of match this is. FRS Auto runs in Singleplayer and regular (non-ranked)
 * Multiplayer only, and fails closed on anything it can't positively identify.
 */
export function readMode(): ModeInfo {
  const net = netState();
  const game = gameState();
  const al = game?.alliance === 'blue' || game?.alliance === 'red' ? game.alliance : null;
  if (!net) {
    // stores not found: only trust a field with exactly one robot (Rebuilt) / an offline match
    robotInfo();
    const solo = SCENE_BASED ? robotCount === 1 : game ? game.online === false : false;
    return solo
      ? { kind: 'singleplayer', allowed: true, reason: '', alliance: al }
      : { kind: 'unknown', allowed: false, reason: "Couldn't tell what kind of match this is, so FRS Auto is off.", alliance: al };
  }
  const room = net.room;
  if (net.ranked || game?.queuePlay || room?.ranked) return { kind: 'ranked', allowed: false, reason: 'Disabled in Ranked.', alliance: al };
  if (net.event || room?.event || room?.kind === 'event') return { kind: 'event', allowed: false, reason: 'Disabled in events and tournaments.', alliance: al };
  if (net.spectating || (net.watching !== undefined && net.watching !== null && net.watching !== false)) {
    return { kind: 'spectating', allowed: false, reason: "You're spectating.", alliance: al };
  }
  if (!room) {
    if (game?.online === true) return { kind: 'unknown', allowed: false, reason: "Couldn't tell what kind of match this is, so FRS Auto is off.", alliance: al };
    return { kind: 'singleplayer', allowed: true, reason: '', alliance: al };
  }
  const me = net.you ?? net.myId;
  const mine = Array.isArray(room.players) ? room.players.find((p: Any) => p.id === me) : null;
  if (mine && mine.alliance === null) return { kind: 'spectating', allowed: false, reason: "You're watching, not driving.", alliance: al };
  const roomAl = mine?.alliance === 'blue' || mine?.alliance === 'red' ? mine.alliance : al;
  return { kind: 'multiplayer', allowed: true, reason: '', alliance: roomAl };
}

function attachedToScene(o: Any): boolean {
  let p = o;
  while (p.parent) p = p.parent;
  return p === hook.scene;
}

/** Is a match on screen right now? */
export function inMatch(): boolean {
  if (!SCENE_BASED) return readPhase() !== null && statePose() !== null;
  if (!hook.scene) return false;
  // Rendering pauses when the window is hidden, so also accept "scoreboard is on screen".
  return performance.now() - hook.seenAt < 1000 || readPhase() !== null;
}

export function robotInfo(): { count: number; name: string | null } {
  if (!SCENE_BASED) {
    const v = netView?.view;
    const n = v && Array.isArray(v.robots) ? v.robots.length : statePose() ? 1 : 0;
    const team = gameState()?.team ?? gameState()?.teamNumber;
    return { count: n, name: statePose() ? `robot:${team ?? '?'}` : null };
  }
  // re-checked periodically: in multiplayer, which robot is ours comes from the network view
  if (!robot || !attachedToScene(robot) || performance.now() - robotScanAt > 2000) scanRobots();
  return { count: robotCount, name: robot ? robot.name : null };
}

/** Both singleplayer and multiplayer publish a robot snapshot in the match view. */
export function readDriverDisplay(kind: 'singleplayer' | 'multiplayer') {
  findStores();
  const robots = netView?.view?.robots;
  const local = kind === 'multiplayer' ? localNetRobot()
    : Array.isArray(robots) ? robots.find((r: Any) => r.local === true) : null;
  const team = local?.team ?? (kind === 'singleplayer' ? gameState()?.team : null);
  const profile = roster?.find(entry => entry.number === team);
  const fuel = local?.hopperFuel;
  const feel = profile?.drive?.feel;
  // FRS maps full translation to maxSpeed and full rotation to 45% of turnRate.
  const driveRates = feel && Number.isFinite(feel.maxSpeed) && feel.maxSpeed > 0
    && Number.isFinite(feel.turnRate) && feel.turnRate > 0
    ? { maxVel: feel.maxSpeed, maxOmega: feel.turnRate * 0.45 }
    : null;
  return {
    team: profile?.shownAs?.number ?? team,
    profile,
    driveRates,
    balls: Number.isSafeInteger(fuel) && fuel >= 0 ? fuel as number : null,
  };
}

/** Reefscape / Crescendo: FRS's own record of our robot, in scene coords + yaw (front = (sin yaw, cos yaw)). */
function statePose(): { X: number; Z: number; yaw: number } | null {
  findStores();
  if (GAME.id === 'crescendo') {
    const p = posePublic;
    if (!p || !p.ready || !p.position) return null;
    return { X: p.position.x, Z: p.position.z, yaw: p.yaw };
  }
  const v = netView?.view;
  if (!v || !Array.isArray(v.robots)) return null;
  const me = v.robots.find((r: Any) => r.local) ?? v.robots.find((r: Any) => r.id === netView.localId);
  return me && Number.isFinite(me.x) ? { X: me.x, Z: me.z, yaw: me.yaw } : null;
}

/** Robot pose in WPILib blue-origin field coordinates, or null if unavailable. */
export function readPose(front: FrontAxis = DEFAULT_FRONT): Pose | null {
  if (!inMatch()) return null;
  if (!SCENE_BASED) {
    const p = statePose();
    if (!p) return null;
    const off = SIDE_OFFSET[front] ?? 0;
    // side direction in scene = (sin(yaw+off), cos(yaw+off)); field dir = (X, -Z)
    return { ...simToField(GAME, p.X, p.Z), heading: p.yaw + off - Math.PI / 2 };
  }
  if (!robot || !attachedToScene(robot) || performance.now() - robotScanAt > 2000) scanRobots();
  if (!robot) return null;
  robot.updateWorldMatrix(true, false);
  const m = robot.matrixWorld.elements as number[];
  // local axis -> world direction (X, Z); field dir = (X, -Z)
  let wx: number, wz: number;
  switch (front) {
    case '+x': wx = m[0]; wz = m[2]; break;
    case '+z': wx = m[8]; wz = m[10]; break;
    case '-z': wx = -m[8]; wz = -m[10]; break;
    default: wx = -m[0]; wz = -m[2]; break; // '-x'
  }
  return { ...simToField(GAME, m[12], m[14]), heading: Math.atan2(-wz, wx) };
}

/**
 * How the stick moves the robot right now. Only Crescendo's first-person camera is
 * robot-relative (relative to the robot's intake side); everything else is field-relative.
 */
export function driveFrame(): DriveFrame {
  if (GAME.id !== 'crescendo') return { kind: 'field' };
  const g = gameState();
  if (g?.cameraMode !== 'firstPerson') return { kind: 'field' };
  const p = statePose();
  if (!p) return { kind: 'field' };
  const def = teamDefs?.find((t: Any) => t.number === (g.teamNumber ?? g.team));
  const side = def?.intake?.side ?? 'front';
  return { kind: 'robot', leadYaw: p.yaw + (SIDE_OFFSET[side] ?? 0) };
}

let phaseEl: Element | null = null;
let phaseScanAt = 0;
const PHASE_RE = /^(Ready|Get ready|Starting|Auto|Autonomous|Auto scoring|Teleop|Endgame|End game|Paused|Match over)$|^(Transition|Shift \d|End game|Endgame|Teleop) ·/;

/** The scoreboard phase label: "Auto" / "Autonomous", "Teleop", "Transition · 0:10", ... */
export function readPhase(): string | null {
  if (!phaseEl || !phaseEl.isConnected || !PHASE_RE.test((phaseEl.textContent || '').trim())) {
    phaseEl = null;
    if (performance.now() - phaseScanAt < 400) return null;
    phaseScanAt = performance.now();
    const els = document.querySelectorAll('span,div,p');
    for (const el of Array.from(els)) {
      if (el.children.length) continue;
      if (el.closest('#frs-auto-hud')) continue;
      if (PHASE_RE.test((el.textContent || '').trim())) {
        phaseEl = el;
        break;
      }
    }
  }
  return phaseEl ? (phaseEl.textContent || '').trim() : null;
}

export const isAutoPhase = (p: string | null) => p === 'Auto' || p === 'Autonomous';

/** Match clock (seconds remaining in the current period), read from the span next to the phase label. */
export function readClock(): number | null {
  readPhase();
  const parent = phaseEl?.parentElement;
  if (!parent) return null;
  for (const c of Array.from(parent.children)) {
    const m = /^(\d+):(\d\d)$/.exec((c.textContent || '').trim());
    if (m) return +m[1] * 60 + +m[2];
  }
  return null;
}

/**
 * Watches the scoreboard for the start/end of the Auto period. A new Auto is either the
 * phase label turning into "Auto", or the clock jumping back up (match restarted with R).
 */
export class AutoWatch {
  phase: string | null = null;
  clock: number | null = null;
  private lastPhase: string | null = null;
  private lastClock: number | null = null;

  /** Forget history (call when arming) so an Auto that's already running isn't treated as new. */
  reset() {
    this.lastPhase = readPhase();
    this.lastClock = readClock();
    this.phase = this.lastPhase;
    this.clock = this.lastClock;
  }

  update(): { started: boolean; ended: boolean } {
    const phase = readPhase();
    const clock = readClock();
    const started =
      isAutoPhase(phase) && (!isAutoPhase(this.lastPhase) || (clock !== null && this.lastClock !== null && clock > this.lastClock + 0.5));
    const ended = phase !== null && isAutoPhase(this.lastPhase) && !isAutoPhase(phase);
    this.phase = phase;
    this.clock = clock;
    this.lastPhase = phase ?? this.lastPhase;
    this.lastClock = clock ?? this.lastClock;
    return { started, ended };
  }
}
