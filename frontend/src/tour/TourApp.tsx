import { lazy, Suspense, useCallback, useEffect, useState, type ComponentType } from 'react';
import { loadTake } from './data';
import ExpertStop from './stops/ExpertStop';

interface StopDef {
  title: string;
  /** What the live version adds, shown on every stop. */
  live: string;
  load: () => Promise<{ default: ComponentType }>;
}

/** The five stops, in order. Each stop's code and data load only when it opens. */
export const STOPS: StopDef[] = [
  {
    title: 'An expert records a step',
    live: 'An expert wears the Rokoko gloves and records the step once. The take is saved as a lesson step in a few seconds.',
    load: () => Promise.resolve({ default: ExpertStop }),
  },
  {
    title: 'The training room',
    live: 'You wear the gloves. Your own hand moves on the stage, the corrections follow it about 30 times a second, and your score comes when the rep ends.',
    load: () => import('./stops/TrainingStop'),
  },
  {
    title: 'The AI Assistant',
    live: 'After a rep, the AI Assistant writes one short line about the finger to fix, in English, German or Finnish.',
    load: () => import('./stops/CoachStop'),
  },
  {
    title: 'The robot hand',
    live: 'The glove engine streams joint targets for a Unitree Dex3-1 robot hand while you move, and the twin on screen follows your hand.',
    load: () => import('./stops/RobotStop'),
  },
  {
    title: 'Teach Pinocchio',
    live: 'You can also show Pinocchio the step with your own gloved hand, or say the change out loud.',
    load: () => import('./stops/TeachStop'),
  },
];

// The first stop is part of the shell's own chunk (its text and poster need no other code); its 3D stage loads behind it.
const PAGES: ComponentType[] = STOPS.map((s, i) => (i === 0 ? ExpertStop : lazy(s.load)));

// The first stop's code and take start loading with the shell, in parallel, instead of one after the other.
if (typeof window !== 'undefined') {
  const first = stopFromHash(window.location.hash);
  void STOPS[first].load();
  if (first === 0) void loadTake('expert');
}

/** The stop index (0 to 4) from the address hash: #/1 to #/5. Anything else is the first stop. */
export function stopFromHash(hash: string): number {
  const m = /^#\/?(\d+)/.exec(hash);
  const n = m ? Number(m[1]) : 1;
  return Math.min(STOPS.length, Math.max(1, n)) - 1;
}

export const BADGE = 'Recorded session, the live version uses Rokoko gloves';

export function TourApp() {
  const [stop, setStop] = useState(() => stopFromHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setStop(stopFromHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = useCallback((i: number) => {
    const n = Math.min(STOPS.length - 1, Math.max(0, i));
    window.location.hash = `#/${n + 1}`;
    setStop(n);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === 'ArrowRight') go(stop + 1);
      if (e.key === 'ArrowLeft') go(stop - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, stop]);

  // Warm the next stop's code once this one has painted, so Next feels instant.
  useEffect(() => {
    const next = STOPS[stop + 1];
    if (!next) return;
    const id = window.setTimeout(() => void next.load(), 1500);
    return () => window.clearTimeout(id);
  }, [stop]);

  useEffect(() => {
    document.title = `Geppetto tour: ${STOPS[stop].title}`;
  }, [stop]);

  const Page = PAGES[stop];
  const def = STOPS[stop];
  return (
    <div className="tour">
      <header className="tour-head">
        <p className="tour-badge">{BADGE}</p>
        <div className="tour-head__row">
          <h1 className="tour-brand">Geppetto</h1>
          <nav className="tour-progress" aria-label="Tour stops">
            <ol>
              {STOPS.map((s, i) => (
                <li key={s.title}>
                  <a
                    href={`#/${i + 1}`}
                    aria-current={i === stop ? 'step' : undefined}
                    aria-label={`Stop ${i + 1}: ${s.title}`}
                    className={i === stop ? 'is-here' : i < stop ? 'is-past' : ''}
                  >
                    {i + 1}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </header>

      <main className="tour-main">
        <h2 className="tour-title">
          <span className="tour-title__n">Stop {stop + 1} of {STOPS.length}.</span> {def.title}
        </h2>
        <Suspense fallback={<p className="tour-loading">Loading this stop...</p>}>
          <Page key={stop} />
        </Suspense>
        <aside className="tour-live" aria-label="What you would see live">
          <h3>What you would see live</h3>
          <p>{def.live}</p>
        </aside>
        <p className="tour-site">
          <a href="./sbom.html">What's in this site</a>
          {' · '}
          <a href="./explore.html">Explore the whole app, no gloves needed</a>
          {' · '}
          <a href="./stats.html">Boring stats for nerds</a>
        </p>
      </main>

      <footer className="tour-nav">
        <button type="button" className="btn btn--secondary tour-nav__btn" onClick={() => go(stop - 1)} disabled={stop === 0}>
          Back
        </button>
        <span className="tour-nav__where" aria-live="polite">
          {stop + 1} / {STOPS.length}
        </span>
        {stop === STOPS.length - 1 ? (
          <a className="btn btn--primary tour-nav__btn" href="./explore.html">
            Explore the whole app
          </a>
        ) : (
          <button type="button" className="btn btn--primary tour-nav__btn" onClick={() => go(stop + 1)}>
            Next
          </button>
        )}
      </footer>
    </div>
  );
}
