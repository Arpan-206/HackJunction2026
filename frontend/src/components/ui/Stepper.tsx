export interface StepperItem {
  label: string;
}

/** Horizontal numbered progress (Arabic numerals), e.g. Capture, Assay, Publish. `current` is zero-based. */
export function Stepper({ steps, current, label = 'Progress' }: { steps: StepperItem[]; current: number; label?: string }) {
  return (
    <ol className="stepper" aria-label={label}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={s.label} className={`stepper__item stepper__item--${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="stepper__dot" aria-hidden="true">
              {state === 'done' ? '✓' : i + 1}
            </span>
            <span className="stepper__label">
              {s.label}
              <span className="sr-only">{state === 'done' ? ' (done)' : state === 'current' ? ' (current)' : ''}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
