/**
 * Shared playback of recorded or synthesised glove frames, used by the master replay and the apprentice ghost.
 * Frames are interpolated per joint so playback stays smooth at any render rate.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Finger, GloveFrame, HandFrame, JointTriple, Side } from '../../api/types';

const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpTriple(a: JointTriple, b: JointTriple, k: number): JointTriple {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

/** Normalised linear interpolation between two quaternions, taking the short way round. */
function nlerpQuat(a: HandFrame['wrist_quat'], b: HandFrame['wrist_quat'], k: number): HandFrame['wrist_quat'] {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const q: HandFrame['wrist_quat'] = [lerp(a[0], s * b[0], k), lerp(a[1], s * b[1], k), lerp(a[2], s * b[2], k), lerp(a[3], s * b[3], k)];
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
}

/** Interpolates one hand between two frames. */
export function lerpHand(a: HandFrame, b: HandFrame, k: number): HandFrame {
  const flexion = {} as HandFrame['flexion'];
  for (const f of FINGERS) flexion[f] = lerpTriple(a.flexion[f], b.flexion[f], k);
  return {
    side: a.side,
    wrist_quat: nlerpQuat(a.wrist_quat, b.wrist_quat, k),
    wrist_pos: a.wrist_pos && b.wrist_pos ? [lerp(a.wrist_pos[0], b.wrist_pos[0], k), lerp(a.wrist_pos[1], b.wrist_pos[1], k), lerp(a.wrist_pos[2], b.wrist_pos[2], k)] : a.wrist_pos,
    flexion,
  };
}

/** Duration of a frame list in seconds, measured from its first timestamp. */
export function framesDuration(frames: GloveFrame[]): number {
  if (frames.length < 2) return 0;
  return frames[frames.length - 1].t - frames[0].t;
}

/**
 * Returns the hand of the given side at time `t` (seconds from the first frame), interpolated.
 * Falls back to the first hand in the frame when that side is missing.
 */
export function handAt(frames: GloveFrame[], t: number, side: Side): HandFrame | null {
  if (!frames.length) return null;
  const t0 = frames[0].t;
  const target = t0 + t;
  let lo = 0;
  let hi = frames.length - 1;
  if (target <= frames[0].t) hi = 0;
  else if (target >= frames[hi].t) lo = hi;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= target) lo = mid;
      else hi = mid;
    }
  }
  const pick = (f: GloveFrame) => f.hands.find((h) => h.side === side) ?? f.hands[0] ?? null;
  const a = pick(frames[lo]);
  const b = pick(frames[hi]);
  if (!a || !b) return a ?? b;
  if (lo === hi) return a;
  const k = (target - frames[lo].t) / (frames[hi].t - frames[lo].t || 1);
  return lerpHand(a, b, k);
}

export interface PlaybackControls {
  /** Pass to `<Hand getFrame>`; reads the clock without re-rendering React. */
  getFrame: (side: Side) => HandFrame | null;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  rate: number;
  setRate: (rate: number) => void;
  duration: number;
  /** Current position in seconds, updated at about 10 Hz for scrubbers (once frames are given, unless tick is false). */
  position: number;
}

/**
 * Plays a frame list on a wall clock. Loops by default. The 3D layer polls `getFrame` every render frame;
 * React only re-renders for the coarse `position` value.
 */
export function usePlayback(frames: GloveFrame[] | null, opts: { loop?: boolean; autoPlay?: boolean; tick?: boolean } = {}): PlaybackControls {
  const loop = opts.loop ?? true;
  // A caller that never shows `position` passes tick: false, so the 10 Hz position updates never re-render it.
  const tick = opts.tick ?? true;
  const [playing, setPlaying] = useState(opts.autoPlay ?? true);
  const [rate, setRate] = useState(1);
  const [position, setPosition] = useState(0);
  const clock = useRef({ base: 0, startedAt: performance.now() });
  const duration = frames ? framesDuration(frames) : 0;

  const now = useCallback((): number => {
    const c = clock.current;
    let t = playing ? c.base + ((performance.now() - c.startedAt) / 1000) * rate : c.base;
    if (duration > 0) t = loop ? t % duration : Math.min(t, duration);
    return t;
  }, [playing, rate, duration, loop]);

  useEffect(() => {
    clock.current = { base: 0, startedAt: performance.now() };
    setPosition(0);
  }, [frames]);

  // Nothing to play (no frames yet) or nobody reading the position: no ticks, so the caller does not re-render at 10 Hz.
  const ticking = tick && frames !== null;
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setPosition(now()), 100);
    return () => window.clearInterval(id);
  }, [now, ticking]);

  const freeze = useCallback(() => {
    clock.current = { base: now(), startedAt: performance.now() };
  }, [now]);

  const getFrame = useCallback((side: Side) => (frames ? handAt(frames, now(), side) : null), [frames, now]);

  return {
    getFrame,
    playing,
    play: () => { freeze(); setPlaying(true); },
    pause: () => { freeze(); setPlaying(false); },
    toggle: () => { freeze(); setPlaying((p) => !p); },
    seek: (s: number) => { clock.current = { base: Math.max(0, s), startedAt: performance.now() }; setPosition(s); },
    rate,
    setRate: (r: number) => { freeze(); setRate(r); },
    duration,
    position,
  };
}
