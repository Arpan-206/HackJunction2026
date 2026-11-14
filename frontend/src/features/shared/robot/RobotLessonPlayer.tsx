import { useEffect, useMemo, useState } from 'react';
import type { Lesson } from '../../../api';
import { useLessonLibrary } from '../../apprentice/hooks/useLessonData';
import { useReferenceTrack } from '../../apprentice/hooks/useReferenceTrack';
import { Segmented } from '../../apprentice/training/Segmented';
import type { TwinLesson } from './RobotTwin';

/** Playback speeds: a robot demonstrator slows the expert down so the learner can follow each finger (research/13). */
export const LESSON_SPEEDS = [
  { id: '0.5', label: 'Half speed' },
  { id: '1', label: 'Expert speed' },
] as const;
type SpeedId = (typeof LESSON_SPEEDS)[number]['id'];

interface RobotLessonPlayerProps {
  /** Called with the lesson to play on the robot, or null when it stops. */
  onChange: (lesson: TwinLesson | null) => void;
}

/**
 * Plays a lesson step on the five-finger robot in the browser: pick a lesson and a step, and the robot performs the
 * expert's reference take (or the step's guide motion when there is no take), on a loop, at expert or half speed. The
 * expert's chalk hand is drawn beside it holding the strings. Nothing is retargeted: the robot has every human joint.
 */
export function RobotLessonPlayer({ onChange }: RobotLessonPlayerProps) {
  const library = useLessonLibrary();
  const lessons = useMemo(() => (library.data ?? []).filter((l) => l.steps.length > 0), [library.data]);
  const [lessonId, setLessonId] = useState<string>('');
  const [stepIndex, setStepIndex] = useState(0);
  const [speed, setSpeed] = useState<SpeedId>('1');
  const [playing, setPlaying] = useState(false);
  const lesson: Lesson | null = lessons.find((l) => l.id === lessonId) ?? lessons[0] ?? null;
  const step = lesson?.steps[Math.min(stepIndex, lesson.steps.length - 1)] ?? null;
  const ref = useReferenceTrack(playing ? step : null);
  const track = ref.track;

  useEffect(() => {
    if (!playing || !track || !lesson || !step) {
      onChange(null);
      return;
    }
    const k = Number(speed);
    onChange({ getFrame: (t) => track.handAt(t * k), side: track.side, label: step.title });
  }, [playing, track, lesson, step, speed, onChange]);

  useEffect(() => () => onChange(null), [onChange]);

  if (library.loading && lessons.length === 0) return <p className="note">Loading the lessons...</p>;
  if (library.error && lessons.length === 0) return <p className="note">The lessons could not be loaded. Check that the app server is running.</p>;
  if (lessons.length === 0) return <p className="note">No lessons yet. Record one in the expert studio and it can be played here.</p>;

  return (
    <div className="rb-lesson">
      <span className="ap-field__label">Play a lesson</span>
      <label className="ap-field">
        <span className="ap-field__label">Lesson</span>
        <select
          className="rb-select"
          value={lesson?.id ?? ''}
          onChange={(e) => {
            setLessonId(e.target.value);
            setStepIndex(0);
          }}
        >
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
          <select className="rb-select" value={stepIndex} onChange={(e) => setStepIndex(Number(e.target.value))}>
            {lesson.steps.map((s, i) => (
              <option key={s.id} value={i}>
                {`${i + 1}. ${s.title}${s.reference_recording_id ? '' : ' (guide motion)'}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="ap-field">
        <span className="ap-field__label">Speed</span>
        <Segmented label="Playback speed" value={speed} options={[...LESSON_SPEEDS]} onChange={setSpeed} />
      </div>
      <button type="button" className="btn btn--primary rb-lesson__play" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
        {playing ? 'Stop the lesson' : 'Play it on the robot'}
      </button>
      {step && !step.reference_recording_id && <p className="note">This step has no recorded take, so the robot plays its guide motion.</p>}
      {playing && ref.loading && <p className="note">Loading the expert's take...</p>}
      {ref.notice && <p className="note">{ref.notice}</p>}
    </div>
  );
}
