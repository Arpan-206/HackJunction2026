import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lesson } from '../../../api';
import { Hand, HandCanvas } from '../../../three';
import { synthFrame } from '../../../three/motion';
import { lessonTitle } from '../course/LessonCourse';
import { stepSide, useReferenceTrack } from '../hooks/useReferenceTrack';
import type { ReferenceTrack } from '../training/coach/reference';
import type { KeyPose } from './catalogue';
import { DISPLAY_POSE } from './SkillParts';

/** About how long one lesson plays before the showcase moves on: whole cycles of its motion, close to seven seconds. */
const DWELL_TARGET_S = 7;

function dwellSeconds(track: ReferenceTrack | null): number {
  const period = track?.period ?? DWELL_TARGET_S;
  return Math.max(4, period * Math.max(1, Math.round(DWELL_TARGET_S / period)));
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Choice = 'both' | 0 | 1;

/**
 * The large showcase on a live skill page: the expert's chalk hand on the walnut bench replaying lesson 1's reference motion,
 * then lesson 2's, in a loop (the expert's recording when there is one, otherwise the guide motion). Props stay off. A quiet
 * switch holds one lesson or goes back to playing both in turn.
 */
export function SkillShowcase({ course }: { course: Lesson }) {
  const steps = course.steps.slice(0, 2);
  const first = useReferenceTrack(steps[0] ?? null);
  const second = useReferenceTrack(steps[1] ?? null);
  const tracks = useMemo(() => [first.track, second.track].slice(0, steps.length), [first.track, second.track, steps.length]);
  const [choice, setChoice] = useState<Choice>('both');
  const [turn, setTurn] = useState(0);
  const shown = choice === 'both' ? turn : choice;
  const startedAt = useRef(0);
  const cycling = choice === 'both' && tracks.length > 1 && !prefersReducedMotion();

  useEffect(() => {
    startedAt.current = performance.now();
  }, [shown]);

  useEffect(() => {
    if (!cycling) return;
    const id = window.setTimeout(() => setTurn((t) => (t + 1) % tracks.length), dwellSeconds(tracks[turn] ?? null) * 1000);
    return () => window.clearTimeout(id);
  }, [cycling, turn, tracks]);

  const step = steps[shown] ?? steps[0];
  const side = step ? stepSide(step) : 'right';
  const getFrame = useCallback(() => tracks[shown]?.handAt((performance.now() - startedAt.current) / 1000) ?? null, [tracks, shown]);
  const source = tracks[shown]?.source === 'recording' ? "The expert's recording, made with the gloves" : 'A guide motion until the expert records this lesson';

  return (
    <figure className="sk-show">
      <div className="sk-show__stage">
        <HandCanvas preset="single" label={step ? `The expert's hand playing ${lessonTitle(step, shown)}` : 'The expert hand'} stage={{ decor: true }}>
          <Hand side={side} style="chalk" getFrame={getFrame} rotation={DISPLAY_POSE.rotation} position={DISPLAY_POSE.position} />
        </HandCanvas>
      </div>
      <figcaption className="sk-show__cap">
        <span className="sk-show__now" aria-live="polite">
          {step ? lessonTitle(step, shown) : 'No lessons yet'}
        </span>
        <span className="sk-show__src">{source}</span>
        {steps.length > 1 && (
          <span className="sk-toggles sk-show__switch" role="group" aria-label="Which lesson plays">
            {steps.map((s, i) => (
              <button key={s.id} type="button" className="sk-toggle" aria-pressed={choice === i} onClick={() => setChoice(i as 0 | 1)}>
                Lesson {i + 1}
              </button>
            ))}
            <button
              type="button"
              className="sk-toggle"
              aria-pressed={choice === 'both'}
              onClick={() => {
                setTurn(choice === 'both' ? turn : choice);
                setChoice('both');
              }}
            >
              Both in turn
            </button>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** The showcase of a workshop skill: its key pose held still, since no expert has recorded it yet. */
export function WorkshopShowcase({ pose, name }: { pose: KeyPose; name: string }) {
  const frame = useMemo(() => synthFrame(pose.motion, pose.t, 'right'), [pose]);
  return (
    <figure className="sk-show">
      <div className="sk-show__stage sk-show__stage--still">
        <HandCanvas preset="single" label={`${name}: the key pose on a chalk hand`} stage={{ decor: true }}>
          <Hand side="right" style="chalk" frame={frame} smoothing={false} rotation={DISPLAY_POSE.rotation} position={DISPLAY_POSE.position} />
        </HandCanvas>
      </div>
      <figcaption className="sk-show__cap">
        <span className="sk-show__now">The key pose, sketched</span>
        <span className="sk-show__src">No expert has recorded this skill yet, so there is no motion to play.</span>
      </figcaption>
    </figure>
  );
}
