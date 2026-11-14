import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HandFrame, Lesson, Step } from '../../../api';
import { Hand, HandCanvas, HandStill } from '../../../three';
import { synthFrame } from '../../../three/motion';
import { layoutFor, Puppet, puppetLayout, raiseFor, ShadowTheatreSet, THEATRE_CAMERA } from '../../../three/ShadowTheatre';
import { shapeName } from '../training/modes/ShadowPuppets';
import { lessonTitle } from '../course/LessonCourse';
import { stepSide, useReferenceTrack } from '../hooks/useReferenceTrack';
import type { ReferenceTrack } from '../training/coach/reference';
import type { KeyPose } from './catalogue';
import { DISPLAY_POSE } from './SkillParts';
import { prefersReducedMotion } from '../../shared/settings';
import { TypingStage } from '../typing/TypingStage';

/** About how long one lesson plays before the showcase moves on: whole cycles of its motion, close to seven seconds. */
const DWELL_TARGET_S = 7;

function dwellSeconds(track: ReferenceTrack | null): number {
  const period = track?.period ?? DWELL_TARGET_S;
  return Math.max(4, period * Math.max(1, Math.round(DWELL_TARGET_S / period)));
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
        {course.skill === 'shadow_puppets' && step ? (
          <TheatreShowcase key={step.id} step={step} getFrame={getFrame} />
        ) : course.skill === 'touch_typing' && step ? (
          <TypingStage
            key={step.id}
            solid={false}
            style="chalk"
            hands={{
              left: side === 'left' ? { getFrame } : { getFrame: guideFrame(step, 'left', startedAt) },
              right: side === 'right' ? { getFrame } : { getFrame: guideFrame(step, 'right', startedAt) },
            }}
            label={`The expert's hands over a keyboard sketched in chalk, playing ${lessonTitle(step, shown)}`}
          />
        ) : (
          <HandCanvas preset="single" label={step ? `The expert's hand playing ${lessonTitle(step, shown)}` : 'The expert hand'} stage={{ decor: true }}>
            <Hand side={side} style="chalk" getFrame={getFrame} rotation={DISPLAY_POSE.rotation} position={DISPLAY_POSE.position} />
          </HandCanvas>
        )}
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

/**
 * Shadow puppets on the skill page: the expert's hands alone in the lamplit theatre, the shape named above the wall. The
 * step's own hand replays the reference; a second hand (the bird, the snail) plays the step's guide motion.
 */
function TheatreShowcase({ step, getFrame }: { step: Step; getFrame: () => HandFrame | null }) {
  const placements = useMemo(() => puppetLayout(layoutFor(step.move_id, step.hands), undefined, raiseFor(step.move_id)), [step.move_id, step.hands]);
  const own = stepSide(step);
  const name = shapeName(step);
  return (
    <div className="sp-theatre">
      <HandCanvas bare shadows stage={{ cameraPosition: THEATRE_CAMERA }} label={`The expert's shadow on the wall making ${name.toLowerCase()}`}>
        <ShadowTheatreSet />
        <Puppet x={0} placements={placements}>
          {(p) =>
            p.side === own ? (
              <Hand side={p.side} style="chalk" getFrame={getFrame} position={p.position} rotation={p.rotation} scale={p.scale} />
            ) : (
              <Hand side={p.side} style="chalk" motion={step.motion ?? undefined} position={p.position} rotation={p.rotation} scale={p.scale} />
            )
          }
        </Puppet>
      </HandCanvas>
      <p className="sp-theatre__name" aria-hidden="true">
        {name}
      </p>
    </div>
  );
}

/** The other hand of a two-handed lesson: its guide motion on the same clock as the replayed hand, so the two take turns. */
function guideFrame(step: Step, side: 'left' | 'right', startedAt: { current: number }): () => HandFrame | null {
  return () => (step.motion ? synthFrame(step.motion, (performance.now() - startedAt.current) / 1000, side) : null);
}

/** The showcase of a workshop skill: its key pose held still, since no expert has recorded it yet. */
export function WorkshopShowcase({ pose, name }: { pose: KeyPose; name: string }) {
  const frame = useMemo(() => synthFrame(pose.motion, pose.t, 'right'), [pose]);
  return (
    <figure className="sk-show">
      <div className="sk-show__stage sk-show__stage--still">
        <HandStill className="sk-show__still" preset="single" decor stillId={`workshop:${JSON.stringify(pose)}:right:chalk`} label={`${name}: the key pose on a chalk hand`}>
          <Hand side="right" style="chalk" frame={frame} smoothing={false} rotation={DISPLAY_POSE.rotation} position={DISPLAY_POSE.position} />
        </HandStill>
      </div>
      <figcaption className="sk-show__cap">
        <span className="sk-show__now">The key pose, sketched</span>
        <span className="sk-show__src">No expert has recorded this skill yet, so there is no motion to play.</span>
      </figcaption>
    </figure>
  );
}
