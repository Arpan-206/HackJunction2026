import { useEffect } from 'react';
import { Card } from '../../../components/ui';
import { useRecorder, type RecordContext, type RecorderPhase } from '../hooks/useRecorder';
import type { TakeBook } from '../hooks/useTakeBook';
import { CountdownRecord } from './CountdownRecord';
import { TakeList } from './TakeList';

interface RecorderPanelProps {
  /** Key the takes are stored under in the book. */
  slot: string;
  /** Card title when idle; while a take records it reads "Recording take N" instead. */
  title: string;
  /** How many kept takes the master is aiming for. */
  targetReps: number;
  book: TakeBook;
  /** Labels the next take: receives the repetition number it will become. */
  contextFor: (rep: number) => RecordContext;
  onReplay: (ids: string[]) => void;
  onPhase?: (phase: RecorderPhase) => void;
}

/** Record, review and curate takes for one move or step. Shared by the scratch studio and the lesson editors. */
export function RecorderPanel({ slot, title, targetReps, book, contextFor, onReplay, onPhase }: RecorderPanelProps) {
  const takes = book.takesFor(slot);
  const kept = takes.filter((t) => t.kept).length;
  const nextRep = takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;
  const recorder = useRecorder((rec) => book.add(slot, rec));

  useEffect(() => onPhase?.(recorder.phase), [recorder.phase, onPhase]);

  return (
    <Card title={recorder.phase === 'recording' ? `Recording take ${nextRep}` : title} className="mst-rec">
      <div className="mst-rec__goal">
        <span className="mst-rec__count" aria-live="polite">
          {kept > 0 ? (
            <>
              {kept}
              <small> of {targetReps} takes kept</small>
            </>
          ) : (
            <span className="mst-rec__none">{takes.length === 0 ? 'No takes yet' : 'No takes kept yet'}</span>
          )}
        </span>
        {kept >= targetReps && <span className="mst-ok">Target reached</span>}
      </div>
      <div className="mst-rec__dots" aria-hidden="true">
        {Array.from({ length: Math.max(targetReps, kept) }, (_, i) => (
          <span key={i} className={`mst-dot ${i < kept ? 'is-on' : ''}`} />
        ))}
      </div>
      <CountdownRecord recorder={recorder} context={contextFor(nextRep)} />
      {recorder.error && (
        <p className="mst-alert mst-alert--error" role="alert">
          {recorder.error}
        </p>
      )}
      <TakeList
        takes={takes}
        referenceId={book.referenceFor(slot)}
        onToggleKept={(id) => book.toggleKept(slot, id)}
        onDelete={(id) => book.remove(slot, id)}
        onSetReference={(id) => book.setReference(slot, id)}
        onReplay={onReplay}
      />
    </Card>
  );
}
