import { FINGERS } from '../../../../api/types';
import type { FingerValues } from './deviation';

/** Time the learner must hold a matching pose before the ghost moves on, in seconds. */
export const FOLLOW_HOLD_S = 0.5;

/**
 * Finds the moments where the reference pauses on a distinct pose (local speed minima that differ from the previous
 * checkpoint), for "Follow" practice. Always returns at least one checkpoint.
 */
export function findCheckpoints(poseAt: (t: number) => FingerValues | null, duration: number, step = 0.05): number[] {
  const n = Math.max(2, Math.floor(duration / step));
  const poses: (FingerValues | null)[] = [];
  for (let i = 0; i <= n; i++) poses.push(poseAt(Math.min(duration, i * step)));
  const dist = (a: FingerValues, b: FingerValues) => FINGERS.reduce((s, f) => s + Math.abs(a[f] - b[f]), 0);
  const speed = poses.map((p, i) => (p && poses[i + 1] ? dist(p, poses[i + 1] as FingerValues) / step : 0));
  const out: number[] = [];
  let last: FingerValues | null = null;
  let lastT = -1;
  for (let i = 0; i < n; i++) {
    const p = poses[i];
    if (!p) continue;
    const isMin = (i === 0 || speed[i] <= speed[i - 1]) && speed[i] <= (speed[i + 1] ?? Infinity) && speed[i] < 80;
    if (!isMin || i * step - lastT < 0.3) continue;
    if (last && dist(p, last) < 25) continue;
    out.push(i * step);
    last = p;
    lastT = i * step;
    if (out.length >= 14) break;
  }
  return out.length ? out : [Math.min(duration, 0.5)];
}

export interface FollowState {
  /** Index of the checkpoint the ghost is heading to or waiting at. */
  index: number;
  /** Reference time in seconds. */
  refTime: number;
  /** Seconds the learner has matched continuously while the ghost waits. */
  held: number;
  waiting: boolean;
  done: boolean;
}

/** A fresh state at the start of the reference. */
export function startFollow(): FollowState {
  return { index: 0, refTime: 0, held: 0, waiting: false, done: false };
}

/** Advances the Follow state machine by `dt` seconds. The ghost walks to the next checkpoint, waits, and moves on after a matched hold. */
export function stepFollow(s: FollowState, dt: number, checkpoints: number[], matched: boolean): FollowState {
  if (s.done) return s;
  const target = checkpoints[s.index];
  if (!s.waiting) {
    s.refTime = Math.min(target, s.refTime + dt);
    if (s.refTime >= target - 1e-6) {
      s.waiting = true;
      s.held = 0;
    }
    return s;
  }
  s.held = matched ? s.held + dt : 0;
  if (s.held >= FOLLOW_HOLD_S) {
    if (s.index >= checkpoints.length - 1) s.done = true;
    else {
      s.index += 1;
      s.waiting = false;
      s.held = 0;
    }
  }
  return s;
}

/** Skips the current checkpoint, for a learner who is stuck. */
export function skipCheckpoint(s: FollowState, checkpoints: number[]): FollowState {
  s.held = FOLLOW_HOLD_S;
  return stepFollow(s, 0, checkpoints, true);
}
