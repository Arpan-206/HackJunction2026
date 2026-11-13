import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Italic line above the title, e.g. "Il maestro". */
  kicker?: string;
  title: string;
  actions?: ReactNode;
}

/** Standard screen header: Garamond kicker, Cinzel title, gold rule. Use on every routed page. */
export function PageHeader({ kicker, title, actions }: PageHeaderProps) {
  return (
    <header className="page-head">
      {kicker && <p className="page-head__kicker">{kicker}</p>}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <h1>{title}</h1>
        {actions}
      </div>
      <div className="page-head__rule" aria-hidden="true" />
    </header>
  );
}
