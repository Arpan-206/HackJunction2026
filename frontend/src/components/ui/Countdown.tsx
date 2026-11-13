import { useEffect, useState } from 'react';

interface CountdownProps {
  /** Start value. Default 3. */
  from?: number;
  /** Fired once after the last numeral. */
  onDone: () => void;
  /** Optional italic line under the numeral. */
  caption?: string;
  /** Milliseconds per numeral. Default 1000. */
  stepMs?: number;
}

/** Full-screen 3-2-1 overlay with huge Cinzel numerals. Mount it to start; unmount to cancel. */
export function Countdown({ from = 3, onDone, caption, stepMs = 1000 }: CountdownProps) {
  const [n, setN] = useState(from);

  useEffect(() => {
    if (n <= 0) {
      onDone();
      return;
    }
    const id = window.setTimeout(() => setN((v) => v - 1), stepMs);
    return () => window.clearTimeout(id);
  }, [n, onDone, stepMs]);

  if (n <= 0) return null;
  return (
    <div className="countdown" role="alert" aria-live="assertive">
      <div className="countdown__num" key={n}>
        {n}
      </div>
      {caption && <p className="countdown__caption">{caption}</p>}
    </div>
  );
}
