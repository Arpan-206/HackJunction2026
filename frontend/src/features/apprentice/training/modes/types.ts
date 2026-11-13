import type { GloveStreamHandle, Prop, Side } from '../../../../api';
import type { Coach } from '../coach/useCoach';
import type { AttemptPolicy } from '../coach/fade';

/** What every guidance mode needs to draw the master and the learner. */
export interface ModeProps {
  coach: Coach;
  gloves: GloveStreamHandle;
  side: Side;
  prop: Prop;
  policy: AttemptPolicy;
}

/** Height in scene units at which the marionette's master hand hovers above the learner's. */
export const MASTER_LIFT = 1.25;
