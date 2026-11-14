import { Link } from 'react-router-dom';
import { HandCanvas, Hand } from '../three';
import type { MotionSpec } from '../api';
import { ThemeSwitch } from '../components/ThemeSelect';

const masterMotion: MotionSpec = { preset: 'finger_sequence', sequence: [1, 2, 3, 4, 5, 4, 3, 2], beat_ms: 700 };
const apprenticeMotion: MotionSpec = { preset: 'finger_sequence', sequence: [5, 4, 3, 2, 1, 2, 3, 4], beat_ms: 900 };

function Arrow() {
  return (
    <svg width="28" height="14" viewBox="0 0 28 14" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M0 7h25M19 1l7 6-7 6" />
    </svg>
  );
}

/** First screen: choose Expert or Apprentice, each with a live 3D hand. */
export function RoleSelect() {
  return (
    <div className="roles">
      <header className="roles__head">
        <h1 className="roles__brand">Apprentice</h1>
        <p className="roles__motto">Bottega della mano: a skill of the hand is learned from a hand.</p>
      </header>

      <main className="roles__stage" id="main">
        <Link to="/expert" className="role">
          <div className="role__stage">
            <HandCanvas preset="closeup" sway={0.12} stage={{ controls: 'none' }}>
              <Hand side="right" style="chalk" motion={masterMotion} showJoints showTrails position={[0, 0, 0]} rotation={[0, 0.1, 0]} />
            </HandCanvas>
          </div>
          <div className="role__plate">
            <span className="role__title">I am an Expert</span>
            <span className="role__desc">Record a skill once with your gloves, shape it into steps, and let learners train against your hand.</span>
            <span className="role__cta">
              Enter the studio <Arrow />
            </span>
          </div>
        </Link>

        <div className="roles__between" aria-hidden="true">
          <svg viewBox="0 0 60 120" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="30" cy="60" r="26" />
            <rect x="8" y="38" width="44" height="44" />
            <path d="M30 0v34M30 86v34" />
          </svg>
        </div>

        <Link to="/apprentice" className="role">
          <div className="role__stage">
            <HandCanvas preset="closeup" sway={0.12} stage={{ controls: 'none' }}>
              <Hand side="left" style="wood" motion={apprenticeMotion} position={[0, 0, 0]} rotation={[0, -0.1, 0]} />
            </HandCanvas>
          </div>
          <div className="role__plate">
            <span className="role__title">I am an Apprentice</span>
            <span className="role__desc">Follow the expert&rsquo;s hand, see exactly which finger is wrong, and watch your score climb.</span>
            <span className="role__cta">
              Begin learning <Arrow />
            </span>
          </div>
        </Link>
      </main>

      <footer className="roles__foot">
        <span>Junction 2026 &middot; Rokoko Smartgloves</span>
        <ThemeSwitch />
      </footer>
    </div>
  );
}
