import { useState } from 'react';
import { Button, Card, Countdown, Field, RecordButton, Stepper, Tabs, TextArea, useToast, type ButtonVariant } from '../../components/ui';
import { PageHeader } from '../../components/PageHeader';
import { expr, toJsx } from '../jsx';
import { SectionLayout, SelectControl, SliderControl, TextControl, ToggleControl } from '../controls';

const VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'toggle'];

/** Every button variant in every state, plus the one the controls drive. */
export function ButtonsSection() {
  const [variant, setVariant] = useState<ButtonVariant>('primary');
  const [large, setLarge] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [label, setLabel] = useState('Record take');
  const [pressed, setPressed] = useState(false);
  const props = { variant: variant === 'primary' ? undefined : variant, large: large || undefined, disabled: disabled || undefined };
  return (
    <SectionLayout
      title="Buttons"
      blurb="Tab to any button to see the gold focus ring. Every target is at least 44 px."
      jsx={toJsx('Button', { ...props, 'aria-pressed': variant === 'toggle' ? pressed : undefined }, label)}
      specimen={
        <div className="pg-stack">
          <div className="pg-live">
            <Button {...props} aria-pressed={variant === 'toggle' ? pressed : undefined} onClick={() => setPressed((p) => !p)}>
              {label}
            </Button>
          </div>
          <table className="pg-matrix">
            <thead>
              <tr>
                <th scope="col">Variant</th>
                <th scope="col">Default</th>
                <th scope="col">Large</th>
                <th scope="col">Disabled</th>
                <th scope="col">Pressed</th>
              </tr>
            </thead>
            <tbody>
              {VARIANTS.map((v) => (
                <tr key={v}>
                  <th scope="row">{v}</th>
                  <td>
                    <Button variant={v}>Label</Button>
                  </td>
                  <td>
                    <Button variant={v} large>
                      Label
                    </Button>
                  </td>
                  <td>
                    <Button variant={v} disabled>
                      Label
                    </Button>
                  </td>
                  <td>
                    {v === 'toggle' ? (
                      <Button variant={v} aria-pressed="true">
                        Label
                      </Button>
                    ) : (
                      'n/a'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
      controls={
        <>
          <SelectControl label="Variant" value={variant} options={VARIANTS} onChange={setVariant} />
          <TextControl label="Label" value={label} onChange={setLabel} />
          <ToggleControl label="Large" checked={large} onChange={setLarge} />
          <ToggleControl label="Disabled" checked={disabled} onChange={setDisabled} />
        </>
      }
    />
  );
}

/** Text input and text area with hint and error wiring. */
export function FieldsSection() {
  const [label, setLabel] = useState('Lesson title');
  const [hint, setHint] = useState('Shown to apprentices in the library.');
  const [error, setError] = useState('');
  const [placeholder, setPlaceholder] = useState('Piano, bar one');
  const [multiline, setMultiline] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const props = { label, hint: hint || undefined, error: error || undefined, placeholder: placeholder || undefined, disabled: disabled || undefined };
  return (
    <SectionLayout
      title="Fields"
      blurb="Label, italic hint and a vermilion error, wired with aria-describedby and aria-invalid."
      jsx={toJsx(multiline ? 'TextArea' : 'Field', props)}
      specimen={<div className="pg-narrow">{multiline ? <TextArea {...props} rows={4} /> : <Field {...props} />}</div>}
      controls={
        <>
          <TextControl label="Label" value={label} onChange={setLabel} />
          <TextControl label="Hint" value={hint} onChange={setHint} />
          <TextControl label="Error (empty for none)" value={error} onChange={setError} />
          <TextControl label="Placeholder" value={placeholder} onChange={setPlaceholder} />
          <ToggleControl label="Multi-line (TextArea)" checked={multiline} onChange={setMultiline} />
          <ToggleControl label="Disabled" checked={disabled} onChange={setDisabled} />
        </>
      }
    />
  );
}

/** Accessible tab set with arrow-key roving focus. */
export function TabsSection() {
  const [count, setCount] = useState(3);
  const [prefix, setPrefix] = useState('Take');
  const [value, setValue] = useState('t1');
  const tabs = Array.from({ length: count }, (_, i) => ({ id: `t${i + 1}`, label: `${prefix} ${i + 1}`, content: <p>Panel {i + 1}. Use the arrow keys, Home and End.</p> }));
  const active = tabs.some((t) => t.id === value) ? value : 't1';
  return (
    <SectionLayout
      title="Tabs"
      blurb="Controlled, with a roving tabindex. Focus a tab, then use the arrow keys."
      jsx={toJsx('Tabs', {
        tabs: expr(`[${tabs.map((t) => `{ id: '${t.id}', label: '${t.label}', content: ... }`).join(', ')}]`),
        value: active,
        onChange: expr('setValue'),
      })}
      specimen={<Tabs tabs={tabs} value={active} onChange={setValue} />}
      controls={
        <>
          <SliderControl label="Tab count" value={count} min={2} max={6} onChange={setCount} />
          <TextControl label="Label prefix" value={prefix} onChange={setPrefix} />
        </>
      }
    />
  );
}

/** Numbered progress indicator. */
export function StepperSection() {
  const [labels, setLabels] = useState('Capture, Assay, Publish');
  const [current, setCurrent] = useState(1);
  const steps = labels
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
  const at = Math.min(current, steps.length);
  return (
    <SectionLayout
      title="Stepper"
      blurb="Arabic numerals, a tick for finished steps. The current step is announced to screen readers."
      jsx={toJsx('Stepper', { steps, current: at })}
      specimen={<Stepper steps={steps} current={at} />}
      controls={
        <>
          <TextControl label="Steps (comma separated)" value={labels} onChange={setLabels} />
          <SliderControl label="Current (zero-based)" value={at} min={0} max={Math.max(steps.length, 1)} onChange={setCurrent} />
        </>
      }
    />
  );
}

/** The full-screen 3-2-1 overlay. */
export function CountdownSection() {
  const [from, setFrom] = useState(3);
  const [stepMs, setStepMs] = useState(1000);
  const [caption, setCaption] = useState('Hold the glove steady');
  const [running, setRunning] = useState(false);
  return (
    <SectionLayout
      title="Countdown"
      blurb="Covers the screen, so start it with the button and let it finish."
      jsx={toJsx('Countdown', { from: from === 3 ? undefined : from, stepMs: stepMs === 1000 ? undefined : stepMs, caption: caption || undefined, onDone: expr('start') })}
      specimen={
        <div className="pg-live">
          <Button onClick={() => setRunning(true)} disabled={running}>
            Start countdown
          </Button>
          {running && <Countdown from={from} stepMs={stepMs} caption={caption || undefined} onDone={() => setRunning(false)} />}
        </div>
      }
      controls={
        <>
          <SliderControl label="From" value={from} min={1} max={9} onChange={setFrom} />
          <SliderControl label="Milliseconds per numeral" value={stepMs} min={200} max={2000} step={100} onChange={setStepMs} />
          <TextControl label="Caption" value={caption} onChange={setCaption} />
        </>
      }
    />
  );
}

/** The large record and stop control. */
export function RecordSection() {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(75);
  const [disabled, setDisabled] = useState(false);
  const [start, setStart] = useState('Record take');
  const [stop, setStop] = useState('Stop');
  return (
    <SectionLayout
      title="Record button"
      blurb="Readable from across a room. The timer appears only while recording."
      jsx={toJsx('RecordButton', { recording, onToggle: expr('toggle'), elapsedS: recording ? elapsed : undefined, disabled: disabled || undefined, labels: { start, stop } })}
      specimen={
        <div className="pg-live">
          <RecordButton recording={recording} onToggle={() => setRecording((r) => !r)} elapsedS={elapsed} disabled={disabled} labels={{ start, stop }} />
        </div>
      }
      controls={
        <>
          <ToggleControl label="Recording" checked={recording} onChange={setRecording} />
          <SliderControl label="Elapsed seconds" value={elapsed} min={0} max={600} onChange={setElapsed} />
          <ToggleControl label="Disabled" checked={disabled} onChange={setDisabled} />
          <TextControl label="Start label" value={start} onChange={setStart} />
          <TextControl label="Stop label" value={stop} onChange={setStop} />
        </>
      }
    />
  );
}

const TONES = ['info', 'ok', 'error'] as const;

/** Fires toasts through the real provider. */
export function ToastSection() {
  const toast = useToast();
  const [message, setMessage] = useState('Take saved');
  const [tone, setTone] = useState<(typeof TONES)[number]>('ok');
  const [ms, setMs] = useState(5000);
  const [action, setAction] = useState(true);
  const fire = () => toast.show(message, tone, ms, action ? { label: 'Undo', onClick: () => toast.show('Undone', 'info', 2000) } : undefined);
  return (
    <SectionLayout
      title="Toast"
      blurb="A polite live region at the bottom of the screen, with an optional action."
      jsx={`toast.show(${JSON.stringify(message)}, '${tone}', ${ms}${action ? ", { label: 'Undo', onClick: undo }" : ''});`}
      specimen={
        <div className="pg-live">
          <Button onClick={fire}>Fire toast</Button>
        </div>
      }
      controls={
        <>
          <TextControl label="Message" value={message} onChange={setMessage} />
          <SelectControl label="Tone" value={tone} options={TONES} onChange={setTone} />
          <SliderControl label="Duration (ms)" value={ms} min={1000} max={10000} step={500} onChange={setMs} />
          <ToggleControl label="Undo action" checked={action} onChange={setAction} />
        </>
      }
    />
  );
}

/** The plaster surface. */
export function CardSection() {
  const [title, setTitle] = useState('Piano, bar one');
  const [body, setBody] = useState('Five fingers, one octave, at 80 beats a minute.');
  const [flush, setFlush] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [as, setAs] = useState<'section' | 'article' | 'div'>('section');
  const props = { title: title || undefined, flush: flush || undefined, interactive: interactive || undefined, as: as === 'section' ? undefined : as };
  return (
    <SectionLayout
      title="Card"
      blurb="Lime plaster with a hairline. Interactive cards lift on hover."
      jsx={toJsx('Card', props, body)}
      specimen={
        <div className="pg-narrow">
          <Card {...props} tabIndex={interactive ? 0 : undefined}>
            {body}
          </Card>
        </div>
      }
      controls={
        <>
          <TextControl label="Title" value={title} onChange={setTitle} />
          <TextControl label="Body" value={body} onChange={setBody} />
          <ToggleControl label="Flush (no padding)" checked={flush} onChange={setFlush} />
          <ToggleControl label="Interactive" checked={interactive} onChange={setInteractive} />
          <SelectControl label="Element" value={as} options={['section', 'article', 'div']} onChange={setAs} />
        </>
      }
    />
  );
}

/** Screen title, ink rule and context line. */
export function HeaderSection() {
  const [title, setTitle] = useState('Training');
  const [context, setContext] = useState('Follow the expert, then try it alone.');
  const [actions, setActions] = useState(true);
  return (
    <SectionLayout
      title="Page header"
      blurb="Cinzel title, an ink rule, and one plain italic line of context beneath."
      jsx={toJsx('PageHeader', { title, context: context || undefined, actions: actions ? expr('<Button>Start</Button>') : undefined })}
      specimen={<PageHeader title={title} context={context || undefined} actions={actions ? <Button>Start</Button> : undefined} />}
      controls={
        <>
          <TextControl label="Title" value={title} onChange={setTitle} />
          <TextControl label="Context line" value={context} onChange={setContext} />
          <ToggleControl label="Show action" checked={actions} onChange={setActions} />
        </>
      }
    />
  );
}
