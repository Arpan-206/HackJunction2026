import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore, type MutableRefObject } from 'react';
import { FINGERS, type Finger, type GloveFrame, type HandFrame, type Side } from '../../../../api/types';
import type { GloveStreamHandle } from '../../../../api';
import { alignedDeviation, meanLagMs } from './alignment';
import { ClumsySim } from './clumsy';
import {
  applyDeadZone,
  flexionDegrees,
  matchMeter,
  MovingAverage,
  statusOf,
  tension,
  zeroValues,
  type CoachConfig,
  type FingerStatus,
  type FlagSnapshot,
  type FingerValues,
} from './deviation';
import { findCheckpoints, startFollow, stepFollow, skipCheckpoint, FOLLOW_HOLD_S, type FollowState } from './follow';
import { FrameWatch, lockedToGlove } from './frameClock';
import type { ReferenceTrack } from './reference';
import { algorithmicTip } from './tips';

export type PracticeMode = 'follow' | 'flow';

/** Mutable per-frame state read by 3D components inside useFrame. Never put it in React state. */
export interface CoachLive {
  learner: HandFrame | null;
  master: HandFrame | null;
  /** Signed, dead-zoned deviation in degrees (positive: curled more than the master). */
  deviation: FingerValues;
  status: Record<Finger, FingerStatus>;
  tension: FingerValues;
  refTime: number;
  hasLearner: boolean;
  /**
   * The snapshot last published to the coarse view (status and deviation). The correction label, the fault rings and the
   * finger tints read this, not the per-tick values, so they change in the same frame window as the match meter.
   */
  shown: FlagSnapshot;
  /** Fingers the step weights too little to correct: drawn dimmed, never marked off (CoachConfig.light). */
  light?: readonly Finger[];
}

/** Coarse snapshot (about 8 Hz) for the status row, tip and meter. */
export interface CoachView {
  deviation: FingerValues;
  status: Record<Finger, FingerStatus>;
  match: number;
  tip: string | null;
  lagMs: number;
  hasLearner: boolean;
  running: boolean;
  waiting: boolean;
  checkpoint: number;
  checkpoints: number;
  holdFraction: number;
  /** Progress through the reference cycle, 0 to 1. */
  cycle: number;
}

/** Totals gathered while an attempt runs, used for a local score when the backend is unreachable. */
export interface AttemptStats {
  seconds: number;
  /** Mean absolute deviation in degrees per finger. */
  meanAbs: FingerValues;
  /** Share of time each finger was inside the tolerance, 0 to 1. */
  inTolerance: FingerValues;
  meanLagMs: number;
  worst: Finger;
  worstDeviation: number;
  tip: string | null;
}

const ALL_GOOD: Record<Finger, FingerStatus> = { thumb: 'good', index: 'good', middle: 'good', ring: 'good', little: 'good' };
const SUSTAINED_OFF_S = 1.5;
const TICK_MS = 33;
const VIEW_MS = 125;
/** Upper bound on buffered attempt frames (about 30 Hz for two minutes), well inside the scorer's limit. */
const MAX_ATTEMPT_FRAMES = 4000;

export interface UseCoachOptions {
  track: ReferenceTrack | null;
  gloves: GloveStreamHandle;
  side: Side;
  config: CoachConfig;
  mode: PracticeMode;
  /** Dev aid: perturb live frames before comparison. */
  clumsy: boolean;
  /**
   * Other hands to keep in the recorded attempt frames, unperturbed, so a two-handed step can score both hands. The coach
   * itself still compares only `side`.
   */
  alsoRecord?: Side[];
  /** Called when one finger has stayed out of tolerance for 1.5 s (repeats every 1.5 s while it stays out). */
  onSustainedOff?: (info: { finger: Finger; deviation: FingerValues; lagMs: number }) => void;
  /** Playback speed of the reference in Flow practice (1 by default; the Watch stage plays at 0.5 first). */
  rate?: number;
  /** Called when Follow practice reaches its final checkpoint. */
  onFollowDone?: () => void;
  /**
   * Called once per attempt when the first learner frame is actually recorded. A phase-locked simulator only starts on the
   * next beat of the reference, so this can come up to one motion period after begin(); time the attempt from here.
   */
  onRecordStart?: () => void;
}

export interface Coach {
  live: MutableRefObject<CoachLive>;
  subscribe: (cb: () => void) => () => void;
  getView: () => CoachView;
  /** Starts timing an attempt from the beginning of the reference. */
  begin: () => void;
  /** Ends the attempt and returns what was measured. */
  end: () => AttemptStats;
  /** Moves a waiting Follow ghost on. */
  skip: () => void;
  /**
   * The learner frames actually compared during the last attempt (after any clumsy simulation), with `t` re-based so that
   * zero is the reference's first beat. Ready to send to the scorer as `attempt_frames`.
   */
  frames: () => GloveFrame[];
}

function initialView(): CoachView {
  return { deviation: zeroValues(), status: ALL_GOOD, match: 0, tip: null, lagMs: 0, hasLearner: false, running: false, waiting: false, checkpoint: 0, checkpoints: 0, holdFraction: 0, cycle: 0 };
}

/**
 * The algorithmic coach: every ~30 ms it compares a short moving average of the learner's finger flexion with the
 * reference at the best-aligned moment (within the timing tolerance), applies a tremor dead zone, and publishes the result
 * through a ref for 3D and a coarse store for the UI. Supports "follow" (the ghost waits at checkpoints) and "flow".
 */
export function useCoach(opts: UseCoachOptions): Coach {
  const { track, gloves, mode, clumsy } = opts;
  const live = useRef<CoachLive>({ learner: null, master: null, deviation: zeroValues(), status: ALL_GOOD, tension: zeroValues(), refTime: 0, hasLearner: false, shown: { status: ALL_GOOD, deviation: zeroValues() } });
  const viewRef = useRef<CoachView>(initialView());
  const listeners = useRef(new Set<() => void>());
  const optsRef = useRef(opts);
  optsRef.current = opts;
  live.current.light = opts.config.light ?? [];

  const sim = useRef(new ClumsySim());
  const avg = useRef(new MovingAverage(6));
  const run = useRef({
    running: false,
    startWall: performance.now(),
    clock: 0,
    follow: startFollow() as FollowState,
    lastTick: performance.now(),
    sums: { abs: zeroValues(), good: zeroValues(), lag: 0, lagN: 0, n: 0, seconds: 0 },
    offSince: {} as Partial<Record<Finger, number>>,
    lastView: 0,
    frames: [] as GloveFrame[],
    base: null as number | null,
    lagMs: 0,
    tip: null as string | null,
    watch: new FrameWatch(),
  });

  const checkpoints = useMemo(() => (track ? findCheckpoints((t) => track.flexionAt(t), track.period) : []), [track]);
  const cpRef = useRef(checkpoints);
  cpRef.current = checkpoints;

  useEffect(() => {
    run.current.follow = startFollow();
    run.current.startWall = performance.now();
    run.current.clock = 0;
    avg.current.reset();
    sim.current.reset();
  }, [track, mode, clumsy]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const r = run.current;
      const o = optsRef.current;
      const now = performance.now();
      const dt = Math.min(0.2, (now - r.lastTick) / 1000);
      r.lastTick = now;
      const trk = o.track;
      if (!trk) return;

      const frame: GloveFrame | null = gloves.latest.current;
      const raw = frame?.hands.find((h) => h.side === o.side) ?? null;
      let learner = raw;
      if (raw && o.clumsy) learner = sim.current.apply(raw, now / 1000);
      const L = live.current;
      L.learner = learner;
      L.hasLearner = Boolean(learner);

      // Reference clock. A simulated glove is phase-locked so the ghost and the simulator share a beat, but only while its
      // frames keep coming: once the stream stalls the wall clock takes over from where the glove's clock stood.
      const rate = o.rate ?? 1;
      r.clock += dt * rate;
      const lock = lockedToGlove(frame, r.watch.fresh(frame, now), trk.periodic, rate);
      if (lock && frame) r.clock = frame.t;
      let refTime: number;
      if (o.mode === 'follow') {
        const matched = r.running && FINGERS.every((f) => L.status[f] === 'good') && L.hasLearner;
        if (r.running) stepFollow(r.follow, dt, cpRef.current, matched);
        else r.follow = { ...startFollow(), refTime: cpRef.current[0] ?? 0, waiting: true };
        refTime = r.follow.refTime;
        if (r.follow.done && r.running) {
          r.running = false;
          o.onFollowDone?.();
        }
      } else {
        refTime = lock && frame ? frame.t : r.clock;
      }
      L.refTime = refTime;
      if (r.running && learner && frame && r.frames.length < MAX_ATTEMPT_FRAMES) {
        // The scorer re-bases the first frame to zero, so a phase-locked attempt starts on the next beat of the reference.
        // Follow practice drives its own reference clock from zero, so only Flow waits for the beat.
        r.base ??= lock && o.mode === 'flow' && trk.period > 0 ? Math.ceil(refTime / trk.period) * trk.period : 0;
        if (refTime >= r.base - 1e-6) {
          if (r.frames.length === 0) o.onRecordStart?.();
          const others = (o.alsoRecord ?? []).flatMap((s) => (s === o.side ? [] : frame.hands.filter((h) => h.side === s)));
          r.frames.push({ t: Math.max(0, refTime - r.base), source: frame.source, hands: [learner, ...others] });
        }
      }
      L.master = trk.handAt(refTime);

      if (learner && trk) {
        const smooth = avg.current.push(flexionDegrees(learner));
        const window = o.mode === 'flow' ? o.config.timingMs / 1000 : 0;
        const aligned = alignedDeviation(smooth, (t) => trk.flexionAt(t), refTime, window);
        if (aligned) {
          const dev = zeroValues();
          const ten = zeroValues();
          const status = { ...ALL_GOOD };
          for (const f of FINGERS) {
            dev[f] = applyDeadZone(aligned.deviation[f], o.config.deadZoneDeg);
            // a finger the step weights too little is never marked off: no tint, ring, string pull or tip
            const light = o.config.light?.includes(f) ?? false;
            const band = o.config.fingerToleranceDeg[f];
            status[f] = light ? 'good' : statusOf(dev[f], band);
            ten[f] = light ? 0 : tension(dev[f], band);
          }
          L.deviation = dev;
          L.status = status;
          L.tension = ten;
          r.lagMs = meanLagMs(aligned.lagMs);

          if (r.running) {
            const s = r.sums;
            s.seconds += dt;
            s.n += 1;
            for (const f of FINGERS) {
              s.abs[f] += Math.abs(dev[f]);
              s.good[f] += status[f] === 'good' ? 1 : 0;
            }
            s.lag += r.lagMs;
            s.lagN += 1;
          }
          const t = now / 1000;
          for (const f of FINGERS) {
            if (status[f] === 'good') delete r.offSince[f];
            else {
              r.offSince[f] ??= t;
              if (t - (r.offSince[f] as number) > SUSTAINED_OFF_S) {
                r.offSince[f] = t;
                o.onSustainedOff?.({ finger: f, deviation: dev, lagMs: r.lagMs });
              }
            }
          }
          r.tip = algorithmicTip(dev, o.config.fingerToleranceDeg, r.lagMs, o.config.timingMs, o.config.light);
        }
      }

      if (now - r.lastView >= VIEW_MS) {
        r.lastView = now;
        const cps = cpRef.current.length;
        L.shown = { status: L.status, deviation: L.deviation };
        viewRef.current = {
          deviation: L.deviation,
          status: L.status,
          match: matchMeter(L.deviation, o.config.fingerToleranceDeg, o.config.light),
          tip: r.tip,
          lagMs: r.lagMs,
          hasLearner: L.hasLearner,
          running: r.running,
          waiting: o.mode === 'follow' && r.follow.waiting,
          checkpoint: Math.min(cps, r.follow.index + 1),
          checkpoints: cps,
          holdFraction: o.mode === 'follow' ? Math.min(1, r.follow.held / FOLLOW_HOLD_S) : 0,
          cycle: trk.period > 0 ? (((refTime % trk.period) + trk.period) % trk.period) / trk.period : 0,
        };
        listeners.current.forEach((l) => l());
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [gloves.latest]);

  const begin = useCallback(() => {
    const r = run.current;
    r.sums = { abs: zeroValues(), good: zeroValues(), lag: 0, lagN: 0, n: 0, seconds: 0 };
    r.offSince = {};
    r.frames = [];
    r.base = null;
    r.follow = startFollow();
    r.startWall = performance.now();
    r.clock = 0;
    r.running = true;
  }, []);

  const end = useCallback((): AttemptStats => {
    const r = run.current;
    r.running = false;
    const n = Math.max(1, r.sums.n);
    const meanAbs = zeroValues();
    const inTol = zeroValues();
    const light = optsRef.current.config.light ?? [];
    const named = FINGERS.filter((f) => !light.includes(f));
    let worst: Finger = named.includes('index') ? 'index' : (named[0] ?? 'index');
    for (const f of FINGERS) {
      meanAbs[f] = r.sums.abs[f] / n;
      inTol[f] = r.sums.good[f] / n;
      if (!light.includes(f) && meanAbs[f] > meanAbs[worst]) worst = f;
    }
    return {
      seconds: r.sums.seconds,
      meanAbs,
      inTolerance: inTol,
      meanLagMs: r.sums.lagN ? r.sums.lag / r.sums.lagN : 0,
      worst,
      worstDeviation: live.current.deviation[worst],
      tip: r.tip,
    };
  }, []);

  const skip = useCallback(() => {
    skipCheckpoint(run.current.follow, cpRef.current);
  }, []);

  const frames = useCallback((): GloveFrame[] => run.current.frames, []);

  const subscribe = useCallback((cb: () => void) => {
    listeners.current.add(cb);
    return () => {
      listeners.current.delete(cb);
    };
  }, []);
  const getView = useCallback(() => viewRef.current, []);

  return useMemo(() => ({ live, subscribe, getView, begin, end, skip, frames }), [subscribe, getView, begin, end, skip, frames]);
}

/** Subscribes a component to the coach's coarse (about 8 Hz) view. */
export function useCoachView(coach: Coach): CoachView {
  return useSyncExternalStore(coach.subscribe, coach.getView);
}
