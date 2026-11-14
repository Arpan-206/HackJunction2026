import { useMemo } from 'react';
import { Hand, HandStill } from '../../../three';
import { synthFrame } from '../../../three/motion';
import { DIFFICULTY_LABEL, DIFFICULTY_MARKS, type Difficulty, type KeyPose } from './catalogue';

/** Difficulty as a word with a quiet three-mark scale beside it (filled lozenges up to the level). No stars, no pill. */
export function DifficultyLine({ difficulty }: { difficulty: Difficulty }) {
  const filled = DIFFICULTY_MARKS[difficulty];
  return (
    <span className="sk-level">
      <span className="sk-level__marks" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= filled ? 'is-on' : ''} />
        ))}
      </span>
      <span>{DIFFICULTY_LABEL[difficulty]}</span>
    </span>
  );
}

/**
 * How a hand is turned for display on the dashboard and skill page: seen from the thumb side with the fingers pointing left,
 * so a grip or a letter reads in profile instead of from behind the wrist. Position keeps the hand centred on the camera
 * target of the presets.
 */
export const DISPLAY_POSE = { rotation: [0, 2.13, 0] as [number, number, number], position: [0.38, 0, -0.84] as [number, number, number] };

/**
 * A skill's key pose as a still: the expert's chalk hand on the walnut bench, drawn once to a picture by the shared
 * offscreen renderer (see HandStill), so a whole grid of cards is plain images that scroll with the page.
 */
export function SkillStill({ pose, label, className }: { pose: KeyPose; label: string; className?: string }) {
  const frame = useMemo(() => synthFrame(pose.motion, pose.t, 'right'), [pose]);
  return (
    <HandStill className={className} preset="closeup" label={label} stillId={`skill:${JSON.stringify(pose)}:right:chalk:${DISPLAY_POSE.rotation}:${DISPLAY_POSE.position}`} decor>
      <Hand side="right" style="chalk" frame={frame} smoothing={false} rotation={DISPLAY_POSE.rotation} position={DISPLAY_POSE.position} />
    </HandStill>
  );
}
