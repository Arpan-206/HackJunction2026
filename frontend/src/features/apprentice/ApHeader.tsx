import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface BackLinkProps {
  to: string;
  children: ReactNode;
}

/** The one back link used on the course, training and test pages: an arrow and a plain label. */
export function BackLink({ to, children }: BackLinkProps) {
  return (
    <Link className="ap-back" to={to}>
      <span aria-hidden="true">&larr;</span> {children}
    </Link>
  );
}

interface ApHeaderProps {
  title: string;
  /** A plain line after the title for context (the lesson, the master); never a kicker above it. */
  context?: string;
  back?: { to: string; label: string };
}

/** A compact single-line page header for the stage pages, so the stage keeps most of the viewport. */
export function ApHeader({ title, context, back }: ApHeaderProps) {
  return (
    <header className="ap-head">
      <h1>{title}</h1>
      {context && <p className="ap-head__context">{context}</p>}
      {back && <BackLink to={back.to}>{back.label}</BackLink>}
    </header>
  );
}
