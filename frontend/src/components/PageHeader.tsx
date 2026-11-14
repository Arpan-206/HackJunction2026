import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Deprecated alias of `context`: now rendered below the title, never above it. */
  kicker?: string;
  /** Plain italic Garamond line below the title, for context only. */
  context?: string;
  title: string;
  actions?: ReactNode;
}

/** Standard screen header: Cinzel title, an ink rule, and an optional Garamond context line beneath. Use on every routed page. */
export function PageHeader({ kicker, context, title, actions }: PageHeaderProps) {
  const line = context ?? kicker;
  return (
    <header className="page-head">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <h1>{title}</h1>
        {actions}
      </div>
      <div className="page-head__rule" aria-hidden="true" />
      {line && <p className="page-head__context">{line}</p>}
    </header>
  );
}
