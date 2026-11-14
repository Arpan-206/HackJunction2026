import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { api } from '../../../api';
import { DRAFT_SCHEMA_VERSION, parseDraft, resumeSummary, saveDraft, shouldAdoptServerDraft, type ScratchDraft } from '../scratch/scratchDraft';

/** Wait after the last change before the draft is sent to the backend (typing a name changes it on every key). */
export const DRAFT_PUSH_DELAY_MS = 500;

export interface DraftSync {
  resumeNote: string | null;
  dismissResume: () => void;
  /** Replaces the draft with an empty one and deletes the old one on the backend (its takes stay stored). */
  startFresh: (fresh: ScratchDraft) => void;
  /** Deletes a draft on the backend (after it is published). */
  forget: (id: string) => void;
}

/**
 * Keeps the scratch draft safe everywhere: every change is saved in localStorage at once and on the backend shortly
 * after (PUT /api/drafts/scratch/{id}, one JSON file per draft under backend/data/drafts). On opening, the backend's
 * newest draft is fetched once; when it is newer than this device's copy (or this device had none) it replaces it, so
 * a closed tab, a cleared browser or another laptop carries on where the expert left off. Nothing is sent to the
 * backend until that first check is done, so a stale copy here never overwrites a newer one there.
 */
export function useDraftSync(draft: ScratchDraft, setDraft: Dispatch<SetStateAction<ScratchDraft>>): DraftSync {
  const initial = useRef(draft);
  const current = useRef(draft);
  current.current = draft;
  const checked = useRef(false);
  const timer = useRef<number | null>(null);
  const pending = useRef<ScratchDraft | null>(null);
  const [resumed, setResumed] = useState<ScratchDraft | null>(() => (resumeSummary(draft) && draft.savedAt !== undefined ? draft : null));

  const flush = useCallback(() => {
    // Before the first check nothing leaves this device (it might be older than the backend's copy).
    if (!checked.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const d = pending.current;
    pending.current = null;
    if (d) void api.saveDraft('scratch', d.id, DRAFT_SCHEMA_VERSION, d).catch(() => undefined);
  }, []);

  const push = useCallback(
    (d: ScratchDraft) => {
      pending.current = d;
      if (!checked.current) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, DRAFT_PUSH_DELAY_MS);
    },
    [flush],
  );

  // Every change: saved on this device now, on the backend after a short pause.
  useEffect(() => {
    push(saveDraft(draft));
  }, [draft, push]);

  // Once, on opening: the backend's newest draft, adopted when it is the newer one.
  useEffect(() => {
    const ctl = new AbortController();
    api
      .latestDraft('scratch', ctl.signal)
      .then((doc) => {
        const server = parseDraft(doc.draft);
        // Only while nothing has changed here yet: work done in the meantime is never thrown away.
        if (current.current === initial.current && shouldAdoptServerDraft(initial.current, server)) {
          // The copy opened here is replaced, so it is never sent: the adopted draft is saved again on its own.
          pending.current = null;
          setDraft(server);
          setResumed(resumeSummary(server) ? server : null);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (ctl.signal.aborted) return;
        checked.current = true;
        if (pending.current) flush();
      });
    return () => ctl.abort();
  }, [setDraft, flush]);

  // Leaving the screen sends what is still waiting.
  useEffect(() => () => flush(), [flush]);

  const forget = useCallback((id: string) => {
    void api.deleteDraft('scratch', id).catch(() => undefined);
  }, []);

  const startFresh = useCallback(
    (fresh: ScratchDraft) => {
      forget(current.current.id);
      setResumed(null);
      setDraft(fresh);
    },
    [forget, setDraft],
  );

  const dismissResume = useCallback(() => setResumed(null), []);

  // The note stays while the resumed draft is as it was opened; the first change answers it.
  const resumeNote = useMemo(() => (resumed && resumed.id === draft.id && sameWork(resumed, draft) ? resumeSummary(resumed) : null), [resumed, draft]);
  return { resumeNote, dismissResume, startFresh, forget };
}

/** Whether two copies of a draft hold the same recorded work (takes and moves), whatever else changed. */
function sameWork(a: ScratchDraft, b: ScratchDraft): boolean {
  return JSON.stringify([a.takeIds, a.moves.length, a.current.id]) === JSON.stringify([b.takeIds, b.moves.length, b.current.id]);
}
