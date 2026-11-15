#!/usr/bin/env node
/**
 * Builds the public tour's bundled recordings (frontend/tour/data/, git-ignored) from the lesson-sync bundle.
 *
 * Usage (from frontend/): node scripts/tour/build-data.mjs [repo root, default ..]
 *
 * The take for each stop is set in frontend/tour/takes.json: { recorder, take, title }. The script reads
 * <repo root>/lessons/shared/<recorder>/backend/recordings/<take>.json and writes only what the 3D hand reads: time,
 * wrist rotation and position, 15 flexion angles and 5 spreads, resampled to 30 Hz and rounded. No id, time stamp,
 * wearer, calibration, lesson id or recorder name is written. The CRACI workflow runs this before the tour build.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'little'];
const FPS = 30;
const NAMES = ['expert', 'attempt', 'rabbit', 'letter'];

const r = (v, d) => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};

function handOf(frame) {
  return frame.hands && frame.hands.length ? frame.hands[0] : null;
}

function packHand(h) {
  const q = h.wrist_quat;
  const p = h.wrist_pos ?? [0, 0, 0];
  const f = FINGERS.flatMap((n) => h.flexion[n]);
  const s = FINGERS.map((n) => h.spread?.[n] ?? 0);
  return [...q, ...p, ...f, ...s];
}

/** Resamples a take's frames to FPS by linear interpolation (quaternions take the short way and are renormalised). */
export function resample(frames) {
  const valid = frames.filter((f) => handOf(f));
  if (valid.length < 2) throw new Error('a take needs at least two frames with a hand');
  const t0 = valid[0].t;
  const pts = valid.map((f) => ({ t: f.t - t0, v: packHand(handOf(f)) }));
  const dur = pts[pts.length - 1].t;
  const out = [];
  let j = 0;
  for (let i = 0; i / FPS <= dur + 1e-9; i++) {
    const t = i / FPS;
    while (j < pts.length - 2 && pts[j + 1].t < t) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    const dot = a.v[0] * b.v[0] + a.v[1] * b.v[1] + a.v[2] * b.v[2] + a.v[3] * b.v[3];
    const s = dot < 0 ? -1 : 1;
    const v = a.v.map((x, n) => x + ((n < 4 ? s * b.v[n] : b.v[n]) - x) * k);
    const len = Math.hypot(v[0], v[1], v[2], v[3]) || 1;
    for (let n = 0; n < 4; n++) v[n] /= len;
    out.push([r(t, 3), ...v.map((x, n) => r(x, n < 7 ? 4 : 3))]);
  }
  return { duration: r(dur, 3), frames: out };
}

/** The tour's packed take from a raw take file: only the frames, no ids or names. */
export function packTake(raw, title) {
  const first = raw.frames.find((f) => handOf(f));
  if (!first) throw new Error('the take has no hand frames');
  const { duration, frames } = resample(raw.frames);
  return { title, side: handOf(first).side, fps: FPS, duration, frames };
}

function main() {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const frontend = resolve(here, '../..');
  const root = resolve(process.argv[2] ?? resolve(frontend, '..'));
  const config = JSON.parse(readFileSync(join(frontend, 'tour/takes.json'), 'utf8'));
  const outDir = join(frontend, 'tour/data');
  mkdirSync(outDir, { recursive: true });
  for (const name of NAMES) {
    const c = config[name];
    if (!c || !/^[a-z0-9_-]+$/i.test(c.recorder) || !/^[a-z0-9_-]+$/i.test(c.take)) throw new Error(`tour/takes.json: bad entry for ${name}`);
    const file = join(root, 'lessons/shared', c.recorder, 'backend/recordings', `${c.take}.json`);
    const doc = packTake(JSON.parse(readFileSync(file, 'utf8')), c.title);
    writeFileSync(join(outDir, `${name}.json`), JSON.stringify(doc));
    console.log(`${name}: ${c.recorder}/${c.take}, ${doc.frames.length} frames, ${doc.duration} s`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
