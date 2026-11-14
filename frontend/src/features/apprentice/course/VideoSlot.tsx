import { useMemo } from 'react';
import type { MotionSpec, Prop, Side } from '../../../api';
import { Hand, HandStill, Keyboard, Racket } from '../../../three';
import { synthFrame } from '../../../three/motion';
import { keyPoseTime } from '../skills/catalogue';

interface VideoSlotProps {
  url: string | null;
  title: string;
  motion: MotionSpec | null;
  prop: Prop;
  side: Side;
}

function KeyPoseStill({ motion, prop, side, title }: Omit<VideoSlotProps, 'url'>) {
  const frame = useMemo(() => synthFrame(motion ?? { preset: 'idle' }, keyPoseTime(motion), side), [motion, side]);
  // One picture per pose, drawn once by the shared offscreen renderer (see HandStill) and kept for the session.
  const stillId = `video:${JSON.stringify(motion)}:${keyPoseTime(motion)}:${side}:${prop}:chalk`;
  return (
    <HandStill
      className="ap-video__still"
      preset={prop === 'racket' ? 'racket' : prop === 'keyboard' ? 'keyboard' : 'closeup'}
      stillId={stillId}
      label={`The key pose of ${title}, shown on a chalk hand`}
    >
      {prop === 'keyboard' && <Keyboard />}
      <Hand side={side} style="chalk" frame={frame} smoothing={false}>
        {prop === 'racket' && <Racket />}
      </Hand>
    </HandStill>
  );
}

/**
 * The master's video for a lesson: a real video when `url` is set. Until video lessons arrive it shows a still of the
 * lesson's key pose, rendered once from the step's motion, with a play-style mark and a plain line of explanation.
 */
export function VideoSlot({ url, title, motion, prop, side }: VideoSlotProps) {
  if (url) {
    return (
      <div className="ap-video">
        <video className="ap-video__el" src={url} controls preload="metadata" aria-label={`Expert video: ${title}`} />
      </div>
    );
  }
  return (
    <figure className="ap-video ap-video--still">
      <KeyPoseStill motion={motion} prop={prop} side={side} title={title} />
      <span className="ap-video__play" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
      </span>
      <figcaption className="ap-video__cap">Expert&rsquo;s video, recorded with the gloves, arrives with video lessons</figcaption>
    </figure>
  );
}
