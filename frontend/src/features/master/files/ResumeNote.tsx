import { Button } from '../../../components/ui';
import './files.css';

/**
 * "Carry on where you left off: 2 takes of Move 1 recorded." shown when Start from scratch opens on a saved draft, with
 * "Start fresh" to drop it. The takes themselves stay stored on the backend either way.
 */
export function ResumeNote({ text, onCarryOn, onStartFresh }: { text: string | null; onCarryOn: () => void; onStartFresh: () => void }) {
  if (!text) return null;
  return (
    <div className="xf-note" role="status">
      <p>{text}</p>
      <div className="xf-note__acts">
        <Button onClick={onCarryOn}>Carry on</Button>
        <Button variant="secondary" onClick={onStartFresh}>
          Start fresh
        </Button>
      </div>
    </div>
  );
}
