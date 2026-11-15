import { useEffect, useRef, useState } from 'react';
import type { Lesson, Side } from '../../api';
import { CalibrationPanel } from './CalibrationPanel';
import { useCalibration, type CalibrationHandle } from './useCalibration';

/** The hands a task uses: one hand, or both. */
export type TaskHands = Side | 'both';

/** Both hands' calibrations, so a page can read whether a hand is calibrated and the control can show it. */
export type HandCalibrations = Record<Side, CalibrationHandle>;

/** One calibration handle per hand. Always both, so the hook count never changes when a task switches hands. */
export function useHandCalibrations(): HandCalibrations {
  const left = useCalibration('left');
  const right = useCalibration('right');
  return { left, right };
}

/**
 * The hands a whole course uses: both when any step is two-handed, when steps use different hands, or when its test is
 * the typing test (both hands over the keys); otherwise the one hand every step names.
 */
export function lessonHands(lesson: Pick<Lesson, 'steps' | 'test'>): TaskHands {
  if (lesson.test?.kind === 'air_typing') return 'both';
  const used = new Set(lesson.steps.map((s) => s.hands));
  if (used.has('both') || (used.has('left') && used.has('right'))) return 'both';
  return used.has('left') ? 'left' : 'right';
}

const HAND_NAME: Record<Side, string> = { left: 'left hand', right: 'right hand' };

/** The control's line in plain words: which hand still needs calibrating. */
export function calibrationLine(hands: TaskHands, done: Record<Side, boolean>): string {
  const sides: Side[] = hands === 'both' ? ['right', 'left'] : [hands];
  const missing = sides.filter((s) => !done[s]);
  if (!missing.length) return hands === 'both' ? 'Hands calibrated' : 'Hand calibrated';
  if (missing.length === 2) return 'Calibrate your hands';
  return `Calibrate your ${HAND_NAME[missing[0]]}`;
}

interface CalibrateHandsProps {
  hands: TaskHands;
  /** From useHandCalibrations, when the page also needs to know; otherwise the control keeps its own. */
  cals?: HandCalibrations;
}

/** "Calibrate your hand" on every apprentice task: the expert's glove calibration, in the page header. */
export function CalibrateHands({ hands, cals }: CalibrateHandsProps) {
  return cals ? <CalibrateHandsView hands={hands} cals={cals} /> : <OwnCalibrateHands hands={hands} />;
}

function OwnCalibrateHands({ hands }: { hands: TaskHands }) {
  const cals = useHandCalibrations();
  return <CalibrateHandsView hands={hands} cals={cals} />;
}

/**
 * One line saying whether the task's hands are calibrated, which opens the guided calibration (flat hand, loose fist,
 * flat again). For a two-handed task the learner picks the hand to calibrate; the first one still missing is offered.
 */
function CalibrateHandsView({ hands, cals }: { hands: TaskHands; cals: HandCalibrations }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const done = { left: cals.left.latest !== null, right: cals.right.latest !== null };
  const loading = hands === 'both' ? cals.left.loading || cals.right.loading : cals[hands].loading;
  const [picked, setPicked] = useState<Side | null>(null);
  // A running calibration keeps its hand, even when finishing it moves the first missing hand on.
  const active: Side | null = cals.right.phase !== 'idle' ? 'right' : cals.left.phase !== 'idle' ? 'left' : null;
  const side: Side = hands !== 'both' ? hands : (active ?? picked ?? (!done.right ? 'right' : !done.left ? 'left' : 'right'));
  const cal = cals[side];
  const running = active !== null;
  const line = loading ? 'Checking your calibration...' : calibrationLine(hands, done);

  // Close on Escape or on a click outside, like any popover; a running calibration keeps it open.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = (e: Event) => {
      if (!el.open || running) return;
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener('keydown', close);
    document.addEventListener('pointerdown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('pointerdown', close);
    };
  }, [running]);

  const allDone = hands === 'both' ? done.left && done.right : done[hands];
  return (
    <details ref={ref} className="scr-gloves ap-head__calibrate">
      <summary className="scr-gloves__summary">
        <span className={`scr-gloves__dot scr-gloves__dot--${!loading && allDone ? 'on' : 'off'}`} aria-hidden="true" />
        {line}
      </summary>
      <div className="scr-gloves__panel">
        <p className="note">
          {allDone
            ? 'Calibrate again when someone else puts the gloves on, or when the hand on screen stops matching yours.'
            : 'Calibrate once per glove, like the expert does before recording. Until you do, scores assume an average hand.'}
        </p>
        <CalibrationPanel
          side={side}
          onSide={setPicked}
          cal={cal}
          compact
          hideSide={hands !== 'both'}
          title={hands === 'both' ? 'Calibrate a hand' : `Calibrate your ${HAND_NAME[side]}`}
          missingNote="Not calibrated yet."
        />
      </div>
    </details>
  );
}
