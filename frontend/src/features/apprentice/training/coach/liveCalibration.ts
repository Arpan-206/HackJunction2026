import type { Calibration, Finger, HandFrame } from '../../../../api/types';
import { calibrateAttempt, calibrationMasks } from '../../../../mock/scoring';
import { FINGER_NAMES } from '../../../../mock/synth';
import type { FingerValues } from './deviation';

const RAD2DEG = 180 / Math.PI;

/**
 * The learner's calibration, applied to the live comparison exactly as the scorer applies it to the attempt.
 *
 * Why: POST /score normalises the attempt by the learner's own flat and fist poses (`use_latest_calibration`), while
 * the live meter compared raw glove angles. So the number during a rep and the score after it could differ by 20
 * points or more, in either direction, depending on how the fist was made at calibration. With this, both read the
 * same calibrated angles. The maths is the scorer's own port (mock/scoring.ts, `calibrateAttempt` and
 * `calibrationMasks`), not a second copy.
 */
export interface LiveCalibration {
  /** The learner's total flexion per finger in degrees, calibrated, over the joints the calibration can read. */
  learner: (hand: HandFrame) => FingerValues;
  /** The reference's total flexion per finger in degrees over the same joints, so both sides drop the same ones. */
  reference: (hand: HandFrame) => FingerValues;
  /** 1 for a finger the calibration can read, 0 for one it cannot (the scorer gives that finger weight 0). */
  fingers: Record<Finger, number>;
}

/**
 * Null when there is no calibration, or when it lacks a flat or a fist pose: the scorer then scores without
 * calibration, and so does the live meter.
 */
export function liveCalibration(cal: Calibration | null | undefined): LiveCalibration | null {
  if (!cal) return null;
  const masks = calibrationMasks(cal);
  if (!masks) return null;
  const total = (joints: number[][]): FingerValues => {
    const out = {} as FingerValues;
    FINGER_NAMES.forEach((f, fi) => {
      let sum = 0;
      for (let j = 0; j < 3; j++) if (masks.joints[fi][j]) sum += joints[fi][j];
      out[f] = sum * RAD2DEG;
    });
    return out;
  };
  const jointsOf = (hand: HandFrame): number[][] => FINGER_NAMES.map((f) => [...hand.flexion[f]]);
  return {
    learner: (hand) => total(calibrateAttempt([jointsOf(hand)], cal, null, [])[0]),
    reference: (hand) => total(jointsOf(hand)),
    fingers: masks.fingers,
  };
}

/** The step's weights with the fingers the calibration cannot read set to 0, as the scorer does. */
export function calibratedWeights(
  weights: Record<Finger, number> | undefined,
  live: LiveCalibration | null,
): Record<Finger, number> | undefined {
  if (!live) return weights;
  const out = {} as Record<Finger, number>;
  for (const f of FINGER_NAMES) out[f] = (weights?.[f] ?? 1) * live.fingers[f];
  return out;
}
