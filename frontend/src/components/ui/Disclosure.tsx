import type { ReactNode } from 'react';

interface DisclosureProps {
  /** The always-visible line that opens and closes the section. */
  summary: ReactNode;
  children: ReactNode;
  /** Starts open. Closed by default, so secondary controls stay out of the way. */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * A quiet, native disclosure (details and summary) for secondary settings: keyboard and screen-reader support come from the
 * browser. The summary is plain text with a drawn chevron, never a pill.
 */
export function Disclosure({ summary, children, defaultOpen, className }: DisclosureProps) {
  return (
    <details className={['disclosure', className ?? ''].filter(Boolean).join(' ')} open={defaultOpen}>
      <summary className="disclosure__summary">{summary}</summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
