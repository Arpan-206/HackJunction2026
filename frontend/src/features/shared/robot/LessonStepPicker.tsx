import { useMemo, useState } from 'react';
import type { Lesson, Step } from '../../../api';
import { useLessonLibrary } from '../../apprentice/hooks/useLessonData';

/** The lesson and step chosen on the robot screen, for the lesson player and for teaching the robot. */
export interface LessonStepChoice {
  lessons: Lesson[];
  lesson: Lesson | null;
  step: Step | null;
  stepIndex: number;
  setLessonId: (id: string) => void;
  setStepIndex: (i: number) => void;
  loading: boolean;
  error: boolean;
}

export function useLessonStep(): LessonStepChoice {
  const library = useLessonLibrary();
  const lessons = useMemo(() => (library.data ?? []).filter((l) => l.steps.length > 0), [library.data]);
  const [lessonId, setLessonIdRaw] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const lesson = lessons.find((l) => l.id === lessonId) ?? lessons[0] ?? null;
  const index = lesson ? Math.min(stepIndex, lesson.steps.length - 1) : 0;
  return {
    lessons,
    lesson,
    step: lesson?.steps[index] ?? null,
    stepIndex: index,
    setLessonId: (id) => {
      setLessonIdRaw(id);
      setStepIndex(0);
    },
    setStepIndex,
    loading: library.loading,
    error: Boolean(library.error),
  };
}

/** The empty, loading and error lines for the picker, or null when there are lessons to pick. */
export function lessonPickerNote(choice: LessonStepChoice): string | null {
  if (choice.lessons.length > 0) return null;
  if (choice.loading) return 'Loading the lessons...';
  if (choice.error) return 'The lessons could not be loaded. Check that the app server is running.';
  return 'No lessons yet. Record one in the expert studio and it can be played here.';
}

/** Lesson and step selects. A step with no recorded take is marked, since the robot then plays its guide motion. */
export function LessonStepFields({ choice, disabled = false }: { choice: LessonStepChoice; disabled?: boolean }) {
  const { lessons, lesson, stepIndex } = choice;
  return (
    <>
      <label className="ap-field">
        <span className="ap-field__label">Lesson</span>
        <select className="rb-select" value={lesson?.id ?? ''} disabled={disabled} onChange={(e) => choice.setLessonId(e.target.value)}>
          {lessons.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
      </label>
      {lesson && lesson.steps.length > 1 && (
        <label className="ap-field">
          <span className="ap-field__label">Step</span>
          <select className="rb-select" value={stepIndex} disabled={disabled} onChange={(e) => choice.setStepIndex(Number(e.target.value))}>
            {lesson.steps.map((s, i) => (
              <option key={s.id} value={i}>
                {`${i + 1}. ${s.title}${s.reference_recording_id ? '' : ' (guide motion)'}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
