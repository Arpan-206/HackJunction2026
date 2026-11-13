import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldMeta {
  label: string;
  /** Italic margin note under the label. */
  hint?: string;
  error?: string;
}

function ids(base: string, meta: FieldMeta) {
  return { hint: meta.hint ? `${base}-hint` : undefined, error: meta.error ? `${base}-err` : undefined };
}

/** Labelled single-line input with hint and error wiring (aria-describedby, aria-invalid). */
export function Field({ label, hint, error, className, ...rest }: FieldMeta & InputHTMLAttributes<HTMLInputElement>) {
  const base = useId();
  const d = ids(base, { label, hint, error });
  return (
    <div className="field">
      <label className="field__label" htmlFor={base}>
        {label}
      </label>
      {hint && (
        <span className="field__hint" id={d.hint}>
          {hint}
        </span>
      )}
      <input id={base} className={`field__control ${className ?? ''}`} aria-invalid={error ? true : undefined} aria-describedby={[d.hint, d.error].filter(Boolean).join(' ') || undefined} {...rest} />
      {error && (
        <span className="field__error" id={d.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

/** Labelled multi-line input, same contract as Field. */
export function TextArea({ label, hint, error, className, ...rest }: FieldMeta & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const base = useId();
  const d = ids(base, { label, hint, error });
  return (
    <div className="field">
      <label className="field__label" htmlFor={base}>
        {label}
      </label>
      {hint && (
        <span className="field__hint" id={d.hint}>
          {hint}
        </span>
      )}
      <textarea id={base} className={`field__control ${className ?? ''}`} aria-invalid={error ? true : undefined} aria-describedby={[d.hint, d.error].filter(Boolean).join(' ') || undefined} {...rest} />
      {error && (
        <span className="field__error" id={d.error} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
