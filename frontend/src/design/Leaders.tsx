import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { AnchorBoard } from './scene';

export interface LeaderNote {
  /** Anchor id on the board. */
  id: string;
  /** Number in the study disc; omit for an unnumbered tag. */
  n?: number | string;
  /** Which gutter of the stage the label sits in. */
  side: 'left' | 'right';
  /** Label position: px from the top of the stage, or a CSS length. */
  top: number | string;
  /** Inset from the stage side, px. Default 18. */
  inset?: number;
  title: ReactNode;
  body?: ReactNode;
  /** fix: the one correction (vermilion). ok: correct (malachite). */
  tone?: 'ink' | 'fix' | 'ok';
  width?: number;
}

/**
 * Study notes on hand-drawn leader lines. Labels sit in the stage gutters (never on the hand); each line runs from its
 * label to a 3D point projected every frame, so the notes stay pinned while the hand moves or the view orbits.
 */
export function Leaders({ board, notes, world }: { board: AnchorBoard; notes: LeaderNote[]; world: 'codex' | 'field' }) {
  const layer = useRef<HTMLDivElement>(null);
  const labels = useRef<(HTMLDivElement | null)[]>([]);
  const paths = useRef<(SVGPathElement | null)[]>([]);
  const halos = useRef<(SVGPathElement | null)[]>([]);
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const rings = useRef<(SVGCircleElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      notes.forEach((note, i) => {
        const el = labels.current[i];
        const p = board.points.get(note.id);
        const path = paths.current[i];
        const dot = dots.current[i];
        const ring = rings.current[i];
        if (!el || !path || !dot || !ring) return;
        const halo = halos.current[i];
        if (!p) {
          path.setAttribute('d', '');
          halo?.setAttribute('d', '');
          return;
        }
        const left = note.side === 'left';
        const sx = left ? el.offsetLeft + el.offsetWidth : el.offsetLeft;
        const sy = el.offsetTop + Math.min(el.offsetHeight / 2, 30);
        const dx = p.x - sx;
        // A quill stroke: leaves the label level, then bends down to the joint with a slight belly.
        const c1x = sx + dx * 0.45;
        const c2x = p.x - dx * 0.18;
        const c2y = p.y + (sy - p.y) * 0.25;
        const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} C${c1x.toFixed(1)} ${sy.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
        path.setAttribute('d', d);
        halo?.setAttribute('d', d);
        dot.setAttribute('cx', p.x.toFixed(1));
        dot.setAttribute('cy', p.y.toFixed(1));
        ring.setAttribute('cx', p.x.toFixed(1));
        ring.setAttribute('cy', p.y.toFixed(1));
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [board, notes]);

  return (
    <div ref={layer} className={`lead lead--${world}`} aria-label="Study notes">
      <svg className="lead__svg" aria-hidden="true">
        {notes.map((note, i) => (
          <g key={note.id + i} className={`lead__line lead__line--${note.tone ?? 'ink'}`}>
            <path ref={(e) => (halos.current[i] = e)} className="lead__halo" />
            <path ref={(e) => (paths.current[i] = e)} />
            <circle ref={(e) => (rings.current[i] = e)} r={note.tone === 'fix' ? 15 : 8} className="lead__ring" />
            <circle ref={(e) => (dots.current[i] = e)} r={3.6} className="lead__dot" />
          </g>
        ))}
      </svg>
      {notes.map((note, i) => {
        const style: CSSProperties = { top: note.top, width: note.width };
        style[note.side] = note.inset ?? 18;
        return (
          <div key={note.id + i} ref={(e) => (labels.current[i] = e)} className={`lead__label lead__label--${note.side} lead__label--${note.tone ?? 'ink'}`} style={style}>
            {note.n !== undefined && <span className="lead__n">{note.n}</span>}
            <span className="lead__text">
              <b>{note.title}</b>
              {note.body && <span>{note.body}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
