import { useState } from 'react';
import { Button } from '../../../components/ui';
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

/** Below this consistency score a take is genuinely off, the only time vermilion is used here. */
const OFF_BELOW = 60;

/**
 * The takes recorded for one move: duration, consistency against the reference take, keep or set aside,
 * delete, replay, and a two-take comparison.
 */
export function TakeList({ takes, referenceId, onToggleKept, onDelete, onSetReference, onReplay }: TakeListProps) {
  const [picked, setPicked] = useState<string[]>([]);
  /** The take whose Delete was pressed: its row asks "Delete take N? Yes / Keep" before anything is removed. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const live = picked.filter((id) => takes.some((t) => t.id === id));

  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));

  if (!takes.length) return <p className="note mst-empty">Recorded takes appear here, ready to replay and compare.</p>;

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
                {isRef && <span className="mst-take__ref">reference take</span>}
                {!t.kept && <span className="mst-take__ref">set aside</span>}
                {res && (
                  <span className="mst-take__score" title={res.hint}>
                    {Math.round(res.overall)}
                    <small> consistency</small>
                    {res.within_tolerance && <span className="mst-take__mark"> {'✓'}</span>}
                  </span>
                )}
                {res && res.overall < OFF_BELOW && <span className="mst-take__off">Check the {res.worst_finger} finger</span>}
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
                {confirming === t.id ? (
                  <span className="mst-take__confirm" role="group" aria-label={`Delete take ${t.n}?`}>
                    <span>Delete take {t.n}?</span>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setConfirming(null);
                        onDelete(t.id);
                      }}
                    >
                      Yes
                    </Button>
                    <Button variant="ghost" autoFocus onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button variant="ghost" className="mst-take__delete" onClick={() => setConfirming(t.id)} aria-label={`Delete take ${t.n}`}>
                    Delete
                  </Button>
                )}
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
