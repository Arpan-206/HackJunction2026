import { useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { FINGERS, type Finger } from '../../../../api/types';
import type { HandHandle } from '../../../../three';
import { useStageColors } from '../../../../three';
import type { Coach } from '../coach/useCoach';
import type { AttemptPolicy } from '../coach/fade';

/**
 * Tints a hand's fingers from the coach status without React renders: vermilion for a finger out of tolerance and,
 * optionally, malachite for one that is right. Only touches materials when a finger's colour actually changes.
 */
function useFingerTints(hand: RefObject<HandHandle>, coach: Coach, policy: AttemptPolicy, goodTint: boolean): void {
  const stage = useStageColors();
  const applied = useRef<{ rig: unknown; tints: Partial<Record<Finger, string | null>> }>({ rig: null, tints: {} });
  useFrame(() => {
    const h = hand.current;
    if (!h) return;
    if (applied.current.rig !== h.rig) applied.current = { rig: h.rig, tints: {} };
    const live = coach.live.current;
    for (const f of FINGERS) {
      let want: string | null = null;
      if (policy.showMaster && policy.strings !== 'none' && live.hasLearner) {
        if (live.status[f] === 'off' && (!policy.focus || policy.focus.includes(f))) want = stage.vermilion;
        else if (goodTint && policy.strings === 'all') want = stage.malachite;
      }
      if (applied.current.tints[f] !== want) {
        applied.current.tints[f] = want;
        h.rig.setFingerTint(f, want);
      }
    }
  });
}

interface TinterProps {
  hand: RefObject<HandHandle>;
  coach: Coach;
  policy: AttemptPolicy;
  goodTint: boolean;
}

/** Renders nothing; mount it inside a canvas to tint the given hand from the coach status. */
export function FingerTinter({ hand, coach, policy, goodTint }: TinterProps): null {
  useFingerTints(hand, coach, policy, goodTint);
  return null;
}
