import type { Finger } from '../../../../api/types';
import type { Stage } from '../../pipeline/stages';

export type StringsPolicy = 'all' | 'off-only' | 'none';

/** What guidance an attempt gets. Feedback fades with attempts, then the score arrives. */
export interface AttemptPolicy {
  attempt: number;
  label: string;
  blurb: string;
  showMaster: boolean;
  strings: StringsPolicy;
  /** Live per-finger status, tip and match meter. */
  liveCoach: boolean;
  /** The pipeline stage this policy was built for, when it came from the stage machine. */
  stage?: Stage;
  /** When set, only these fingers get live guidance (the Ghost stage marks the ones that were wrong last rep). */
  focus?: Finger[];
}

/**
 * How much guidance a pipeline stage gives. The guidance mode chooses how it is drawn; the stage chooses how much.
 * Watch shows the master with nothing scored, Strings guides every finger, Ghost guides only the fingers that were wrong
 * last rep, and Blind shows nothing live.
 */
export function policyForStage(stage: Stage, wrongFingers: Finger[] = [], attempt = 1): AttemptPolicy {
  switch (stage) {
    case 'watch':
      return { attempt, stage, label: 'Watch', blurb: 'The expert plays it slowly, then at full speed. Nothing is scored yet.', showMaster: true, strings: 'none', liveCoach: false };
    case 'strings':
      return { attempt, stage, label: 'Strings', blurb: 'Every finger is guided. Follow the expert.', showMaster: true, strings: 'all', liveCoach: true };
    case 'ghost':
      return {
        attempt,
        stage,
        label: 'Ghost',
        blurb: wrongFingers.length ? 'Only the fingers that were wrong last time are marked.' : 'The expert is faint and guides only a finger that drifts.',
        showMaster: true,
        strings: 'off-only',
        liveCoach: true,
        focus: wrongFingers.length ? wrongFingers : undefined,
      };
    default:
      return { attempt, stage, label: 'Blind', blurb: 'No live guidance. Your score appears at the end.', showMaster: false, strings: 'none', liveCoach: false };
  }
}

/** Guidance for an attempt number (1-based): full, then only the fingers that are out, then none. */
export function policyFor(attempt: number): AttemptPolicy {
  if (attempt <= 1) {
    return { attempt: 1, label: 'Attempt 1: full guidance', blurb: 'Every finger is guided. Follow the expert.', showMaster: true, strings: 'all', liveCoach: true };
  }
  if (attempt === 2) {
    return { attempt: 2, label: 'Attempt 2: strings on mistakes only', blurb: 'Only fingers outside the tolerance are marked.', showMaster: true, strings: 'off-only', liveCoach: true };
  }
  return { attempt, label: `Attempt ${attempt}: on your own`, blurb: 'No live guidance. Your score appears at the end.', showMaster: false, strings: 'none', liveCoach: false };
}
