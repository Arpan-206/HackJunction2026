import { Suspense, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ThemeSelect } from '../components/ThemeSelect';
import { SECTIONS } from './sections';
import './playground.css';

const GROUPS = ['Foundations', 'Components', '3D'] as const;

function fromHash(): string {
  const id = window.location.hash.slice(1);
  return SECTIONS.some((s) => s.id === id) ? id : SECTIONS[0].id;
}

/**
 * The component playground at /playground: every UI piece and the 3D hands with live controls and a copyable JSX snippet.
 * Needs no backend. Only the active section is mounted, so at most one WebGL context is alive.
 */
export default function Playground() {
  const [active, setActive] = useState(fromHash);

  useEffect(() => {
    const onHash = () => setActive(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = (id: string) => {
    setActive(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];
  const Active = section.Component;

  return (
    <div className="pg">
      <nav className="pg-nav" aria-label="Playground sections">
        <div className="pg-nav__head">
          <h1 className="pg-nav__title">Playground</h1>
          <Link to="/" className="pg-nav__back">
            Back to the app
          </Link>
          <ThemeSelect className="pg-input" />
        </div>
        {GROUPS.map((g) => (
          <div key={g}>
            <h2 className="pg-nav__group">{g}</h2>
            <ul className="pg-nav__list">
              {SECTIONS.filter((s) => s.group === g).map((s) => (
                <li key={s.id}>
                  <button type="button" className="pg-nav__item" aria-current={s.id === active ? 'page' : undefined} onClick={() => select(s.id)}>
                    {s.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <main className="pg-body">
        <Suspense fallback={<p className="note">Loading the section.</p>}>
          <Active key={section.id} />
        </Suspense>
      </main>
    </div>
  );
}
