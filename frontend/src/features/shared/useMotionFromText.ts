import { useCallback, useState } from 'react';
import { api, ApiError, type MotionFromTextResponse, type Side } from '../../api';

/** The backend rejects descriptions longer than this. */
export const MOTION_TEXT_MAX = 200;

export interface MotionFromTextHandle {
  text: string;
  setText: (t: string) => void;
  busy: boolean;
  error: string | null;
  /** The last answer, for the explanation and provider line. */
  result: MotionFromTextResponse | null;
  /** POST /api/motion/from_text; resolves to the answer, or null when it failed or there was nothing to ask. */
  run: () => Promise<MotionFromTextResponse | null>;
}

/** Turns a plain-words description such as "a pinch, slower" into a MotionSpec through POST /api/motion/from_text. */
export function useMotionFromText(side?: Side): MotionFromTextHandle {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MotionFromTextResponse | null>(null);

  const run = useCallback(async () => {
    const t = text.trim().slice(0, MOTION_TEXT_MAX);
    if (!t) return null;
    setBusy(true);
    setError(null);
    try {
      const r = await api.motionFromText({ text: t, side });
      setResult(r);
      return r;
    } catch (e) {
      setError(e instanceof ApiError && e.isNetwork ? 'The assistant could not be reached. Check that the backend is running.' : e instanceof ApiError ? e.message : String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }, [text, side]);

  return { text, setText, busy, error, result, run };
}

/** One honest line about who answered a text-to-motion request. Provider names stay in the developer panel. */
export function motionProviderLine(provider: string): string {
  if (provider.startsWith('fake')) return 'Matched by simple keyword rules while the assistant was unavailable.';
  return 'Read by the assistant.';
}
