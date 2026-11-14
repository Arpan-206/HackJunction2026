import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MARGINS } from '../../api/margin';
import { Button } from '../../components/ui';
import { useAssistant } from './assistant';
import { PROP_NOTE, useShowProps } from './sessionPrefs';
import { MARGIN_INFO, systemReducesMotion, useMargin, useReducedMotion, useScoreView, type ScoreView } from './settings';
import './settings.css';

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

const VIEWS: { id: ScoreView; label: string; blurb: string }[] = [
  { id: '3d', label: '3D scene', blurb: 'Your hand on the bench, each finger’s score on a leader line.' },
  { id: '2d', label: 'Flat chart', blurb: 'A high-contrast bar for each finger and the timing.' },
];

/** A labelled on/off switch: the track carries the state, and the word On or Off says it without colour. */
function Switch({ on, onChange, label, note }: { on: boolean; onChange: (on: boolean) => void; label: string; note: ReactNode }) {
  const noteId = useId();
  return (
    <div className="settings__row">
      <button type="button" role="switch" aria-checked={on} aria-describedby={noteId} className="settings-switch" onClick={() => onChange(!on)}>
        <span className="settings-switch__label">{label}</span>
        <span className="settings-switch__state" aria-hidden="true">
          <span className="settings-switch__track">
            <span className="settings-switch__knob" />
          </span>
          {on ? 'On' : 'Off'}
        </span>
      </button>
      <p id={noteId} className="settings__note">
        {note}
      </p>
    </div>
  );
}

/** A radio group drawn as a column of choices, each with one line of plain words. Arrow keys move between them. */
function Choices<T extends string>({ legend, name, value, options, onChange, note }: { legend: string; name: string; value: T; options: { id: T; label: string; blurb: string }[]; onChange: (v: T) => void; note?: ReactNode }) {
  return (
    <fieldset className="settings__group">
      <legend className="settings__legend">{legend}</legend>
      {note && <p className="settings__note">{note}</p>}
      <div className="settings__choices">
        {options.map((o) => (
          <label key={o.id} className={`settings-choice ${value === o.id ? 'settings-choice--on' : ''}`}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            <span className="settings-choice__text">
              <span className="settings-choice__label">{o.label}</span>
              <span className="settings-choice__blurb">{o.blurb}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface SettingsDialogProps {
  onClose: () => void;
  /** Where focus goes when the panel closes: the Settings button that opened it. */
  returnFocus: RefObject<HTMLElement>;
}

/**
 * The Settings and accessibility panel: AI Assistant, margin of error, how the score is shown, props and reduced motion.
 * A modal dialog over the whole app: focus moves in and is trapped, Escape or the scrim closes it, focus returns to the
 * opener, and the app behind is inert. Every choice applies at once and is remembered on this device.
 */
export function SettingsDialog({ onClose, returnFocus }: SettingsDialogProps) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [assistant, setAssistant] = useAssistant();
  const [margin, setMargin] = useMargin();
  const [view, setView] = useScoreView();
  const [props, setProps] = useShowProps();
  const [reduce, setReduce] = useReducedMotion();
  const deviceReduces = systemReducesMotion();

  useEffect(() => {
    const box = panel.current;
    const opener = returnFocus.current;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    const items = () => Array.from(box?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((el) => el.offsetParent !== null || el === document.activeElement);
    box?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const list = items();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (!box.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      root?.removeAttribute('inert');
      opener?.focus();
    };
  }, [returnFocus]);

  return createPortal(
    <div className="settings-scrim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="settings" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="settings__head">
          <h2 id={titleId} className="settings__title" tabIndex={-1} data-autofocus>
            Settings
          </h2>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="settings__body">
          <section className="settings__section" aria-labelledby={`${titleId}-ai`}>
            <h3 id={`${titleId}-ai`} className="settings__h">
              AI Assistant
            </h3>
            <Switch
              on={assistant}
              onChange={setAssistant}
              label="Enable AI Assistant"
              note="Drafts lesson steps from words or a video, reads movements described in words, writes practice plans and live hints. Scoring and the finger corrections work without it."
            />
          </section>

          <section className="settings__section">
            <Choices
              legend="Margin of error"
              name="margin"
              value={margin}
              onChange={setMargin}
              note="How close to the expert a rep must be to pass. It widens or narrows the expert's room for error, for the score and for the live corrections."
              options={MARGINS.map((m) => ({ id: m, label: MARGIN_INFO[m].label, blurb: MARGIN_INFO[m].blurb }))}
            />
          </section>

          <section className="settings__section">
            <Choices legend="Show the score as" name="score-view" value={view} onChange={setView} options={VIEWS} note="On the score screen you can also click or tap the score to flip between the two." />
          </section>

          <section className="settings__section" aria-labelledby={`${titleId}-stage`}>
            <h3 id={`${titleId}-stage`} className="settings__h">
              Stage and motion
            </h3>
            <Switch on={props} onChange={setProps} label="Add a prop" note={`Draws the racket or keyboard with the hands in the rooms. ${PROP_NOTE} It applies to the Test your skills games too.`} />
            <Switch
              on={reduce}
              onChange={setReduce}
              label="Reduce motion"
              note={deviceReduces ? 'Your device asks for less motion, so sliding and fading effects stay short either way.' : 'Stops sliding and fading effects and the turning hands on skill pages.'}
            />
          </section>
        </div>

        <footer className="settings__foot">
          <p className="settings__note">Saved on this device as you choose.</p>
          <Button large onClick={onClose}>
            Done
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** The rail footer's "Settings" entry: a text button that opens the panel and gets focus back when it closes. */
export function SettingsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" className={className} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="8" cy="17" r="2" />
        </svg>
        Settings
      </button>
      {open && <SettingsDialog onClose={() => setOpen(false)} returnFocus={button} />}
    </>
  );
}
