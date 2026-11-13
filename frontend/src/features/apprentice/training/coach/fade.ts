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
}

/** Guidance for an attempt number (1-based): full, then only the fingers that are out, then none. */
export function policyFor(attempt: number): AttemptPolicy {
  if (attempt <= 1) {
    return { attempt: 1, label: 'Attempt 1: full guidance', blurb: 'Every finger is guided. Follow the master.', showMaster: true, strings: 'all', liveCoach: true };
  }
  if (attempt === 2) {
    return { attempt: 2, label: 'Attempt 2: strings on mistakes only', blurb: 'Only fingers outside the tolerance are marked.', showMaster: true, strings: 'off-only', liveCoach: true };
  }
  return { attempt, label: `Attempt ${attempt}: on your own`, blurb: 'No live guidance. Your score appears at the end.', showMaster: false, strings: 'none', liveCoach: false };
}
