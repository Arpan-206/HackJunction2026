import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { FINGER_ROWS, FINGER_TINT, fingerName, HOME_KEYS, KEYBOARD_ROWS, normalizeKey, rowOfKey, SPACE } from './chart';
import { DRILLS } from './drills';
import { applyVerdict, done, lineFor, linkCore, newRun, pressKey, tally, totals, type FingerVerdict, type Run } from './typingRun';
import { useTypingCore } from './useTypingCore';
import './typing.css';

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '-';
}

/**
 * /typing: touch typing with the gloves. The keyboard says which key went down; the core's typing task says which
 * finger pressed it, so the screen can say "right key, wrong finger". Without the glove engine the screen still
 * checks keys and shows the chart finger for each one.
 */
export default function TypingScreen() {
  const [drillIdx, setDrillIdx] = useState(0);
  const drill = DRILLS[drillIdx];
  const [run, setRun] = useState<Run>(() => newRun(drill.text));
  const runRef = useRef(run);
  runRef.current = run;

  const onVerdict = useCallback((v: FingerVerdict) => setRun((r) => applyVerdict(r, v)), []);
  const core = useTypingCore(onVerdict);
  const gloves = core.status === 'open' && core.ready;

  const start = useCallback(
    (i: number) => {
      setDrillIdx(i);
      setRun(newRun(DRILLS[i].text));
      void core.resetTally();
    },
    [core],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (normalizeKey(e.key) === null) return;
      if (target?.tagName === 'BUTTON' && e.key === ' ') target.blur();
      e.preventDefault();
      const got = pressKey(runRef.current, e.key);
      if (!got) return;
      runRef.current = got.run;
      setRun(got.run);
      if (gloves) {
        void core.keystroke(e.key).then((id) => {
          if (id !== null) setRun((r) => linkCore(r, got.index, id));
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [core, gloves]);

  const rows = useMemo(() => tally(run), [run]);
  const all = useMemo(() => totals(run), [run]);
  const last = run.attempts[run.attempts.length - 1] ?? null;
  const line = last ? lineFor(last, gloves) : null;
  const nextKey = done(run) ? null : (normalizeKey(run.text[run.pos]) ?? null);
  const nextRow = nextKey !== null ? rowOfKey(nextKey) : null;

  const engineLine =
    core.status !== 'open'
      ? 'Glove engine not found. Keys are checked, fingers are not. Start it with python -m core.'
      : !core.ready
        ? (core.error ?? 'Switching the glove engine to typing…')
        : core.simulated
          ? 'The glove engine runs without gloves, so it imagines each press. Some presses come out wrong on purpose.'
          : 'The gloves are watching your fingers.';

  return (
    <div className="ty-screen">
      <PageHeader title="Touch typing" context="The keyboard knows the key. The gloves know the finger. Type the line below." />
      <div className="ty-grid">
        <section className="card ty-main" aria-label="Drill">
          <p className="ty-drill__title">{drill.title}</p>
          <p className="ty-drill__about">{drill.about}</p>
          <p className="ty-text" aria-label="Text to type">
            {[...run.text].map((ch, i) => {
              const cls = i < run.pos ? 'ty-ch ty-ch--done' : i === run.pos ? 'ty-ch ty-ch--now' : 'ty-ch';
              return (
                <span key={i} className={cls}>
                  {ch === ' ' ? ' ' : ch}
                </span>
              );
            })}
          </p>
          <p className={`ty-line ty-line--${line?.tone ?? 'plain'}`} aria-live="polite">
            {done(run)
              ? `Done. Right key ${pct(all.rightKey, all.keys)}, right finger ${pct(all.good, all.good + all.wrongFinger)}.`
              : (line?.text ?? (nextRow ? `Start with your ${fingerName(nextRow)}.` : ''))}
          </p>
          <Keyboard nextKey={nextKey} lastKey={last?.typed ?? null} lastOk={last ? last.keyOk && last.finger?.verdict !== 'wrong_finger' : true} />
          <p className="note ty-engine">{engineLine}</p>
          <div className="ty-actions">
            <button type="button" className="btn" onClick={() => start(drillIdx)}>
              Start again
            </button>
            {drillIdx + 1 < DRILLS.length && (
              <button type="button" className="btn btn--primary" onClick={() => start(drillIdx + 1)}>
                Next drill
              </button>
            )}
          </div>
        </section>
        <aside className="card ty-side" aria-label="Drills and finger accuracy">
          <h2 className="ty-h2">Drills</h2>
          <ol className="ty-drills">
            {DRILLS.map((d, i) => (
              <li key={d.id}>
                <button type="button" className={`ty-drillbtn${i === drillIdx ? ' ty-drillbtn--on' : ''}`} aria-current={i === drillIdx} onClick={() => start(i)}>
                  {d.title}
                </button>
              </li>
            ))}
          </ol>
          <h2 className="ty-h2">Each finger</h2>
          <table className="ty-tally">
            <thead>
              <tr>
                <th scope="col">Finger</th>
                <th scope="col">Keys</th>
                <th scope="col">Right key</th>
                <th scope="col">Right finger</th>
                <th scope="col">Unclear</th>
              </tr>
            </thead>
            <tbody>
              {FINGER_ROWS.map((r) => {
                const t = rows[r];
                return (
                  <tr key={r}>
                    <th scope="row">
                      <span className="ty-swatch" style={{ background: FINGER_TINT[r] }} aria-hidden="true" />
                      {fingerName(r).replace(' finger', '')}
                    </th>
                    <td>{t.keys}</td>
                    <td>{pct(t.rightKey, t.keys)}</td>
                    <td>{gloves ? pct(t.good, t.good + t.wrongFinger) : '-'}</td>
                    <td>{gloves ? t.unclear : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note">Right finger counts only the keys where the gloves saw one clear finger.</p>
        </aside>
      </div>
    </div>
  );
}

function Keyboard({ nextKey, lastKey, lastOk }: { nextKey: string | null; lastKey: string | null; lastOk: boolean }) {
  const cls = (k: string) => {
    const out = ['ty-key'];
    if (HOME_KEYS.has(k)) out.push('ty-key--home');
    if (k === nextKey) out.push('ty-key--next');
    if (k === lastKey && !lastOk) out.push('ty-key--fix');
    return out.join(' ');
  };
  return (
    <div className="ty-kb" role="img" aria-label="Keyboard coloured by finger. The next key has a dark outline.">
      {KEYBOARD_ROWS.map((row, i) => (
        <div key={i} className={`ty-kb__row ty-kb__row--${i}`}>
          {row.map((k) => {
            const r = rowOfKey(k);
            return (
              <span key={k} className={cls(k)} style={{ background: r ? FINGER_TINT[r] : undefined }}>
                {k.toUpperCase()}
              </span>
            );
          })}
        </div>
      ))}
      <div className="ty-kb__row ty-kb__row--space">
        <span className={cls(SPACE)} style={{ background: FINGER_TINT['both.thumb'] }}>
          space
        </span>
      </div>
    </div>
  );
}
