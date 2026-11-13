import { useState } from 'react';
import { Badge, Button } from '../../../components/ui';
import type { Take } from '../hooks/useTakeBook';
import { formatDuration } from '../lib';

interface TakeListProps {
  takes: Take[];
  referenceId: string | null;
  onToggleKept: (id: string) => void;
  onDelete: (id: string) => void;
  onSetReference: (id: string) => void;
  onReplay: (ids: string[]) => void;
}

/**
 * The takes recorded for one move: duration, consistency against the reference take, keep or set aside,
 * delete, replay, and a two-take comparison.
 */
export function TakeList({ takes, referenceId, onToggleKept, onDelete, onSetReference, onReplay }: TakeListProps) {
  const [picked, setPicked] = useState<string[]>([]);
  const live = picked.filter((id) => takes.some((t) => t.id === id));

  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  if (!takes.length) return <p className="note mst-empty">No takes yet. Record one and it will appear here.</p>;

  return (
    <div className="mst-takes">
      <ul className="mst-takes__list" aria-label="Recorded takes">
        {takes.map((t) => {
          const isRef = t.id === referenceId;
          const res = t.score?.result;
          return (
            <li key={t.id} className={`mst-take ${t.kept ? '' : 'mst-take--aside'}`}>
              <label className="mst-take__pick">
                <input type="checkbox" checked={live.includes(t.id)} onChange={() => togglePick(t.id)} />
                <span className="sr-only">Select take {t.n} for comparison</span>
              </label>
              <div className="mst-take__main">
                <strong className="mst-take__name">Take {t.n}</strong>
                <span className="note">{formatDuration(t.duration_s)}</span>
                {isRef && <Badge tone="lapis">Reference</Badge>}
                {!t.kept && <Badge>Set aside</Badge>}
                {res && (
                  <span className={`mst-take__score ${res.within_tolerance ? 'is-ok' : 'is-off'}`} title={res.hint}>
                    {Math.round(res.overall)}
                    <small> consistency</small>
                  </span>
                )}
                {!res && !isRef && t.kept && <span className="note">Scoring...</span>}
              </div>
              <div className="mst-take__actions">
                <Button variant="secondary" onClick={() => onReplay([t.id])}>
                  Replay
                </Button>
                {t.kept && !isRef && (
                  <Button variant="ghost" onClick={() => onSetReference(t.id)}>
                    Make reference
                  </Button>
                )}
                <Button variant="ghost" aria-pressed={t.kept} onClick={() => onToggleKept(t.id)}>
                  {t.kept ? 'Set aside' : 'Keep'}
                </Button>
                <Button variant="ghost" onClick={() => onDelete(t.id)} aria-label={`Delete take ${t.n}`}>
                  Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {takes.length > 1 && (
        <div className="mst-takes__compare">
          <Button variant="secondary" disabled={live.length !== 2} onClick={() => onReplay(live)}>
            Compare side by side
          </Button>
          <span className="note">{live.length === 2 ? 'Two takes selected.' : 'Tick two takes to compare them.'}</span>
        </div>
      )}
    </div>
  );
}
