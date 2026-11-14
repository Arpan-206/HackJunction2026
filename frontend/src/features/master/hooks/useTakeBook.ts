import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Recording, type ScoreResult } from '../../../api';
import { DEFAULT_TOLERANCE } from '../lib';

export interface Take {
  /** Recording id on the backend. */
  id: string;
  /** Repetition number within its slot, starting at 1. */
  n: number;
  duration_s: number;
  kept: boolean;
  /** Consistency against the reference take; null while pending or for the reference itself. */
  score: { against: string; result: ScoreResult } | null;
}

export interface TakeBook {
  takesFor: (slot: string) => Take[];
  /** The reference take for a slot: the explicit choice if still kept, else the first kept take. */
  referenceFor: (slot: string) => string | null;
  add: (slot: string, rec: Recording) => void;
  toggleKept: (slot: string, id: string) => void;
  remove: (slot: string, id: string) => void;
  setReference: (slot: string, id: string) => void;
  /** Slots that currently hold at least one take. */
  slots: string[];
}

type Slots = Record<string, Take[]>;

/**
 * Holds the master's takes per slot (a move id in scratch, a step id in lessons) and keeps each take's
 * consistency score up to date against the slot's reference take via POST /api/score.
 */
export function useTakeBook(): TakeBook {
  const [slots, setSlots] = useState<Slots>({});
  const [explicit, setExplicit] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());

  const referenceFor = useCallback(
    (slot: string): string | null => {
      const takes = slots[slot] ?? [];
      const chosen = takes.find((t) => t.id === explicit[slot] && t.kept);
      return (chosen ?? takes.find((t) => t.kept))?.id ?? null;
    },
    [slots, explicit],
  );

  useEffect(() => {
    for (const [slot, takes] of Object.entries(slots)) {
      const ref = referenceFor(slot);
      if (!ref) continue;
      for (const take of takes) {
        if (take.id === ref || take.score?.against === ref) continue;
        const key = `${ref}>${take.id}`;
        if (asked.current.has(key)) continue;
        asked.current.add(key);
        api
          .score({ reference_recording_id: ref, attempt_recording_id: take.id, tolerance: DEFAULT_TOLERANCE })
          .then((result) =>
            setSlots((s) => ({ ...s, [slot]: (s[slot] ?? []).map((t) => (t.id === take.id ? { ...t, score: { against: ref, result } } : t)) })),
          )
          .catch(() => asked.current.delete(key));
      }
    }
  }, [slots, referenceFor]);

  const add = useCallback((slot: string, rec: Recording) => {
    setSlots((s) => {
      const list = s[slot] ?? [];
      const n = list.reduce((m, t) => Math.max(m, t.n), 0) + 1;
      return { ...s, [slot]: [...list, { id: rec.id, n, duration_s: rec.duration_s, kept: true, score: null }] };
    });
  }, []);

  const patch = useCallback((slot: string, fn: (list: Take[]) => Take[]) => setSlots((s) => ({ ...s, [slot]: fn(s[slot] ?? []) })), []);

  const toggleKept = useCallback((slot: string, id: string) => patch(slot, (l) => l.map((t) => (t.id === id ? { ...t, kept: !t.kept } : t))), [patch]);
  const remove = useCallback((slot: string, id: string) => patch(slot, (l) => l.filter((t) => t.id !== id)), [patch]);
  const setReference = useCallback((slot: string, id: string) => setExplicit((e) => ({ ...e, [slot]: id })), []);
  const takesFor = useCallback((slot: string) => slots[slot] ?? [], [slots]);
  const slotsWithTakes = useMemo(() => Object.keys(slots).filter((k) => slots[k].length > 0), [slots]);

  return { takesFor, referenceFor, add, toggleKept, remove, setReference, slots: slotsWithTakes };
}
