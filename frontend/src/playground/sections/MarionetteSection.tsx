import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FINGERS, type Finger, type HandFrame, type MotionSpec } from '../../api/types';
import { Hand, HandCanvas, Keyboard, synthFrame, type HandHandle } from '../../three';
import { policyFor } from '../../features/apprentice/training/coach/fade';
import { statusOf, tension, zeroValues } from '../../features/apprentice/training/coach/deviation';
import type { Coach, CoachLive } from '../../features/apprentice/training/coach/useCoach';
import { FaultMarks } from '../../features/apprentice/training/modes/FaultMarks';
import { Crossbar, Strings } from '../../features/apprentice/training/modes/Strings';
import { MASTER_LIFT } from '../../features/apprentice/training/modes/types';
import { FingerTinter } from '../../features/apprentice/training/modes/useFingerTints';
import '../../features/apprentice/apprentice.css';
import { expr, toJsx } from '../jsx';
import { SectionLayout, SelectControl, SliderControl, ToggleControl } from '../controls';

const MASTER_MOTIONS: Record<string, MotionSpec> = {
  hold: { preset: 'hold_pose', pose: { thumb: 0.1, index: 0.15, middle: 0.15, ring: 0.15, little: 0.15 } },
  'finger sequence': { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 900 },
  pinch: { preset: 'pinch', fingers: [2], beat_ms: 1200 },
};
const LABEL: Record<Finger, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', little: 'Little' };
const DEG = Math.PI / 180;

/** Shifts every joint of each finger by a share of the given error in degrees (positive curls more). */
function withError(frame: HandFrame, errors: Record<Finger, number>): HandFrame {
  const flexion = { ...frame.flexion };
  for (const f of FINGERS) {
    const e = (errors[f] * DEG) / 3;
    const j = frame.flexion[f];
    flexion[f] = [j[0] + e, j[1] + e, j[2] + e];
  }
  return { ...frame, flexion };
}

/**
 * The real marionette guidance (Strings, Crossbar, FaultMarks, finger tints) fed by a hand-made coach, so each finger's error
 * can be set directly instead of coming from gloves.
 */
export default function MarionetteSection() {
  const [errors, setErrors] = useState<Record<Finger, number>>({ ...zeroValues(), ring: 38 });
  const [tolerance, setTolerance] = useState(18);
  const [attempt, setAttempt] = useState(1);
  const [motionName, setMotionName] = useState<keyof typeof MASTER_MOTIONS>('hold');
  const [masterStyle, setMasterStyle] = useState<'chalk' | 'ghost'>('chalk');
  const [keyboard, setKeyboard] = useState(false);
  const policy = useMemo(() => policyFor(attempt), [attempt]);
  const motion = MASTER_MOTIONS[motionName];

  const live = useRef<CoachLive>(makeLive(errors, tolerance));
  const coach = useMemo(() => ({ live }) as unknown as Coach, []);
  useLayoutEffect(() => {
    live.current = makeLive(errors, tolerance);
  }, [errors, tolerance]);

  const master = useRef<HandHandle>(null);
  const learner = useRef<HandHandle>(null);
  const errorsRef = useRef(errors);
  useLayoutEffect(() => {
    errorsRef.current = errors;
  }, [errors]);

  const jsx = [
    toJsx('Strings', { master: expr('master'), learner: expr('learner'), coach: expr('coach'), policy: expr(`policyFor(${attempt})`) }),
    toJsx('FaultMarks', { hand: expr('learner'), coach: expr('coach'), policy: expr(`policyFor(${attempt})`), toleranceDeg: tolerance }),
    `// finger error in degrees (positive curls more than the expert)`,
    `// ${FINGERS.map((f) => `${f} ${errors[f]}`).join(', ')}`,
  ].join('\n');

  return (
    <SectionLayout
      title="Marionette guidance"
      blurb="The expert's hand hangs from a wooden cross above the learner's wooden hand. A string joins each pair of fingertips: slack when right, taut and vermilion when wrong, with an inked ring on the offending fingertip."
      canvas
      jsx={jsx}
      specimen={
        <HandCanvas
          preset="single"
          label="The expert's hand hangs from a marionette cross above the wooden hand, with a string to each fingertip"
          stage={{ cameraPosition: [2.7, 3.5, 4.9], target: [0, 0.9, -0.85], circleCenter: [0, -0.5], controls: 'orbit' }}
        >
          <FingerTinter hand={master} coach={coach} policy={policy} goodTint={false} />
          {keyboard && <Keyboard handRef={learner} />}
          <Hand ref={learner} style="wood" getFrame={(t) => withError(synthFrame(motion, t, 'right'), errorsRef.current)} />
          <FaultMarks hand={learner} coach={coach} policy={policy} toleranceDeg={tolerance} />
          {policy.showMaster && (
            <>
              <Hand ref={master} style={masterStyle} position={[0, MASTER_LIFT, 0]} getFrame={(t) => synthFrame(motion, t, 'right')} />
              <Crossbar master={master} height={0.95} />
            </>
          )}
          <Strings master={master} learner={learner} coach={coach} policy={policy} />
        </HandCanvas>
      }
      controls={
        <>
          {FINGERS.map((f) => (
            <SliderControl key={f} label={`${LABEL[f]} error`} value={errors[f]} min={-60} max={60} onChange={(v) => setErrors((e) => ({ ...e, [f]: v }))} format={(v) => `${v} deg`} />
          ))}
          <SliderControl label="Tolerance" value={tolerance} min={6} max={40} onChange={setTolerance} format={(v) => `${v} deg`} />
          <SliderControl label="Attempt (fades the guidance)" value={attempt} min={1} max={3} onChange={setAttempt} />
          <p className="note">{policy.label}</p>
          <SelectControl label="Expert motion" value={motionName} options={Object.keys(MASTER_MOTIONS)} onChange={setMotionName} />
          <SelectControl label="Expert style" value={masterStyle} options={['chalk', 'ghost']} onChange={setMasterStyle} />
          <ToggleControl label="Keyboard prop" checked={keyboard} onChange={setKeyboard} />
        </>
      }
    />
  );
}

/** Builds the coach state the 3D components read: deviation, status and string tension per finger. */
function makeLive(errors: Record<Finger, number>, toleranceDeg: number): CoachLive {
  const status = { thumb: 'good', index: 'good', middle: 'good', ring: 'good', little: 'good' } as CoachLive['status'];
  const t = zeroValues();
  for (const f of FINGERS) {
    status[f] = statusOf(errors[f], toleranceDeg);
    t[f] = tension(errors[f], toleranceDeg);
  }
  return { learner: null, master: null, deviation: { ...errors }, status, tension: t, refTime: 0, hasLearner: true, shown: { status, deviation: { ...errors } } };
}
