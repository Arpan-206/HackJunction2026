import { useEffect, useState } from 'react';
import { useReferenceTrack } from '../../apprentice/hooks/useReferenceTrack';
import { Segmented } from '../../apprentice/training/Segmented';
import { LessonStepFields, lessonPickerNote, useLessonStep } from './LessonStepPicker';
import type { TwinLesson } from './RobotTwin';

/** Playback speeds: a robot demonstrator slows the expert down so the learner can follow each finger (research/13). */
export const LESSON_SPEEDS = [
  { id: '0.5', label: 'Half speed' },
  { id: '1', label: 'Expert speed' },
] as const;
export type SpeedId = (typeof LESSON_SPEEDS)[number]['id'];

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
  const choice = useLessonStep();
  const { lesson, step } = choice;
  const [speed, setSpeed] = useState<SpeedId>('1');
  const [playing, setPlaying] = useState(false);
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

  const note = lessonPickerNote(choice);
  if (note) return <p className="note">{note}</p>;

  return (
    <div className="rb-lesson">
      <span className="ap-field__label">Play a lesson</span>
      <LessonStepFields choice={choice} />
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
