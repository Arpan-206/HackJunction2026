import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type Hands, type Recording, type TakesModel } from '../../../api';
import { cacheRecording } from '../hooks/useRecording';
import { modelMatches, repOf, TAKES_MAX, TAKES_TARGET } from './scratchDraft';

/** One stored take of the move being recorded. */
export interface MoveTake {
  id: string;
  duration_s: number;
  /** Repetition number from its step_id label (`<move_id>:rep<n>`). */
  rep: number;
}

export interface MoveTakes {
  takes: MoveTake[];
  loading: boolean;
  /** Plain message when listing, deleting or modelling failed. */
  error: string | null;
  /** The model of exactly these takes, or null before three takes (or while it is being built). */
  model: TakesModel | null;
  modelling: boolean;
  /** The repetition number the next new take is labelled with. */
  nextRep: number;
  add: (rec: Recording) => void;
  /** Deletes the take on the backend (DELETE /api/recordings/{id}) and drops it from the list. */
  remove: (id: string) => Promise<void>;
}

const message = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

interface Options {
  /** The take ids saved with the draft for this move, in order. */
  savedIds: string[];
  hands: Hands;
  /** The model saved with the draft; reused while it still matches the takes. */
  initialModel: TakesModel | null;
  onModel: (m: TakesModel | null) => void;
  /** Called with the take ids whenever they change, so the draft can save them. */
  onIds: (ids: string[]) => void;
}

/**
 * The takes of one move: found again after a reload from the ids saved with the draft (GET /api/recordings/{id} for each,
 * which also warms the replay cache; a take deleted meanwhile is dropped), added as they are recorded, deleted for real,
 * and modelled with POST /api/recordings/model whenever three to five takes are in. Takes stay in repetition order, so a
 * redone take returns to its place. (GET /api/recordings, the list, reads every stored file on the backend, so fetching
 * the few known ids is much faster than listing.)
 */
export function useMoveTakes({ savedIds, hands, initialModel, onModel, onIds }: Options): MoveTakes {
  const [takes, setTakes] = useState<MoveTake[]>([]);
  const [loading, setLoading] = useState(savedIds.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<TakesModel | null>(initialModel);
  const [modelling, setModelling] = useState(false);
  const cb = useRef({ onModel, onIds });
  cb.current = { onModel, onIds };
  const initial = useRef(savedIds);

  // Once, on mount: the takes this draft already holds, in their saved order, if the backend still has them.
  useEffect(() => {
    const ids = initial.current;
    if (!ids.length) return;
    const ctl = new AbortController();
    const one = (id: string) =>
      api.recording(id, ctl.signal).then(
        (rec): MoveTake[] => {
          cacheRecording(rec);
          return [{ id, duration_s: rec.duration_s, rep: repOf(rec.step_id) }];
        },
        (e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return [];
          throw e;
        },
      );
    Promise.all(ids.map(one))
      .then((found) => setTakes(found.flat()))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(`Your earlier takes could not be listed: ${message(e)}`);
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, []);

  const ids = useMemo(() => takes.map((t) => t.id), [takes]);
  const key = ids.join(',');
  const current = modelMatches(model, ids) ? model : null;

  useEffect(() => {
    if (!loading) cb.current.onIds(key ? key.split(',') : []);
  }, [key, loading]);

  useEffect(() => {
    if (loading) return;
    const list = key ? key.split(',') : [];
    if (list.length < TAKES_TARGET || list.length > TAKES_MAX) {
      cb.current.onModel(null);
      return;
    }
    if (modelMatches(model, list)) {
      cb.current.onModel(model);
      return;
    }
    let live = true;
    setModelling(true);
    api
      .takesModel({ recording_ids: list, ...(hands === 'both' ? {} : { side: hands }) })
      .then((m) => {
        if (!live) return;
        setModel(m);
        setError(null);
        cb.current.onModel(m);
      })
      .catch((e: unknown) => live && setError(`The takes could not be compared: ${message(e)}`))
      .finally(() => live && setModelling(false));
    return () => {
      live = false;
    };
    // `model` is read only to skip a request it already answers; a new model must not trigger another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hands, loading]);

  const add = useCallback((rec: Recording) => {
    setError(null);
    setTakes((l) => (l.some((t) => t.id === rec.id) ? l : [...l, { id: rec.id, duration_s: rec.duration_s, rep: repOf(rec.step_id) }].sort((a, b) => a.rep - b.rep)));
  }, []);

  const remove = useCallback(async (id: string) => {
    setError(null);
    try {
      await api.deleteRecording(id);
    } catch (e) {
      // Already gone on the backend is fine; anything else is reported and the take stays listed.
      if (!(e instanceof ApiError && e.status === 404)) {
        setError(`Take not deleted: ${message(e)}`);
        return;
      }
    }
    setTakes((l) => l.filter((t) => t.id !== id));
  }, []);

  const nextRep = takes.reduce((m, t) => Math.max(m, t.rep), 0) + 1;
  return { takes, loading, error, model: current, modelling, nextRep, add, remove };
}
