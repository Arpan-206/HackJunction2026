import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'toggle';

interface Common {
  variant?: ButtonVariant;
  /** Larger size for projector-distance actions. */
  large?: boolean;
}

const cls = (v: ButtonVariant, large?: boolean, extra?: string) => ['btn', `btn--${v}`, large ? 'btn--lg' : '', extra ?? ''].filter(Boolean).join(' ');

/** A real button with a 44 px minimum target and gold focus ring. */
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & Common>(function Button(
  { variant = 'primary', large, className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} className={cls(variant, large, className)} {...rest} />;
});

/** A router link styled as a button. */
export function ButtonLink({ variant = 'primary', large, className, ...rest }: LinkProps & Common) {
  return <Link className={cls(variant, large, className)} {...rest} />;
}
