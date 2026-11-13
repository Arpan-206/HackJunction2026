import { useEffect, useRef } from 'react';
import type { StreamClock } from '../../hooks/useStreamClock';
import { NOTE_WINDOW_S, type NoteJudge, type NoteResult, type PhraseNote } from './piano';

const LOOK_AHEAD_S = 2.4;
const LOOK_BEHIND_S = 0.3;
const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'];

interface NoteLaneProps {
  label: string;
  notes: PhraseNote[];
  judge: NoteJudge;
  clock: StreamClock;
}

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Notes fall towards a hit line, one lane per finger. Drawn straight to a canvas each frame so React never re-renders. */
export function NoteLane({ label, notes, judge, clock }: NoteLaneProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    let raf = 0;
    let colours = { bg: '#fff', line: '#999', note: '#223', ok: '#2a7', bad: '#b33', text: '#111', accent: '#fc3', soft: '#eee' };
    let lastColourRead = 0;
    const results = new Map<number, NoteResult>();
    let seen = 0;

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (ts - lastColourRead > 1000) {
        lastColourRead = ts;
        colours = {
          bg: cssVar('--surface', '#f4f4f1'),
          line: cssVar('--line', '#c3c6c8'),
          note: cssVar('--accent', '#1f2e78'),
          ok: cssVar('--ok', '#2f7a57'),
          bad: cssVar('--danger', '#b2321b'),
          text: cssVar('--text', '#1c1d24'),
          accent: cssVar('--gold', '#d9b45a'),
          soft: cssVar('--surface-2', '#dfe1dd'),
        };
      }
      const now = clock.now();
      judge.expire(clock.lastFrame());
      for (; seen < judge.judged.length; seen++) results.set(judge.judged[seen].note.index, judge.judged[seen].result);

      ctx.fillStyle = colours.bg;
      ctx.fillRect(0, 0, w, h);
      const laneW = w / 5;
      const hitY = h - 90;
      ctx.strokeStyle = colours.line;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(i * laneW, 0);
        ctx.lineTo(i * laneW, h);
        ctx.stroke();
      }
      const bandTop = hitY - (NOTE_WINDOW_S / LOOK_AHEAD_S) * hitY;
      ctx.fillStyle = colours.soft;
      ctx.fillRect(0, bandTop, w, hitY - bandTop + (NOTE_WINDOW_S / LOOK_AHEAD_S) * hitY * 0.6);
      ctx.strokeStyle = colours.text;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, hitY);
      ctx.lineTo(w, hitY);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w, h - 52);
      ctx.clip();
      for (const n of notes) {
        const dt = n.time - now;
        if (dt > LOOK_AHEAD_S || dt < -LOOK_BEHIND_S) continue;
        const y = hitY - (dt / LOOK_AHEAD_S) * hitY;
        const x = (n.finger - 1) * laneW + laneW / 2;
        const res = results.get(n.index);
        ctx.globalAlpha = res === 'missed' ? 0.55 : 1;
        ctx.fillStyle = res === 'hit' ? colours.ok : res === 'wrong_finger' || res === 'missed' ? colours.bad : colours.note;
        const nw = laneW * 0.78;
        const nh = 40;
        ctx.beginPath();
        ctx.roundRect(x - nw / 2, y - nh / 2, nw, nh, 8);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.font = '600 24px "Cinzel", serif';
        ctx.fillText(String(n.finger), x, y + 1);
      }
      ctx.restore();
      ctx.fillStyle = colours.text;
      ctx.font = '600 17px "Alegreya Sans", sans-serif';
      FINGER_NAMES.forEach((name, i) => ctx.fillText(`${i + 1}  ${name}`, i * laneW + laneW / 2, h - 26));
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [clock, judge, notes]);

  return (
    <figure className="ap-lane">
      <figcaption className="ap-lane__cap">{label}</figcaption>
      <canvas ref={canvas} className="ap-lane__canvas" role="img" aria-label={`${label}: notes falling towards the hit line, one lane per finger`} />
    </figure>
  );
}
