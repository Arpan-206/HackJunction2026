import { useCallback, useState } from 'react';
import type { Lesson, Step, TestSpec } from '../../../api';
import { blankStep } from '../lib';

export interface LessonDraftHandle {
  draft: Lesson;
  dirty: boolean;
  patch: (fields: Partial<Omit<Lesson, 'steps'>>) => void;
  updateStep: (id: string, fields: Partial<Step>) => void;
  moveStep: (id: string, delta: -1 | 1) => void;
  removeStep: (id: string) => void;
  /** Puts a removed step back at its old position (undo). */
  restoreStep: (step: Step, index: number) => void;
  addStep: () => void;
  setTest: (test: TestSpec | null) => void;
  /** Marks the current draft as saved. */
  commit: (saved: Lesson) => void;
}

/** Local, editable copy of a lesson with the step operations the editor needs (reorder, delete, add). */
export function useLessonDraft(initial: Lesson): LessonDraftHandle {
  const [draft, setDraft] = useState<Lesson>(initial);
  const [dirty, setDirty] = useState(false);

  const edit = useCallback((fn: (l: Lesson) => Lesson) => {
    setDraft(fn);
    setDirty(true);
  }, []);

  const patch = useCallback((fields: Partial<Omit<Lesson, 'steps'>>) => edit((l) => ({ ...l, ...fields })), [edit]);
  const updateStep = useCallback((id: string, fields: Partial<Step>) => edit((l) => ({ ...l, steps: l.steps.map((s) => (s.id === id ? { ...s, ...fields } : s)) })), [edit]);
  const moveStep = useCallback(
    (id: string, delta: -1 | 1) =>
      edit((l) => {
        const i = l.steps.findIndex((s) => s.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= l.steps.length) return l;
        const steps = [...l.steps];
        [steps[i], steps[j]] = [steps[j], steps[i]];
        return { ...l, steps };
      }),
    [edit],
  );
  const removeStep = useCallback((id: string) => edit((l) => ({ ...l, steps: l.steps.filter((s) => s.id !== id) })), [edit]);
  const restoreStep = useCallback(
    (step: Step, index: number) =>
      edit((l) => {
        if (l.steps.some((s) => s.id === step.id)) return l;
        const steps = [...l.steps];
        steps.splice(Math.min(index, steps.length), 0, step);
        return { ...l, steps };
      }),
    [edit],
  );
  const addStep = useCallback(() => edit((l) => ({ ...l, steps: [...l.steps, { ...blankStep(), hands: l.steps[0]?.hands ?? 'right' }] })), [edit]);
  const setTest = useCallback((test: TestSpec | null) => edit((l) => ({ ...l, test })), [edit]);
  const commit = useCallback((saved: Lesson) => {
    setDraft(saved);
    setDirty(false);
  }, []);

  return { draft, dirty, patch, updateStep, moveStep, removeStep, restoreStep, addStep, setTest, commit };
}
