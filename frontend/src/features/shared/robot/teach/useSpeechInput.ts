import { useCallback, useEffect, useRef, useState } from 'react';

/** The parts of the Web Speech API recogniser used here (Chrome and Edge ship it prefixed, Safari unprefixed). */
interface Recogniser {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  abort: () => void;
}
type RecogniserCtor = new () => Recogniser;

function recogniserCtor(): RecogniserCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecogniserCtor; webkitSpeechRecognition?: RecogniserCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface SpeechInput {
  supported: boolean;
  listening: boolean;
  error: string | null;
  listen: () => void;
  stop: () => void;
}

/**
 * Speaking to the robot: a teacher in gloves cannot type, so one press listens for one sentence and hands the words to
 * `onText`. Uses the browser's own speech recognition (in Chrome this is Google's online service); where the browser has
 * none, `supported` is false and the panel offers typing only.
 */
export function useSpeechInput(onText: (text: string) => void): SpeechInput {
  const Ctor = recogniserCtor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recogniser | null>(null);
  const handler = useRef(onText);
  useEffect(() => {
    handler.current = onText;
  }, [onText]);

  const stop = useCallback(() => {
    rec.current?.abort();
    rec.current = null;
    setListening(false);
  }, []);

  const listen = useCallback(() => {
    if (!Ctor) return;
    rec.current?.abort();
    const r = new Ctor();
    r.lang = 'en-GB';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? '';
      if (text.trim()) handler.current(text);
    };
    r.onerror = (e) => setError(e.error === 'not-allowed' ? 'The microphone is blocked. Allow it in the browser to speak to the robot.' : e.error === 'no-speech' ? null : 'Speech recognition stopped. Try again, or type it.');
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    setListening(true);
    r.start();
  }, [Ctor]);

  useEffect(() => () => rec.current?.abort(), []);
  return { supported: Ctor !== null, listening, error, listen, stop };
}

/** Says a line aloud with the browser's speech synthesis, cancelling whatever it was saying. */
export function speak(line: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(line.replace(/[“”]/g, ''));
  u.rate = 1.05;
  u.pitch = 1.25;
  window.speechSynthesis.speak(u);
}
