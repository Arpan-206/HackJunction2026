import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { MotionSpec, Prop, Side } from '../../../api';
import { Hand, HandCanvas, Keyboard, Racket } from '../../../three';
import { synthFrame } from '../../../three/motion';
import { keyPoseTime } from '../skills/catalogue';

interface VideoSlotProps {
  url: string | null;
  title: string;
  motion: MotionSpec | null;
  prop: Prop;
  side: Side;
}

/** Renders a few frames, then reads the canvas once and hands back an image so the WebGL context can be released. */
function Snapshot({ onSnap }: { onSnap: (url: string) => void }): null {
  const done = useRef(false);
  useFrame(({ gl, scene, camera, clock }) => {
    if (done.current || clock.elapsedTime < 0.9) return;
    done.current = true;
    gl.render(scene, camera);
    onSnap(gl.domElement.toDataURL('image/png'));
  });
  return null;
}

function KeyPoseStill({ motion, prop, side, title }: Omit<VideoSlotProps, 'url'>) {
  const [img, setImg] = useState<string | null>(null);
  const [near, setNear] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const frame = useMemo(() => synthFrame(motion ?? { preset: 'idle' }, keyPoseTime(motion), side), [motion, side]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={box} className="ap-video__still">
      {img ? (
        <img src={img} alt={`The key pose of ${title}, shown on a chalk hand`} />
      ) : (
        near && (
          <HandCanvas preset={prop === 'racket' ? 'racket' : prop === 'keyboard' ? 'keyboard' : 'closeup'} label={`The key pose of ${title}`}>
            {prop === 'keyboard' && <Keyboard />}
            <Hand side={side} style="chalk" frame={frame} smoothing={false}>
              {prop === 'racket' && <Racket />}
            </Hand>
            <Snapshot onSnap={setImg} />
          </HandCanvas>
        )
      )}
    </div>
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
