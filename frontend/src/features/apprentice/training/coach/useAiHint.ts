import { useCallback, useRef, useState } from 'react';
import { api, type Finger } from '../../../../api';
import type { FingerValues } from './deviation';
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
  toleranceDeg: number;
  timingMs: number;
}

/**
 * Asks the assistant (POST /api/coach/hint) for a human-sounding tip when a finger stays out of tolerance, at most once
 * every 5 s. Falls back to the algorithmic tip when the call fails, and does nothing while the assistant is off.
 */
export function useAiHint({ enabled, stepId, instruction, toleranceDeg, timingMs }: Params) {
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
        const res = await api.coachHint({ step_id: stepId, instruction, deviations: info.deviation, timing_ms: info.lagMs });
        setHint({ text: res.hint, provider: res.provider, finger: info.finger });
      } catch {
        const tip = algorithmicTip(info.deviation, toleranceDeg, info.lagMs, timingMs) ?? `${FINGER_LABEL[info.finger]}: match the expert a little more closely.`;
        setHint({ text: tip, provider: 'algorithm', finger: info.finger });
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [enabled, stepId, instruction, toleranceDeg, timingMs],
  );

  const clear = useCallback(() => setHint(null), []);
  return { hint, pending, request, clear };
}
