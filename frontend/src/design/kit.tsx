import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { getParchmentUrl } from '../three';

export type World = 'codex' | 'field';

function Icon({ d }: { d: string }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** The app rail, restyled per world: iron-gall brown in the codex, lapis on the playing field. */
export function Rail({ active }: { active: 'expert' | 'learner' }) {
  const items = [
    { id: 'home', label: 'Home', d: 'M12 3.5v17M3.5 12h17M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0' },
    { id: 'expert', label: 'Expert', d: 'M12 3 4 20M12 3l8 17M7 14h10' },
    { id: 'learner', label: 'Learner', d: 'M5 20c0-4 3-6 7-6s7 2 7 6M12 4v10M8 8l4-4 4 4' },
  ];
  return (
    <nav className="dz-rail" aria-label="Main">
      <span className="dz-rail__brand" aria-hidden="true">
        <svg width="38" height="38" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="20" cy="20" r="15" />
          <path d="M20 5v30M5 20h30" />
        </svg>
      </span>
      {items.map((it) => (
        <a key={it.id} href="#" className="dz-rail__link" aria-current={it.id === active ? 'page' : undefined} onClick={(e) => e.preventDefault()}>
          <Icon d={it.d} />
          {it.label}
        </a>
      ))}
      <span className="dz-rail__foot">
        <span className="dz-rail__live" aria-hidden="true" />
        Gloves live
      </span>
    </nav>
  );
}

/** A design frame: rail, header and body in one viewport, in the codex or the playing-field world. */
export function Frame({ world, active, title, sub, aside, children, className }: { world: World; active: 'expert' | 'learner'; title: ReactNode; sub?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  const paper = useMemo(() => (world === 'codex' ? getParchmentUrl({ width: 1600, height: 1000, tone: '#DCC59A', seed: 3, vignette: true }) : null), [world]);
  const style = paper ? ({ '--dz-paper': `url(${paper})` } as CSSProperties) : undefined;
  return (
    <div className={`dz dz--${world} ${className ?? ''}`} style={style} data-world={world}>
      <Rail active={active} />
      <div className="dz-main">
        <header className="dz-head">
          <div className="dz-head__title">
            <h1>{title}</h1>
            {sub && <p className="dz-head__sub">{sub}</p>}
          </div>
          {aside}
        </header>
        {children}
      </div>
    </div>
  );
}

/** Keyboard key cap shown beside an action. */
export function Key({ children }: { children: ReactNode }) {
  return <kbd className="dz-key">{children}</kbd>;
}

/** Numbered progress steps (not pills): done ones are ticked, the current one is filled. */
export function Steps({ items, current, label }: { items: string[]; current: number; label: string }) {
  return (
    <ol className="dz-steps" aria-label={label}>
      {items.map((s, i) => (
        <li key={s} className={i < current ? 'is-done' : i === current ? 'is-now' : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="dz-steps__n">{i < current ? <Tick /> : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export function Tick({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A primary action with its key, the one big thing to do on a screen. */
export function Primary({ children, k, disabled, onClick }: { children: ReactNode; k?: string; disabled?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="btn btn--primary btn--lg dz-primary" disabled={disabled} onClick={onClick}>
      <span>{children}</span>
      {k && <Key>{k}</Key>}
    </button>
  );
}

/** The training ladder: Watch, Strings, Ghost, Blind. */
export function Ladder({ current }: { current: number }) {
  return <Steps items={['Watch', 'Strings', 'Ghost', 'Blind']} current={current} label="Training stages" />;
}

/** A calm malachite meter for how closely the learner matches; text beside it carries the number. */
export function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="dz-meter">
      <span className="dz-meter__label">{label}</span>
      <span className="dz-meter__track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}>
        <span className="dz-meter__fill" style={{ width: `${value}%` }} />
      </span>
      <span className="dz-meter__value">{value}</span>
    </div>
  );
}
