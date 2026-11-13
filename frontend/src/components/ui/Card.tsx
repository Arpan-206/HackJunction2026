import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Heading rendered in Cinzel. */
  title?: ReactNode;
  /** Removes padding, for media-first cards. */
  flush?: boolean;
  interactive?: boolean;
  as?: 'section' | 'article' | 'div';
}

/** A lime-plaster surface with a hairline border. */
export function Card({ title, flush, interactive, as: Tag = 'section', className, children, ...rest }: CardProps) {
  const c = ['card', flush ? 'card--flush' : '', interactive ? 'card--interactive' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <Tag className={c} {...rest}>
      {title && <h2 className="card__title">{title}</h2>}
      {children}
    </Tag>
  );
}
