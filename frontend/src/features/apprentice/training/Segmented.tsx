import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  hint?: string;
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (id: T) => void;
  /** Lay the options out as a two-column grid, for long labels. */
  grid?: boolean;
}

/** A radio-group segmented control with arrow-key navigation and 44 px targets. */
export function Segmented<T extends string>({ label, value, options, onChange, grid }: SegmentedProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className={`ap-seg ${grid ? 'ap-seg--grid' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          title={o.hint}
          className="ap-seg__opt"
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
