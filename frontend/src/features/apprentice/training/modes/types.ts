import type { MutableRefObject } from 'react';
import type { GloveStreamHandle, Prop, Side } from '../../../../api';
import type { Coach } from '../coach/useCoach';
import type { AttemptPolicy } from '../coach/fade';

/** What every guidance mode needs to draw the master and the learner. */
export interface ModeProps {
  coach: Coach;
  gloves: GloveStreamHandle;
  side: Side;
  /** The prop drawn as a solid model: the step's prop when "Add a prop" is on, else 'none'. */
  prop: Prop;
  /** The prop drawn as a chalk sketch instead: the step's prop when "Add a prop" is off, else 'none'. */
  cue: Prop;
  policy: AttemptPolicy;
  /** Tolerance in degrees per finger, used to decide which fingers get a correction mark. */
  toleranceDeg: number;
  /** Clean-rep combo for the marionette strings: how far they have frayed, and a counter that bumps when they snap. */
  combo?: { count: number; need: number; snapKey: number; played: MutableRefObject<number> };
}

/** Height in scene units at which the marionette's master hand hovers above the learner's. */
export const MASTER_LIFT = 1.25;
