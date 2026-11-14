import type { Calibration, DevState, Lesson, Recording, WearerCalibration } from '../api/types';
import { SEED_LESSONS } from './seed';

/**
 * In-browser database for mock mode. Lessons, calibrations, recordings and the dev state persist in localStorage
 * (every access is wrapped in try/catch and falls back to memory, as storage can be blocked or full).
 */

const PREFIX = 'apprentice.mock.v1.';
const MAX_RECORDINGS_KEPT = 30;
const PERSIST_FPS = 30;

const memory = new Map<string, string>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null | undefined;
  try {
    raw = window.localStorage.getItem(PREFIX + key);
  } catch {
    raw = undefined;
  }
  raw = raw ?? memory.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  const raw = JSON.stringify(value);
  memory.set(key, raw);
  try {
    window.localStorage.setItem(PREFIX + key, raw);
    return true;
  } catch {
    return false;
  }
}

/** Removes every mock key; used by the reset button in the documentation and by tests. */
export function clearMockStorage(): void {
  memory.clear();
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }
}

export const DEFAULT_DEV_STATE: DevState = {
  glove_source: 'simulator',
  smoothing: { enabled: true, min_cutoff: 1.5, beta: 0.4 },
  llm_provider: 'fake',
  simulator_motion: { preset: 'idle' },
};

/** Thins a recording to the scoring rate with 3 decimals so a few dozen fit in localStorage. */
function compact(rec: Recording): Recording {
  const step = Math.max(1, Math.round(rec.fps / PERSIST_FPS));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const frames = rec.frames
    .filter((_, i) => i % step === 0)
    .map((f) => ({
      ...f,
      t: r3(f.t),
      hands: f.hands.map((h) => ({
        ...h,
        wrist_quat: h.wrist_quat.map(r3) as [number, number, number, number],
        flexion: Object.fromEntries(Object.entries(h.flexion).map(([k, v]) => [k, v.map(r3)])) as typeof h.flexion,
      })),
    }));
  return { ...rec, fps: rec.fps / step, frames };
}

class MockStore {
  private lessons = new Map<string, Lesson>();
  private calibrations: Calibration[] = [];
  private wearerCalibrations: WearerCalibration[] = [];
  private recordings = new Map<string, Recording>();
  dev: DevState = JSON.parse(JSON.stringify(DEFAULT_DEV_STATE)) as DevState;

  constructor() {
    for (const seed of SEED_LESSONS) this.lessons.set(seed.id, seed);
    for (const l of read<Lesson[]>('lessons', [])) this.lessons.set(l.id, l);
    this.calibrations = read<Calibration[]>('calibrations', []);
    this.wearerCalibrations = read<WearerCalibration[]>('wearerCalibrations', []);
    for (const r of read<Recording[]>('recordings', [])) this.recordings.set(r.id, r);
    const dev = read<Partial<DevState>>('dev', {});
    this.dev = { ...this.dev, ...dev, smoothing: { ...this.dev.smoothing, ...dev.smoothing } };
  }

  listLessons(): Lesson[] {
    return [...this.lessons.values()];
  }

  getLesson(id: string): Lesson | undefined {
    return this.lessons.get(id);
  }

  saveLesson(lesson: Lesson): Lesson {
    this.lessons.set(lesson.id, lesson);
    write('lessons', this.listLessons().filter((l) => !SEED_LESSONS.includes(l)));
    return lesson;
  }

  listCalibrations(): Calibration[] {
    return this.calibrations;
  }

  saveCalibration(cal: Calibration): Calibration {
    this.calibrations.push(cal);
    write('calibrations', this.calibrations.slice(-40));
    return cal;
  }

  /** Glove calibrations per wearer, oldest first. */
  listWearerCalibrations(): WearerCalibration[] {
    return this.wearerCalibrations;
  }

  saveWearerCalibration(cal: WearerCalibration): WearerCalibration {
    this.wearerCalibrations = [...this.wearerCalibrations.filter((c) => c.id !== cal.id), cal];
    write('wearerCalibrations', this.wearerCalibrations.slice(-40));
    return cal;
  }

  getRecording(id: string): Recording | undefined {
    return this.recordings.get(id);
  }

  saveRecording(rec: Recording): Recording {
    this.recordings.set(rec.id, rec);
    this.persistRecordings();
    return rec;
  }

  private persistRecordings(): void {
    let kept = [...this.recordings.values()].slice(-MAX_RECORDINGS_KEPT).map(compact);
    while (kept.length && !write('recordings', kept)) kept = kept.slice(1);
  }

  saveDev(): void {
    write('dev', this.dev);
  }
}

let instance: MockStore | null = null;

/** The process-wide store, created on first use. */
export function getStore(): MockStore {
  instance ??= new MockStore();
  return instance;
}

export type { MockStore };
