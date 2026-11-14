import type { Margin } from './types';

/**
 * The learner's margin of error, mirrored from backend/app/constants.py (MARGINS, MARGIN_MULTIPLIERS, MARGIN_QUIET).
 * Each level multiplies the step's tolerance and every hint threshold; the quiet levels also stay silent while a finger
 * is inside the widened band. Keep these numbers in step with the backend.
 */
export const MARGINS: readonly Margin[] = ['strict', 'standard', 'relaxed', 'just_trying'];
export const MARGIN_MULTIPLIERS: Record<Margin, number> = { strict: 0.6, standard: 1, relaxed: 1.5, just_trying: 2.5 };
export const MARGIN_QUIET: readonly Margin[] = ['relaxed', 'just_trying'];
export const DEFAULT_MARGIN: Margin = 'standard';

export const isMargin = (v: unknown): v is Margin => typeof v === 'string' && (MARGINS as readonly string[]).includes(v);
