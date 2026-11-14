import { FINGERS, type CalibrationCapturePhase, type Finger, type HandFrame, type JointTriple, type Side } from '../../../api/types';
import type { CoreHint, CoreScore } from '../../../api/useCoreSession';

/** One pose of the guest calibration. */
export interface GuestPose {
  id: CalibrationCapturePhase;
  title: string;
  /** What the visitor does, one short imperative sentence. */
  say: string;
}

/**
 * The three poses, in order. Flat also gives the neutral offsets and the heading zero; the thumb-folded pose gives the
 * thumb its real range, which a loose fist does not (the thumb moves only about 14 degrees from flat to fist).
 */
export const GUEST_POSES: GuestPose[] = [
  { id: 'flat', title: 'Flat hand', say: 'Lay your hand flat on the table, palm down.' },
  { id: 'fist', title: 'Fist', say: 'Close your hand into a loose fist.' },
  { id: 'thumb', title: 'Thumb folded', say: 'Open your hand flat again and fold your thumb across your palm.' },
];

/** Seconds to get into each pose, then seconds held still while it is captured. */
export const READY_S = 2;
export const HOLD_S = 3;
/** The whole guest calibration as the visitor sees it, about 20 seconds with the saves. */
export const GUEST_TOTAL_S = GUEST_POSES.length * (READY_S + HOLD_S);

/** A wearer name for one visitor: unique per minute of the day, short enough for the backend's 40 characters. */
export function guestName(at: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `Guest ${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}`;
}

/** The hands to calibrate: those in the latest glove frame, or the right hand when none streams yet. */
export function sidesFrom(hands: { side: Side }[] | undefined): Side[] {
  const found = [...new Set((hands ?? []).map((h) => h.side))].sort() as Side[];
  return found.length ? found : ['right'];
}

const FINGER_WORD: Record<Finger, string> = { thumb: 'thumb', index: 'index finger', middle: 'middle finger', ring: 'ring finger', little: 'little finger' };

/** One correction for the worst finger, or null when there is nothing to fix. */
export function hintLine(finger: Finger | null, hint: CoreHint | null): string | null {
  if (!finger || !hint) return null;
  const f = FINGER_WORD[finger];
  switch (hint) {
    case 'too_flat':
      return `Curl your ${f} more.`;
    case 'too_curled':
      return `Straighten your ${f}.`;
    case 'too_spread':
      return `Bring your ${f} in.`;
    case 'too_closed':
      return `Spread your ${f} out.`;
    default:
      return null;
  }
}

/** A score from 0 to 1 shown as a whole number from 0 to 100; null shows as a dash. */
export function shownScore(overall: number | null | undefined): number | null {
  if (overall === null || overall === undefined || !Number.isFinite(overall)) return null;
  return Math.round(Math.min(1, Math.max(0, overall)) * 100);
}

/** At or above this a finger, or the whole hand, counts as matching (SPEC.md: green at 0.85). */
export const MATCH_AT = 0.85;

const RAD = Math.PI / 180;
/** The core's compat layer has no thumb CMC angle in a lesson's key angles; a relaxed stand-in. */
const THUMB_CMC_RAD = 0.35;

/**
 * The target hand for a core lesson step, from its 18 `key_angles` in degrees (SPEC.md "Angle features": thumb MCP and
 * IP, then MCP, PIP and DIP per finger, then four spreads), in the GloveFrame layout core/compat.py sends.
 */
export function handFromKeyAngles(angles: number[] | null | undefined, side: Side): HandFrame | null {
  if (!angles || angles.length < 18 || angles.some((a) => !Number.isFinite(a))) return null;
  const r = angles.map((a) => a * RAD);
  const triple = (i: number): JointTriple => [r[i], r[i + 1], r[i + 2]];
  return {
    side,
    wrist_quat: [0, 0, 0, 1],
    wrist_pos: null,
    flexion: { thumb: [THUMB_CMC_RAD, r[0], r[1]], index: triple(2), middle: triple(5), ring: triple(8), little: triple(11) },
    spread: { thumb: r[14], index: r[15], middle: 0, ring: r[16], little: r[17] },
  };
}

/** SPEC.md "Scoring, per frame": under 8 degrees is perfect, over 45 is wrong. */
const PERFECT_DEG = 8;
const WRONG_DEG = 45;

/**
 * Offline stand-in for the core's live score, used only when no glove engine is connected (mock mode). It uses the
 * same per-frame rule as the core: per finger, the mean absolute joint difference in degrees, mapped to 0..1, and the
 * hint names the worst finger. The core's own score always wins when it is there.
 */
export function localScore(learner: HandFrame, target: HandFrame): CoreScore {
  const fingers = {} as Record<Finger, number>;
  const err = {} as Record<Finger, number>;
  let worst: Finger = 'thumb';
  for (const f of FINGERS) {
    const a = learner.flexion[f];
    const b = target.flexion[f];
    const e = (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3 / RAD;
    err[f] = Math.round(e * 10) / 10;
    fingers[f] = Math.min(1, Math.max(0, 1 - (e - PERFECT_DEG) / (WRONG_DEG - PERFECT_DEG)));
    if (fingers[f] < fingers[worst]) worst = f;
  }
  const overall = FINGERS.reduce((s, f) => s + fingers[f], 0) / FINGERS.length;
  const total = (h: HandFrame, f: Finger) => h.flexion[f][0] + h.flexion[f][1] + h.flexion[f][2];
  const off = fingers[worst] < MATCH_AT;
  return {
    hand: learner.side,
    overall,
    fingers,
    err_deg: err,
    worst: off ? worst : null,
    hint: off ? (total(learner, worst) < total(target, worst) ? 'too_flat' : 'too_curled') : null,
  };
}
