import { useEffect, useRef, useState } from 'react';
import { useMediaSrc, type MediaRef } from '../../../api';
import type { Coach } from './coach/useCoach';

const KEY = 'apprentice.takeVideo';
const CHECK_MS = 200;
/** Seconds the video may stray from the reference before it is moved back. */
const MAX_DRIFT_S = 0.3;

/** Whether the learner keeps the expert's take video beside the stage (remembered on this device; on by default). */
export function useTakeVideoPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      window.localStorage.setItem(KEY, v ? 'on' : 'off');
    } catch {
      /* storage unavailable: the choice lasts this page */
    }
  };
  return [on, set];
}

interface TakeVideoPipProps {
  video: MediaRef;
  coach: Coach;
  /** Length of the reference take in seconds: the reference loops over it, and so does the video. */
  period: number;
  /** Playback speed of the reference (0.5 while watching slowly). */
  rate: number;
  onHide: () => void;
}

/**
 * The webcam filmed during the expert's reference take, small in the stage's corner. It follows the reference clock the
 * ghost plays from: a light check five times a second keeps it within 0.3 s and pauses it while a Follow ghost waits, so
 * the 30 Hz coach loop and the 3D hands are never touched.
 */
export function TakeVideoPip({ video, coach, period, rate, onHide }: TakeVideoPipProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const src = useMediaSrc(video.url);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    let lastRef = Number.NaN;
    const id = window.setInterval(() => {
      const refTime = coach.live.current.refTime;
      const p = Math.max(0.1, period);
      const target = Math.max(0, video.offset_s + (((refTime % p) + p) % p));
      if (v.playbackRate !== rate) v.playbackRate = rate;
      const moving = refTime !== lastRef;
      lastRef = refTime;
      if (!moving) {
        if (!v.paused) v.pause();
      } else if (v.paused) {
        void v.play().catch(() => undefined);
      }
      if (Math.abs(v.currentTime - target) > MAX_DRIFT_S && v.readyState >= 1) v.currentTime = target;
    }, CHECK_MS);
    return () => window.clearInterval(id);
  }, [coach, src, period, rate, video.offset_s]);

  if (!src) return null;
  return (
    <figure className="ap-pip">
      <video ref={ref} className="ap-pip__video" src={src} muted playsInline preload="auto" aria-label="The expert's camera during this take, in time with the expert's hand" />
      <figcaption className="ap-pip__bar">
        <span className="ap-pip__cap">The expert, filmed</span>
        <button type="button" className="ap-pip__hide" onClick={onHide} aria-label="Hide the expert's video">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </figcaption>
    </figure>
  );
}
