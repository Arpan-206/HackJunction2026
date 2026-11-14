import { useMemo } from 'react';
import { useMediaSrc, type MotionSpec, type Prop, type Side } from '../../../api';
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

/** A still of a step's key pose on the chalk hand, drawn once by the shared offscreen renderer. */
export function KeyPoseStill({ motion, prop, side, title }: Omit<VideoSlotProps, 'url'>) {
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
 * The expert's tutorial video for a lesson when there is one (`url`, a stored /api/media clip or an older link). Without
 * one it shows a still of the lesson's key pose, rendered once from the step's motion, with a play-style mark and a plain
 * line saying the tutorial plays the expert's hand instead.
 */
export function VideoSlot({ url, title, motion, prop, side }: VideoSlotProps) {
  const src = useMediaSrc(url);
  if (src) {
    return (
      <div className="ap-video">
        <video className="ap-video__el" src={src} controls preload="metadata" playsInline aria-label={`The expert's tutorial video: ${title}`} />
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
      <figcaption className="ap-video__cap">No video for this lesson yet: its tutorial plays the expert&rsquo;s hand on its own</figcaption>
    </figure>
  );
}
