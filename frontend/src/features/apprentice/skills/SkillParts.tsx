import { useMemo } from 'react';
import { HandStill } from '../../../three';
import { synthFrame } from '../../../three/motion';
import { DIFFICULTY_LABEL, DIFFICULTY_MARKS, type Difficulty, type KeyPose, type SkillScene } from './catalogue';
import { sceneStage, SkillSet } from './SkillScene';

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
 * A skill's key pose as a still, seen first person over the back of the expert's chalk hand on the walnut bench, with the
 * skill's chalk stand-ins round it (racket and ball, keys, or a held letter). Drawn once to a picture by the shared
 * offscreen renderer (see HandStill), so a whole grid of cards is plain images that scroll with the page.
 */
export function SkillStill({ pose, scene = 'letter', label, className }: { pose: KeyPose; scene?: SkillScene; label: string; className?: string }) {
  const frame = useMemo(() => synthFrame(pose.motion, pose.t, 'right'), [pose]);
  const stage = useMemo(() => sceneStage(scene), [scene]);
  return (
    <HandStill className={className} preset="closeup" label={label} stillId={`skill:${scene}:${JSON.stringify(pose)}:right:chalk`} decor stage={stage}>
      <SkillSet scene={scene} frame={frame} />
    </HandStill>
  );
}
