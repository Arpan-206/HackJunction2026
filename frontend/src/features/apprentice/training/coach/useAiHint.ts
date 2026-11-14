import { useCallback, useRef, useState } from 'react';
import { api, type CoachHintRequest, type Finger, type Margin } from '../../../../api';
import type { FingerValues, ToleranceBand } from './deviation';
import { algorithmicTip, FINGER_LABEL } from './tips';
import { isAssistantOn } from '../../../shared/assistant';

/** Minimum gap between coach requests, so a sustained mistake never floods the backend. */
export const AI_HINT_MIN_GAP_MS = 5000;

export interface AiHint {
  text: string;
  /** Name of the model provider, or 'algorithm' when the call failed and the local tip is shown. */
  provider: string;
  finger: Finger;
}

interface Params {
  enabled: boolean;
  stepId: string;
  instruction: string;
  /** The band after the margin (one number, or each finger's own), for the local fallback tip. */
  toleranceDeg: ToleranceBand;
  timingMs: number;
  /** The step's own angle tolerance and the learner's margin, sent so the hint uses the same band. */
  stepToleranceDeg?: number;
  /**
   * The step's own per-finger tolerance (Step.tolerance.finger_angle_deg, before the margin), sent as finger_tolerance_deg
   * so the hint names the finger furthest outside its own band, as the live corrections do.
   */
  stepFingerToleranceDeg?: Partial<Record<Finger, number>> | null;
  margin?: Margin;
}

/** The body of POST /api/coach/hint for one sustained mistake; the per-finger band is sent only when the step has one. */
export function hintRequest(
  p: Pick<Params, 'stepId' | 'instruction' | 'stepToleranceDeg' | 'stepFingerToleranceDeg' | 'margin'>,
  info: { deviation: FingerValues; lagMs: number },
): CoachHintRequest {
  const perFinger = p.stepFingerToleranceDeg && Object.keys(p.stepFingerToleranceDeg).length ? { finger_tolerance_deg: p.stepFingerToleranceDeg } : {};
  return { step_id: p.stepId, instruction: p.instruction, deviations: info.deviation, timing_ms: info.lagMs, tolerance_deg: p.stepToleranceDeg, ...perFinger, margin: p.margin };
}

/**
 * Asks the AI Assistant (POST /api/coach/hint) for a human-sounding tip when a finger stays out of tolerance, at most once
 * every 5 s. Falls back to the algorithmic tip when the call fails, and does nothing while the AI Assistant is off.
 */
export function useAiHint({ enabled, stepId, instruction, toleranceDeg, timingMs, stepToleranceDeg, stepFingerToleranceDeg, margin }: Params) {
  const [hint, setHint] = useState<AiHint | null>(null);
  const [pending, setPending] = useState(false);
  const last = useRef(0);
  const busy = useRef(false);

  const request = useCallback(
    async (info: { finger: Finger; deviation: FingerValues; lagMs: number }) => {
      const now = performance.now();
      if (!enabled || !isAssistantOn() || busy.current || now - last.current < AI_HINT_MIN_GAP_MS) return;
      last.current = now;
      busy.current = true;
      setPending(true);
      try {
        const res = await api.coachHint(hintRequest({ stepId, instruction, stepToleranceDeg, stepFingerToleranceDeg, margin }, info));
        setHint({ text: res.hint, provider: res.provider, finger: info.finger });
      } catch {
        const tip = algorithmicTip(info.deviation, toleranceDeg, info.lagMs, timingMs) ?? `${FINGER_LABEL[info.finger]}: match the expert a little more closely.`;
        setHint({ text: tip, provider: 'algorithm', finger: info.finger });
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [enabled, stepId, instruction, toleranceDeg, timingMs, stepToleranceDeg, stepFingerToleranceDeg, margin],
  );

  const clear = useCallback(() => setHint(null), []);
  return { hint, pending, request, clear };
}
