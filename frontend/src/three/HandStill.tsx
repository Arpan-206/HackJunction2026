import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTheme } from '../theme';
import type { CameraPreset } from './Stage';
import { getStillQueue, keyOf, requestStill, stillDpr, type StillPicture, type StillStage } from './stillRenderer';

interface HandStillProps {
  className?: string;
  preset?: CameraPreset;
  /** Accessible description of the picture. */
  label: string;
  /**
   * Names what the scene shows: the pose, the side, the hand style and any prop. Two stills with the same id, preset,
   * theme and size are the same picture, drawn once and kept.
   */
  stillId: string;
  /** Scene contents, typically a <Hand> with a fixed frame and an optional prop. */
  children: ReactNode;
  /** Bench and wall behind the hand. Default: on when the box is at least 300 px wide. */
  decor?: boolean;
  /** Camera and bench overrides for this picture; the rest comes from the preset. Part of the picture's key. */
  stage?: StillStage;
}

/** How near the viewport (in px) a still starts to draw, so the picture is ready before it scrolls in. */
const NEAR_PX = 600;
/** A resize settles for this long before the picture is drawn again at the new size. */
const RESIZE_SETTLE_MS = 150;

/**
 * A fixed pose as a plain picture. The hand is drawn once by one shared offscreen renderer (stillRenderer.tsx), queued
 * so the page is never blocked, and shown as an ordinary <img> that scrolls with the page like any image, so it cannot
 * slide out of its box. Until it is ready the box shows the stage colour at its final size (no layout shift); a new theme
 * or size draws a new picture while the old one stays up.
 */
export function HandStill({ className, preset = 'closeup', label, stillId, children, decor, stage }: HandStillProps) {
  const { stage: colors } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  const [near, setNear] = useState(false);
  const [pic, setPic] = useState<StillPicture | null>(null);
  const content = useRef(children);
  content.current = children;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(el.clientWidth || r.width);
      const h = Math.round(el.clientHeight || r.height);
      if (w > 0 && h > 0) setSize((s) => (s && s[0] === w && s[1] === h ? s : [w, h]));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(read, RESIZE_SETTLE_MS);
    });
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: `${NEAR_PX}px` });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const withDecor = decor ?? (size !== null && size[0] >= 300);
  const colorsKey = JSON.stringify(colors);
  const stageKey = stage ? JSON.stringify(stage) : '';
  useEffect(() => {
    if (!size || !near) return;
    const dpr = stillDpr(window.devicePixelRatio);
    const { req } = requestStill(stillId, { width: size[0], height: size[1], dpr, preset, decor: withDecor, colors, content: content.current, stage });
    let live = true;
    void req.promise.then((p) => {
      if (live && p) setPic(p);
    });
    return () => {
      live = false;
      req.cancel();
    };
    // colors is represented by colorsKey and stage by stageKey: either may be a fresh reference with the same values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, near, stillId, preset, withDecor, colorsKey, stageKey]);

  // A picture already drawn for this exact key shows on the first paint (coming back to a page, no blank frame); otherwise
  // the previous picture stays up until the new one is ready. Pictures are revoked only when the cache is cleared, never
  // here: another card may share the same one.
  const cached = size ? getStillQueue().get(keyOf(stillId, { width: size[0], height: size[1], dpr: stillDpr(window.devicePixelRatio), preset, decor: withDecor, colors, stage })) : undefined;
  const shown = cached ?? pic;
  return (
    <div ref={box} className={`hand-still${className ? ` ${className}` : ''}`} role="img" aria-label={label} data-ready={shown ? 'true' : 'false'}>
      {shown && <img className={`hand-still__img${cached ? '' : ' hand-still__img--in'}`} src={shown.url} alt="" draggable={false} decoding="async" />}
    </div>
  );
}

/** Forgets every drawn still, for a hot reload or a test. */
export function clearStills(): void {
  getStillQueue().clear();
}
