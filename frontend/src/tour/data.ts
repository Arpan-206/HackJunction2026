import type { Finger, GloveFrame, HandFrame, JointTriple, Side } from '../api/types';

const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];

/** A bundled take as written by scripts/tour/build-data.mjs: 30 Hz rows of packed numbers. */
export interface PackedTake {
  title: string;
  side: Side;
  fps: number;
  duration: number;
  /** t, wrist quaternion (4), wrist position (3), flexion (15, thumb to little, three joints each), spread (5). */
  frames: number[][];
}

export interface TourTake {
  title: string;
  side: Side;
  duration: number;
  frames: GloveFrame[];
}

/** One packed row as a hand frame. */
export function unpackHand(row: number[], side: Side): HandFrame {
  const flexion = {} as Record<Finger, JointTriple>;
  const spread = {} as Record<Finger, number>;
  FINGERS.forEach((f, i) => {
    const k = 8 + i * 3;
    flexion[f] = [row[k], row[k + 1], row[k + 2]];
    spread[f] = row[23 + i];
  });
  return {
    side,
    wrist_quat: [row[1], row[2], row[3], row[4]],
    wrist_pos: [row[5], row[6], row[7]],
    flexion,
    spread,
  };
}

export function unpackTake(p: PackedTake): TourTake {
  return {
    title: p.title,
    side: p.side,
    duration: p.duration,
    frames: p.frames.map((row) => ({ t: row[0], source: 'replay', hands: [unpackHand(row, p.side)] })),
  };
}

export type TakeName = 'expert' | 'attempt' | 'rabbit' | 'letter';

/** Each take loads in its own small chunk, only when its stop opens. */
const loaders: Record<TakeName, () => Promise<{ default: unknown }>> = {
  expert: () => import('../../tour/data/expert.json'),
  attempt: () => import('../../tour/data/attempt.json'),
  rabbit: () => import('../../tour/data/rabbit.json'),
  letter: () => import('../../tour/data/letter.json'),
};

const cache = new Map<TakeName, Promise<TourTake>>();

export function loadTake(name: TakeName): Promise<TourTake> {
  let p = cache.get(name);
  if (!p) {
    p = loaders[name]().then((m) => unpackTake(m.default as PackedTake));
    cache.set(name, p);
  }
  return p;
}

export interface RecordedHint {
  lang: string;
  task: string;
  step: string;
  finger: Finger;
  error: string;
  score: number;
  line: string;
}

export function loadHints(): Promise<RecordedHint[]> {
  return import('../../tour/hints.json').then((m) => (m.default as { hints: RecordedHint[] }).hints);
}
