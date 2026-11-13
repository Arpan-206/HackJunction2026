interface RecordButtonProps {
  recording: boolean;
  onToggle: () => void;
  /** Elapsed seconds, shown while recording. */
  elapsedS?: number;
  disabled?: boolean;
  labels?: { start: string; stop: string };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Large record/stop control with a live timer, readable from a distance. */
export function RecordButton({ recording, onToggle, elapsedS = 0, disabled, labels = { start: 'Record take', stop: 'Stop' } }: RecordButtonProps) {
  return (
    <button type="button" className={`rec ${recording ? 'rec--on' : ''}`} onClick={onToggle} disabled={disabled} aria-pressed={recording}>
      <span className="rec__dot" aria-hidden="true" />
      <span>{recording ? labels.stop : labels.start}</span>
      {recording && <span className="rec__time">{fmt(elapsedS)}</span>}
    </button>
  );
}
