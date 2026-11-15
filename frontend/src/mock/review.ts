import type { CoachReviewRequest, Finger } from '../api/types';
import { FINGERS } from '../api/types';

/**
 * Browser port of the algorithmic feedback in backend/app/services/llm/review.py (`build_review`): one scored rep as two
 * plain sentences, with no number and no measuring word. The mock router answers POST /coach/review with it, and the
 * score card shows it at once (and keeps it when the AI Assistant is off or does not answer). Change both sides together.
 */

/** Mirrors of REVIEW_GOOD_FROM and FOCUS_MIN_WEIGHT in backend/app/constants.py. */
export const REVIEW_GOOD_FROM = 80;
export const REVIEW_FOCUS_MIN_WEIGHT = 0.3;

const FINGER_WORDS: Record<Finger, string> = {
  thumb: 'thumb',
  index: 'index finger',
  middle: 'middle finger',
  ring: 'ring finger',
  little: 'little finger',
};

/** Fingers the step weights too little to talk about. */
export function ignoredFingers(req: Pick<CoachReviewRequest, 'weights'>): Finger[] {
  const w = req.weights ?? {};
  return FINGERS.filter((f) => (w[f] ?? 1) < REVIEW_FOCUS_MIN_WEIGHT);
}

/** The lowest-scoring finger that counts, or null when every finger that counts is at least good. */
export function reviewWeakest(req: Pick<CoachReviewRequest, 'score' | 'weights'>): Finger | null {
  const skip = ignoredFingers(req);
  const named = FINGERS.filter((f) => !skip.includes(f));
  const pool = named.length ? named : [...FINGERS];
  const worst = pool.reduce((a, b) => (req.score.per_finger[b] < req.score.per_finger[a] ? b : a));
  return req.score.per_finger[worst] < REVIEW_GOOD_FROM ? worst : null;
}

/** 'curl' or 'relax' for a finger, read from the scorer's own hint when it names that finger. */
function direction(hint: string, finger: Finger): 'curl' | 'relax' | null {
  const h = hint.toLowerCase();
  if (!h.includes(finger)) return null;
  if (h.startsWith('curl')) return 'curl';
  if (h.startsWith('relax')) return 'relax';
  return null;
}

/** The algorithmic feedback for one scored rep. */
export function buildReview(req: Pick<CoachReviewRequest, 'score' | 'weights'>): string {
  const s = req.score;
  const weak = reviewWeakest(req);
  const timingWeak = s.timing < REVIEW_GOOD_FROM;
  if (weak === null && !timingWeak) {
    return s.within_tolerance
      ? 'That was a clean one: your whole hand held the shape. Do it again the same way.'
      : 'Your hand shape was close all the way through. Hold it a touch steadier next time.';
  }
  if (weak === null) return 'Your hand shape was right. Next time, move with the guide hand so you land on the beat.';
  const word = FINGER_WORDS[weak];
  const way = direction(s.hint, weak);
  const fix = way === 'curl' ? `curl your ${word} a little more` : way === 'relax' ? `let your ${word} relax a little` : `watch your ${word} and match the guide more closely`;
  const lead = s.within_tolerance ? 'Good rep, the rest of your hand was right.' : 'Nearly there, most of your hand was right.';
  return `${lead} Next time, ${fix}.`;
}
