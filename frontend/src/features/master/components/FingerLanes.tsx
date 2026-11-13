import { useEffect, useRef } from 'react';
import { FINGERS, type Finger, type HandFrame } from '../../../api';

interface FingerLanesProps {
  /** Polled every animation frame; return the hand to plot, or null for a gap. Must not set React state. */
  getHand: () => HandFrame | null;
  /** Seconds of history shown. */
  windowS?: number;
  label?: string;
}

/** Total flexion (radians) at which a lane reads full. */
const FULL_FLEXION = 4;
const NAMES: Record<Finger, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', little: 'Little' };

interface Palette {
  line: string;
  text: string;
  trace: string;
}

function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  return {
    line: css.getPropertyValue('--line').trim() || '#c3c6c8',
    text: css.getPropertyValue('--text-2').trim() || '#4a4c57',
    trace: css.getPropertyValue('--accent').trim() || '#1f2e78',
  };
}

/**
 * Five scrolling finger-flexion lanes drawn on a canvas straight from the frame stream.
 * Nothing here re-renders React: samples go into plain arrays and a requestAnimationFrame loop paints them.
 */
export function FingerLanes({ getHand, windowS = 6, label = 'Live finger flexion, one lane per finger' }: FingerLanesProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const getRef = useRef(getHand);
  getRef.current = getHand;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const samples: { t: number; v: number[] }[] = [];
    let palette = readPalette(cv);
    let paletteAt = 0;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;

    const fit = () => {
      dpr = window.devicePixelRatio || 1;
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const tNow = now / 1000;
      if (now - paletteAt > 1000) {
        palette = readPalette(cv);
        paletteAt = now;
      }
      const hand = getRef.current();
      if (hand) samples.push({ t: tNow, v: FINGERS.map((f) => Math.min(1, Math.max(0, (hand.flexion[f][0] + hand.flexion[f][1] + hand.flexion[f][2]) / FULL_FLEXION))) });
      while (samples.length && samples[0].t < tNow - windowS) samples.shift();

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const gutter = 76;
      const laneH = h / FINGERS.length;
      ctx.font = `700 15px "Alegreya Sans", system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      FINGERS.forEach((f, i) => {
        const top = i * laneH;
        ctx.strokeStyle = palette.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(gutter, top + laneH - 0.5);
        ctx.lineTo(w, top + laneH - 0.5);
        ctx.stroke();
        ctx.fillStyle = palette.text;
        ctx.fillText(NAMES[f], 6, top + laneH / 2);
        if (samples.length < 2) return;
        ctx.strokeStyle = palette.trace;
        ctx.lineWidth = 2;
        ctx.beginPath();
        samples.forEach((s, k) => {
          const x = gutter + ((s.t - (tNow - windowS)) / windowS) * (w - gutter);
          const y = top + laneH - 5 - s.v[i] * (laneH - 10);
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [windowS]);

  return <canvas ref={canvas} className="mst-lanes" role="img" aria-label={label} />;
}
