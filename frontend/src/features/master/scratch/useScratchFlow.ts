import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, useGloveStream, type Hands, type MotionSpec, type TakesModel } from '../../../api';
import { useToast } from '../../../components/ui';
import { defaultHands, rememberHands } from '../../shared/sessionPrefs';
import { useSimulatorMotion } from '../hooks/useSimulatorMotion';
import { useSteadiness } from '../hooks/useSteadiness';
import { clearDraft, isEmptyDraft, loadDraft, newDraft, newMove, skillFromSearch, reachableScreen, scratchLesson, type PlannedMove, type ScratchDraft, type Screen } from './scratchDraft';
import { useDraftSync } from '../files/useDraftSync';

/**
 * State of the "Start from scratch" flow (Record, Replay, Publish) for a new skill: one draft saved in localStorage and on
 * the backend (useDraftSync), so a reload, a closed tab or another laptop lands on the same screen with the same takes,
 * plus the glove stream. Every move is a free move with an id fixed
 * before its first take; the skill and its moves are named on Publish.
 */
/**
 * What the simulator plays while a new move is recorded without gloves: a slow wave of the fingers, so a demo still
 * captures takes that move. Real gloves ignore it, and it is never saved on the step (a new move has no guide motion).
 */
const SIMULATED_MOVE: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5], beat_ms: 700 };

export function useScratchFlow() {
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const glove = useGloveStream();
  const steadiness = useSteadiness();
  const [draft, setDraft] = useState<ScratchDraft>(() => {
    const saved = loadDraft();
    const forSkill = skillFromSearch(location.search);
    // A skill page starts a lesson for its skill, unless takes are already waiting in this tab: those are kept.
    if (forSkill && (!saved || isEmptyDraft(saved))) return newDraft(saved?.current.hands ?? defaultHands(null), forSkill);
    // The studio's door always means a new skill: an untouched draft left over from a skill page starts afresh.
    if (!forSkill && saved && isEmptyDraft(saved) && (saved.skill !== 'general' || saved.skillName)) return newDraft(saved.current.hands);
    return saved ?? newDraft(defaultHands(null));
  });
  const sync = useDraftSync(draft, setDraft);

  // The skill is in the draft now; a reload must not start it again.
  useEffect(() => {
    if (location.search) navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  useSimulatorMotion(glove, steadiness.gloveSource, draft.current.motion ?? SIMULATED_MOVE);

  const screen = reachableScreen(draft);
  const patch = useCallback((p: Partial<ScratchDraft>) => setDraft((d) => ({ ...d, ...p })), []);
  const go = useCallback((s: Screen) => patch({ screen: s }), [patch]);

  /** Changes the hands of the current move (only offered before its first take) and remembers it for the session. */
  const setHands = useCallback((hands: Hands) => {
    setDraft((d) => {
      rememberHands(null, hands);
      return { ...d, current: { ...d.current, hands }, model: null };
    });
  }, []);

  /** Saves a move's take ids with the draft (no change, no new draft object). */
  const setTakeIds = useCallback((slot: string, ids: string[]) => {
    setDraft((d) => ((d.takeIds[slot] ?? []).join(',') === ids.join(',') ? d : { ...d, takeIds: { ...d.takeIds, [slot]: ids } }));
  }, []);

  const setModel = useCallback((model: TakesModel | null) => setDraft((d) => (d.model === model ? d : { ...d, model })), []);

  /** Every move the skill will hold: earlier moves, then the current one once it has its model. */
  const planned = useMemo<PlannedMove[]>(() => [...draft.moves, ...(draft.model ? [{ choice: draft.current, model: draft.model }] : [])], [draft]);

  /**
   * Back to Record for a fresh move. A recorded current move is put aside in the skill first; one without its takes yet is
   * simply recorded on.
   */
  const addAnother = useCallback(() => {
    setDraft((d) => {
      if (!d.model) return { ...d, screen: 'record' };
      // The move's takes now live in its model.
      const takeIds = { ...d.takeIds };
      delete takeIds[d.current.id];
      const moves = [...d.moves, { choice: d.current, model: d.model }];
      return { ...d, moves, current: newMove(moves.length + 1, d.current.hands, d.skill), model: null, takeIds, screen: 'record' };
    });
  }, []);

  /** Drops an earlier move from the skill (its takes stay stored). */
  const dropMove = useCallback((index: number) => setDraft((d) => ({ ...d, moves: d.moves.filter((_, i) => i !== index) })), []);

  /** Renames a move by its id, earlier or current; the id and the take labels stay as they are. */
  const renameMove = useCallback((id: string, name: string) => {
    setDraft((d) => ({
      ...d,
      current: d.current.id === id ? { ...d.current, name } : d.current,
      moves: d.moves.map((m) => (m.choice.id === id ? { ...m, choice: { ...m.choice, name } } : m)),
    }));
  }, []);

  const publish = useCallback(async () => {
    if (!planned.length) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const lesson = await api.createLesson(scratchLesson(draft, planned));
      clearDraft();
      sync.forget(draft.id);
      setDraft(newDraft(draft.current.hands));
      toast.show(draft.skillLocked ? 'Lesson published.' : 'Skill published.', 'ok');
      navigate(`/expert/lessons/${lesson.id}`);
    } catch (e) {
      setPublishError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setPublishing(false);
    }
  }, [planned, draft, toast, navigate, sync]);

  return {
    draft,
    screen,
    go,
    glove,
    steadiness,
    setHands,
    setModel,
    setTakeIds,
    planned,
    addAnother,
    dropMove,
    renameMove,
    setSkillName: (t: string) => patch({ skillName: t }),
    setAbout: (t: string) => patch({ about: t }),
    setMasterName: (n: string) => patch({ masterName: n }),
    publish,
    publishing,
    publishError,
    /** "Carry on where you left off: ..." while a resumed draft is untouched; null otherwise. */
    resumeNote: sync.resumeNote,
    dismissResume: sync.dismissResume,
    /** Drops the resumed draft (its takes stay stored) and starts an empty one. */
    startFresh: () => sync.startFresh(newDraft(draft.current.hands)),
  };
}

export type ScratchFlow = ReturnType<typeof useScratchFlow>;
