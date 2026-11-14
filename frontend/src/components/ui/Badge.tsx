import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'lapis' | 'gold' | 'ok' | 'danger';

/** Small status label. Gold is reserved for verified and mastery, danger for corrections, ok for correct. */
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`badge ${tone === 'neutral' ? '' : `badge--${tone}`}`}>{children}</span>;
}
