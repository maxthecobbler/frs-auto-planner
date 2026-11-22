import { buttonIds, gameOf, parseRoutine, type ButtonId, type Routine } from '../shared/routine';
import { DEFAULT_CALIBRATION, type Calibration } from '../shared/stick';
import { DEFAULT_FRONT, GAME, type FrontAxis } from './game';

export interface Settings {
  cal: Calibration;
  front: FrontAxis;
  /** standard-gamepad button index for each mechanism */
  buttonMap: Record<ButtonId, number>;
  panelSize: { width: number; height: number } | null;
  hopperLayout: { x: number; y: number; fontSize: number };
  autoCalibrate: boolean;
  autoRearm: boolean;
  kP: number; // 1/s, position correction
  kTheta: number; // 1/s, heading correction
}

export const DEFAULT_SETTINGS: Settings = {
  cal: { ...DEFAULT_CALIBRATION },
  panelSize: null,
  hopperLayout: { x: 0.5, y: 0, fontSize: 24 },
  autoCalibrate: true,
  front: DEFAULT_FRONT,
  buttonMap: Object.fromEntries(buttonIds(GAME).map((b) => [b, GAME.buttons[b].pad])),
  autoRearm: true,
  kP: 2.5,
  kTheta: 3,
};

const K = {
  routines: 'frsAuto:routines',
  selected: 'frsAuto:selected:' + GAME.id,
  settings: GAME.id === 'rebuilt' ? 'frsAuto:settings' : 'frsAuto:settings:' + GAME.id,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: keep working in memory */
  }
}

let routines: Routine[] = read<Routine[]>(K.routines, []).filter((r) => {
  try {
    parseRoutine(JSON.stringify(r));
    return true;
  } catch {
    return false;
  }
});
let selected: string | null = read<string | null>(K.selected, null);
let settings: Settings = (() => {
  const s = read<Partial<Settings>>(K.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    hopperLayout: { ...DEFAULT_SETTINGS.hopperLayout, ...s.hopperLayout },
    cal: { ...DEFAULT_SETTINGS.cal, ...(s.cal ?? {}) },
    buttonMap: { ...DEFAULT_SETTINGS.buttonMap, ...(s.buttonMap ?? {}) },
  };
})();

/** Routines for the game on this page (all games are kept in storage). */
const mine = () => routines.filter((r) => gameOf(r).id === GAME.id);

export const store = {
  routines: mine,
  selected: () => mine().find((r) => r.id === selected) ?? mine()[0] ?? null,
  select(id: string) {
    selected = id;
    write(K.selected, id);
  },
  upsert(r: Routine) {
    const i = routines.findIndex((x) => x.id === r.id);
    if (i >= 0) routines[i] = r;
    else routines.push(r);
    write(K.routines, routines);
    store.select(r.id);
  },
  /** Add/replace many routines without changing which one is selected (unless none is). */
  upsertMany(list: Routine[]) {
    for (const r of list) {
      const i = routines.findIndex((x) => x.id === r.id);
      if (i >= 0) routines[i] = r;
      else routines.push(r);
    }
    write(K.routines, routines);
    if (!mine().some((r) => r.id === selected) && mine()[0]) store.select(mine()[0].id);
    return list.filter((r) => gameOf(r).id === GAME.id).length;
  },
  remove(id: string) {
    routines = routines.filter((r) => r.id !== id);
    write(K.routines, routines);
  },
  rename(id: string, name: string, updatedAt: number) {
    const routine = routines.find(r => r.id === id);
    if (!routine) return;
    routine.name = name;
    routine.updatedAt = updatedAt;
    write(K.routines, routines);
  },
  settings: () => settings,
  setSettings(patch: Partial<Settings>) {
    settings = { ...settings, ...patch };
    write(K.settings, settings);
  },
};
