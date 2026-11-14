import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type TutorialRate = 1 | 0.5;

/** One clock for the tutorial: the expert's video when there is one, else a clock of its own over one take. */
export interface TutorialClock {
  playing: boolean;
  /** Coarse position in seconds for the scrubber (a few updates a second). */
  time: number;
  /** Length in seconds of what the scrubber covers: the video, or one take. 0 until known. */
  duration: number;
  rate: TutorialRate;
  toggle: () => void;
  seek: (t: number) => void;
  setRate: (r: TutorialRate) => void;
  /** Exact position now, read every animation frame by the hand. */
  now: () => number;
  /** True once the video (or one loop of the take) has played to its end. */
  ended: boolean;
}

const VIEW_MS = 125;

/**
 * The expert's video is the clock: play, pause, seek and speed act on the element, and the hand reads its currentTime every
 * frame, so the two can never drift. The video starts paused (the browser blocks sound until the learner presses play).
 */
export function useVideoClock(video: RefObject<HTMLVideoElement>, src: string | null): TutorialClock {
  const [state, setState] = useState({ playing: false, time: 0, duration: 0, rate: 1 as TutorialRate, ended: false });

  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    const sync = () =>
      setState((s) => ({
        playing: !v.paused && !v.ended,
        time: v.currentTime,
        duration: Number.isFinite(v.duration) ? v.duration : s.duration,
        rate: v.playbackRate === 0.5 ? 0.5 : 1,
        ended: s.ended || v.ended,
      }));
    const events = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'ratechange', 'seeked', 'ended'];
    events.forEach((e) => v.addEventListener(e, sync));
    sync();
    return () => events.forEach((e) => v.removeEventListener(e, sync));
  }, [video, src]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) void v.play().catch(() => undefined);
    else v.pause();
  }, [video]);
  const seek = useCallback(
    (t: number) => {
      const v = video.current;
      if (v) v.currentTime = Math.max(0, t);
    },
    [video],
  );
  const setRate = useCallback(
    (r: TutorialRate) => {
      const v = video.current;
      if (v) v.playbackRate = r;
    },
    [video],
  );
  const now = useCallback(() => video.current?.currentTime ?? 0, [video]);
  return { ...state, toggle, seek, setRate, now };
}

/** Without a video: a clock over one take that loops while it plays, starting on its own at the given speed. */
export function useLoopClock(period: number, startRate: TutorialRate = 0.5): TutorialClock {
  const run = useRef({ base: 0, wall: performance.now(), playing: true, rate: startRate as TutorialRate });
  const [view, setView] = useState({ playing: true, time: 0, rate: startRate as TutorialRate, ended: false });

  const now = useCallback(() => {
    const r = run.current;
    const t = r.playing ? r.base + ((performance.now() - r.wall) / 1000) * r.rate : r.base;
    return period > 0 ? t % period : 0;
  }, [period]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const r = run.current;
      const raw = r.playing ? r.base + ((performance.now() - r.wall) / 1000) * r.rate : r.base;
      setView((v) => ({ playing: r.playing, time: period > 0 ? raw % period : 0, rate: r.rate, ended: v.ended || raw >= period }));
    }, VIEW_MS);
    return () => window.clearInterval(id);
  }, [period]);

  /** Folds the running time into the base so a change of state starts from where the hand is now. */
  const settle = useCallback(() => {
    const r = run.current;
    r.base = now();
    r.wall = performance.now();
  }, [now]);

  const toggle = useCallback(() => {
    settle();
    run.current.playing = !run.current.playing;
  }, [settle]);
  const seek = useCallback(
    (t: number) => {
      settle();
      run.current.base = Math.max(0, Math.min(period, t));
    },
    [settle, period],
  );
  const setRate = useCallback(
    (r: TutorialRate) => {
      settle();
      run.current.rate = r;
    },
    [settle],
  );
  return { playing: view.playing, time: view.time, duration: period, rate: view.rate, ended: view.ended, toggle, seek, setRate, now };
}

/**
 * Where the reference take is at a video time: the video plays `offset` seconds before the take starts, so the hand holds
 * the take's first frame until then, and the take loops while the expert keeps talking. The track wraps by itself.
 */
export function takeTimeAt(videoTime: number, offset: number): number {
  return Math.max(0, videoTime - offset);
}

/** m:ss for the scrubber. */
export function clockLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
