import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGloveStream, type Finger, type HandFrame, type Side } from '../../../../api';
import { Button } from '../../../../components/ui';
import { curlsToFlexion } from '../../../../three';
import { PropSwitch } from '../../../shared/PropSwitch';
import { useShowProps } from '../../../shared/sessionPrefs';
import { useMargin } from '../../../shared/settings';
import { useStreamClock } from '../../hooks/useStreamClock';
import { fingerForKey, fingerPhrase, keyLabel } from '../../typing/fingerMap';
import { correctionLine, KeystrokeMatcher, keyWindow, StrikeDetector, type KeyVerdict, type Strike } from '../../typing/strikes';
import { SimulatedStriker, strikeCurls } from '../../typing/typist';
import { TypingStage, type FingerMark } from '../../typing/TypingStage';

/** The line to copy; every letter of the alphabet, so every finger gets its turn. */
export const PRACTICE_LINE = 'the quick brown fox jumps over the lazy dog';
const SHOW_VERDICT_S = 1.4;

const wallS = () => performance.now() / 1000;

/** True when a key event belongs to a text field or a shortcut, which the typing mode leaves alone. */
function ignored(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return true;
  return Boolean(t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)));
}

/**
 * Type on your keyboard: the keyboard says which key went down, the gloves say which finger moved at that moment, and the two
 * are paired within the margin's window. That is a correction no keyboard can give on its own: "you pressed E with your left
 * index finger; use your left middle finger". Without gloves on, a simulated glove answers each key, mostly with the right
 * finger and now and then (seeded) with its neighbour, so the correction can still be seen.
 */
export function KeyboardTyping() {
  const gloves = useGloveStream(true);
  const clock = useStreamClock(gloves);
  const [showProps] = useShowProps();
  const [margin] = useMargin();
  const matcher = useMemo(() => new KeystrokeMatcher(keyWindow(margin)), [margin]);
  const detector = useRef(new StrikeDetector());
  const striker = useRef(new SimulatedStriker());
  const recent = useRef<Strike[]>([]);
  const [verdicts, setVerdicts] = useState<KeyVerdict[]>([]);
  const [pos, setPos] = useState(0);
  const [, setTick] = useState(0);

  const simulated = useCallback(() => !clock.live() || clock.simulated(), [clock]);

  useEffect(() => {
    gloves.setMotion({ preset: 'hold_pose', pose: { thumb: 0.2, index: 0.35, middle: 0.35, ring: 0.35, little: 0.3 } });
  }, [gloves, gloves.status]);

  // Real gloves: every strike they feel goes to the matcher on the page clock.
  useEffect(
    () =>
      gloves.onFrame((f) => {
        const strikes = detector.current.push(f);
        if (f.source === 'simulator') return;
        for (const s of strikes) matcher.strike({ ...s, t: wallS() });
      }),
    [gloves, matcher],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ignored(e)) return;
      const key = e.key;
      if (key.length !== 1 && !fingerForKey(key)) return;
      if (key === ' ') e.preventDefault();
      const t = wallS();
      matcher.key(key, t);
      if (simulated()) {
        const s = striker.current.strike(key, t);
        if (s) {
          matcher.strike(s);
          recent.current = [...recent.current.filter((x) => t - x.t < 1), s];
        }
      }
      setPos((p) => (PRACTICE_LINE[p] === key.toLowerCase() ? (p + 1) % PRACTICE_LINE.length : p));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [matcher, simulated]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const out = matcher.resolve(wallS());
      if (out.length) setVerdicts((v) => [...v, ...out].slice(-40));
      setTick((n) => n + 1);
    }, 60);
    return () => window.clearInterval(id);
  }, [matcher]);

  const simFrame = useCallback(
    (side: Side) => (): HandFrame | null =>
      simulated() ? { side, wrist_quat: [0, 0, 0, 1], wrist_pos: null, flexion: curlsToFlexion(strikeCurls(recent.current, side, wallS())) } : null,
    [simulated],
  );

  const judged = verdicts.filter((v) => v.result !== 'unmapped');
  const right = judged.filter((v) => v.result === 'right').length;
  const wrong = judged.filter((v) => v.result === 'wrong');
  const unseen = judged.filter((v) => v.result === 'unseen').length;
  const latest = verdicts[verdicts.length - 1] ?? null;
  const fresh = latest && wallS() - latest.t < SHOW_VERDICT_S ? latest : null;
  const next = PRACTICE_LINE[pos];
  const nextFinger = fingerForKey(next);

  const marks: Record<Side, Partial<Record<Finger, FingerMark>>> = { left: {}, right: {} };
  if (nextFinger) marks[nextFinger.side][nextFinger.finger] = 'cue';
  if (fresh?.used && fresh.result === 'right') marks[fresh.used.side][fresh.used.finger] = 'ok';
  if (fresh?.used && fresh.result === 'wrong') marks[fresh.used.side][fresh.used.finger] = 'off';

  return (
    <div className="ap-arena ty-arena">
      <div className="ap-arena__scene">
        <TypingStage
          solid={showProps}
          target={next}
          good={fresh?.result === 'right' ? fresh.key.toLowerCase() : null}
          hands={{
            left: { live: gloves.latest, getFrame: simFrame('left'), marks: marks.left },
            right: { live: gloves.latest, getFrame: simFrame('right'), marks: marks.right },
          }}
          label={`Your two wooden hands over a ${showProps ? 'keyboard' : 'keyboard sketched in chalk'}; type the line on your own keyboard`}
        />
        <div className="ty-line" aria-label={`Type: ${PRACTICE_LINE}`}>
          {[...PRACTICE_LINE].map((c, i) => (
            <span key={i} className={`ty-line__char ${i < pos ? 'ty-line__char--done' : i === pos ? 'ty-letter--now' : ''}`}>
              {c === ' ' ? ' ' : c}
            </span>
          ))}
        </div>
        {fresh && (
          <p className={`ty-callout ${fresh.result === 'wrong' ? 'ty-callout--off' : fresh.result === 'right' ? 'ty-callout--ok' : ''}`} role="status" aria-live="polite">
            {correctionLine(fresh)}
          </p>
        )}
      </div>
      <div className="ty-keys-side">
        <p className="ty-live">
          <span>
            <strong className="ap-num">{right}</strong> right finger
          </span>
          <span>
            <strong className="ap-num">{wrong.length}</strong> wrong finger
          </span>
          <span>
            <strong className="ap-num">{unseen}</strong> not felt
          </span>
        </p>
        {wrong.length > 0 && (
          <ul className="ty-fixes" aria-label="Corrections so far">
            {wrong.slice(-3).map((v) => (
              <li key={`${v.key}-${v.t}`}>{correctionLine(v)}</li>
            ))}
          </ul>
        )}
        <p className="note ty-note">
          {simulated()
            ? 'No gloves on: a simulated glove answers each key, mostly with the right finger and now and then with its neighbour, so you can see a correction.'
            : `The gloves name the finger that moved within ${Math.round(keyWindow(margin) * 1000)} ms of each key. They cannot see which key it reached; your keyboard tells them that.`}
          {nextFinger ? ` Next: ${keyLabel(next)}, ${fingerPhrase(nextFinger)}.` : ''}
        </p>
        <div className="ap-intro__foot">
          <PropSwitch prop="keyboard" />
          <Button
            variant="secondary"
            onClick={() => {
              setVerdicts([]);
              setPos(0);
            }}
          >
            Start the line again
          </Button>
        </div>
      </div>
    </div>
  );
}
