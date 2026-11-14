import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, useGloveStream, type Hands, type Side, type Skill } from '../../../api';
import { useToast } from '../../../components/ui';
import { useCalibration } from '../../shared/useCalibration';
import { defaultHands, rememberHands } from '../../shared/sessionPrefs';
import { useMoveCatalogue } from '../hooks/useMoveCatalogue';
import { useSimulatorMotion } from '../hooks/useSimulatorMotion';
import { useSteadiness } from '../hooks/useSteadiness';
import { useTakeBook } from '../hooks/useTakeBook';
import { primarySide, skillLabel, stepFromChoice, type MoveChoice } from '../lib';

/**
 * State and actions of the "Start from scratch" studio: the chosen move, the takes per move, replay selection,
 * live-view toggles, and turning the kept takes into a saved lesson.
 */
export function useScratchStudio() {
  const toast = useToast();
  const navigate = useNavigate();
  const glove = useGloveStream();
  const catalogue = useMoveCatalogue();
  const steadiness = useSteadiness();
  const book = useTakeBook();

  const [skill, setSkill] = useState<Skill>('table_tennis');
  const [choice, setChoice] = useState<MoveChoice | null>(null);
  const [choices, setChoices] = useState<Record<string, MoveChoice>>({});
  const [side, setSide] = useState<Side>('right');
  const [replay, setReplay] = useState<string[] | null>(null);
  const [showJoints, setShowJoints] = useState(true);
  const [showTrails, setShowTrails] = useState(false);
  const [title, setTitle] = useState('');
  const [masterName, setMasterName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const calibration = useCalibration(side);

  useSimulatorMotion(glove, steadiness.gloveSource, choice?.motion ?? null);

  const choose = useCallback(
    (picked: MoveChoice) => {
      // A move already set up this visit keeps its hands; otherwise the session memory, then the catalogue, then right.
      const c = choices[picked.id] ?? { ...picked, hands: defaultHands(picked.moveId, picked.moveId ? picked.hands : undefined) };
      setChoice(c);
      setChoices((m) => ({ ...m, [c.id]: c }));
      setSide(primarySide(c.hands));
      setReplay(null);
    },
    [choices],
  );

  /** Changes the hands set-up of the current move (only before its first take) and remembers it for the session. */
  const setHands = useCallback(
    (hands: Hands) => {
      if (!choice) return;
      const c = { ...choice, hands };
      rememberHands(choice.moveId, hands);
      setChoice(c);
      setChoices((m) => ({ ...m, [c.id]: c }));
      if (hands !== 'both') setSide(hands);
    },
    [choice],
  );

  const planned = useMemo(() => book.slots.filter((id) => choices[id] && book.referenceFor(id)).map((id) => choices[id]), [book, choices]);

  const save = useCallback(async () => {
    if (!planned.length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const lesson = await api.createLesson({
        title: title.trim() || `${skillLabel(planned[0].skill)} lesson`,
        skill: planned[0].skill,
        summary: `Recorded by hand: ${planned.map((c) => c.name).join(', ')}.`,
        master_name: masterName.trim() || 'The expert',
        source: 'scratch',
        steps: planned.map((c) => {
          const kept = book.takesFor(c.id).filter((t) => t.kept).length;
          return { ...stepFromChoice(c, book.referenceFor(c.id)), repetitions: Math.max(kept, 1) };
        }),
        test: null,
      });
      toast.show('Lesson saved. Shaping it in the studio.', 'ok');
      navigate(`/expert/lessons/${lesson.id}`);
    } catch (e) {
      setSaveError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [planned, title, masterName, book, toast, navigate]);

  return {
    glove,
    catalogue,
    steadiness,
    book,
    calibration,
    skill,
    setSkill,
    choice,
    choose,
    setHands,
    side,
    setSide,
    replay,
    setReplay,
    showJoints,
    setShowJoints,
    showTrails,
    setShowTrails,
    title,
    setTitle,
    masterName,
    setMasterName,
    planned,
    save,
    saving,
    saveError,
  };
}
