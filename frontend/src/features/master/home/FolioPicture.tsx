import { useEffect, useMemo, useRef, useState } from 'react';
import type { HandFrame, Lesson, Side } from '../../../api';
import { HandStill } from '../../../three';
import { synthFrame } from '../../../three/motion';
import { CATALOGUE, keyPoseTime, type SkillScene } from '../../apprentice/skills/catalogue';
import { sceneStage, SkillSet } from '../../apprentice/skills/SkillScene';
import { framesDuration, handAt } from '../../shared/playback';
import { useRecording } from '../hooks/useRecording';

/** The share of a recorded take its picture is taken at: past the start, before the hand settles back. */
const TAKE_SHARE = 0.4;

const sideOf = (hands: Lesson['steps'][number]['hands'] | undefined): Side => (hands === 'left' ? 'left' : 'right');

/** The chalk hand of a lesson's first step, in its skill's first-person scene, drawn once as a picture. */
function StepStill({ lesson, scene, frame, source }: { lesson: Lesson; scene: SkillScene; frame: HandFrame | null; source: string }) {
  const side = sideOf(lesson.steps[0]?.hands);
  const stage = useMemo(() => sceneStage(scene), [scene]);
  return (
    <HandStill className="folio__still" preset="closeup" label={`${lesson.steps[0]?.title ?? lesson.title}, the first move`} stillId={`folio:${scene}:${source}:${side}:chalk`} decor stage={stage}>
      <SkillSet scene={scene} side={side} frame={frame} />
    </HandStill>
  );
}

/** A step without a guide motion: its picture comes from the reference take, fetched once the folio nears the screen. */
function TakeStill({ lesson, scene, recordingId }: { lesson: Lesson; scene: SkillScene; recordingId: string }) {
  const { recording } = useRecording(recordingId);
  const side = sideOf(lesson.steps[0]?.hands);
  const frame = useMemo(() => {
    const frames = recording?.frames;
    return frames && frames.length > 1 ? handAt(frames, framesDuration(frames) * TAKE_SHARE, side) : null;
  }, [recording, side]);
  if (!frame) return <span className="folio__still folio__still--blank" aria-hidden="true" />;
  return <StepStill lesson={lesson} scene={scene} frame={frame} source={`take:${recordingId}`} />;
}

/**
 * A lesson folio's picture: the skill's own still image when the catalogue has one (the shadow puppets wall), else the
 * expert's chalk hand in the first step's pose, from its guide motion or its reference take, in the skill's scene (racket,
 * keys or a raised hand), the same pictures the apprentice dashboard shows.
 */
export function FolioPicture({ lesson }: { lesson: Lesson }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const entry = CATALOGUE.find((c) => c.id === lesson.skill);
  const scene: SkillScene = entry?.scene ?? 'letter';
  const step = lesson.steps[0];
  const motion = step?.motion && step.motion.preset !== 'idle' ? step.motion : null;

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (e) => {
        if (e.some((x) => x.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  let picture = null;
  if (entry?.still && lesson.source === 'seed') picture = <img className="folio__still" src={entry.still.src} alt={entry.still.alt} loading="lazy" />;
  else if (near && motion) {
    const frame = synthFrame(motion, keyPoseTime(motion), sideOf(step?.hands));
    picture = <StepStill lesson={lesson} scene={scene} frame={frame} source={JSON.stringify(motion)} />;
  } else if (near && step?.reference_recording_id) picture = <TakeStill lesson={lesson} scene={scene} recordingId={step.reference_recording_id} />;
  else if (near) picture = <StepStill lesson={lesson} scene={scene} frame={synthFrame({ preset: 'idle' }, 0, sideOf(step?.hands))} source="idle" />;

  return (
    <div ref={box} className="folio__pic">
      {picture}
    </div>
  );
}
