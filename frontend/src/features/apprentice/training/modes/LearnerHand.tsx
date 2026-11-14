import { forwardRef } from 'react';
import { Hand, Racket, RacketSketch, type HandHandle } from '../../../../three';
import type { GloveStreamHandle, Prop, Side } from '../../../../api';
import type { Coach } from '../coach/useCoach';

interface LearnerHandProps {
  coach: Coach;
  gloves: GloveStreamHandle;
  side: Side;
  prop: Prop;
  /** The prop sketched in chalk because props are off. Only the racket is drawn in the hand. */
  cue?: Prop;
  position?: [number, number, number];
  rotation?: [number, number, number];
}

/** The apprentice's carved wooden hand, driven by the (possibly perturbed) live glove frame from the coach. */
export const LearnerHand = forwardRef<HandHandle, LearnerHandProps>(function LearnerHand({ coach, gloves, side, prop, cue, position, rotation }, ref) {
  return (
    <Hand ref={ref} side={side} style="wood" live={gloves.latest} getFrame={() => coach.live.current.learner} position={position} rotation={rotation}>
      {prop === 'racket' && <Racket />}
      {cue === 'racket' && <RacketSketch />}
    </Hand>
  );
});

interface MasterHandProps {
  coach: Coach;
  side: Side;
  prop: Prop;
  style: 'chalk' | 'ghost' | 'shadow';
  scale?: number;
  /** The prop sketched in chalk because props are off, drawn only with `withProp`. */
  cue?: Prop;
  /** Hold the racket too, for the side by side view. */
  withProp?: boolean;
  position?: [number, number, number];
  rotation?: [number, number, number];
  opacity?: number;
}

/** The master's reference hand at the coach's reference time. */
export const MasterHand = forwardRef<HandHandle, MasterHandProps>(function MasterHand({ coach, side, prop, cue, style, scale, withProp, position, rotation, opacity }, ref) {
  return (
    <Hand ref={ref} side={side} style={style} getFrame={() => coach.live.current.master} position={position} rotation={rotation} scale={scale} opacity={opacity}>
      {prop === 'racket' && withProp && <Racket />}
      {cue === 'racket' && withProp && <RacketSketch />}
    </Hand>
  );
});
