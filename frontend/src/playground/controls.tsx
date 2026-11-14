import { useId, type ReactNode } from 'react';
import { Button, useToast } from '../components/ui';

/** A labelled row in the controls panel. */
function Row({ label, id, children, value }: { label: string; id: string; children: ReactNode; value?: ReactNode }) {
  return (
    <div className="pg-row">
      <label className="pg-row__label" htmlFor={id}>
        <span>{label}</span>
        {value !== undefined && <output className="pg-row__value">{value}</output>}
      </label>
      {children}
    </div>
  );
}

/** Dropdown over a fixed list of string options. */
export function SelectControl<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  const id = useId();
  return (
    <Row label={label} id={id}>
      <select id={id} className="pg-input" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Row>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Formats the read-out beside the label. */
  format?: (v: number) => string;
}

/** Range slider with a live numeric read-out. */
export function SliderControl({ label, value, min, max, step = 1, onChange, format }: SliderProps) {
  const id = useId();
  return (
    <Row label={label} id={id} value={format ? format(value) : value}>
      <input id={id} className="pg-range" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Row>
  );
}

/** Checkbox styled as a 44 px row. */
export function ToggleControl({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="pg-toggle">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>{label}</label>
    </div>
  );
}

/** Single-line text input. */
export function TextControl({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <Row label={label} id={id}>
      <input id={id} className="pg-input" type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </Row>
  );
}

/** Colour picker. */
export function ColourControl({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <Row label={label} id={id} value={value}>
      <input id={id} className="pg-colour" type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </Row>
  );
}

/** Mutually exclusive buttons, exposed as a radio group. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="pg-row" role="radiogroup" aria-label={label}>
      <span className="pg-row__label">{label}</span>
      <div className="pg-seg">
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={o === value} className="pg-seg__btn" onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Copies the given text to the clipboard and confirms with a toast. */
export function CopyButton({ text }: { text: string }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    toast.show('JSX copied to the clipboard', 'ok', 2500);
  };
  return (
    <Button variant="secondary" onClick={copy}>
      Copy JSX
    </Button>
  );
}

interface LayoutProps {
  title: string;
  blurb: string;
  specimen: ReactNode;
  controls: ReactNode;
  /** The JSX snippet for the current props. */
  jsx: string;
  /** Gives the specimen a fixed 3D viewport height. */
  canvas?: boolean;
}

/** Standard section layout: specimen and snippet on the left, controls and the copy button on the right. */
export function SectionLayout({ title, blurb, specimen, controls, jsx, canvas }: LayoutProps) {
  return (
    <div className="pg-section">
      <div className="pg-main">
        <h2 className="pg-title">{title}</h2>
        <p className="note">{blurb}</p>
        <div className={`pg-stage ${canvas ? 'pg-stage--canvas' : ''}`}>{specimen}</div>
        <pre className="pg-code" aria-label="Current JSX">
          <code>{jsx}</code>
        </pre>
      </div>
      <aside className="pg-controls" aria-label={`${title} controls`}>
        <h3 className="pg-controls__head">Controls</h3>
        {controls}
        <CopyButton text={jsx} />
      </aside>
    </div>
  );
}
