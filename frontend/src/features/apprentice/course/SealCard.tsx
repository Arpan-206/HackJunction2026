import { formatWhen } from '../../master/lib';

interface SealCardProps {
  master: string;
  lesson: string;
  /** ISO time the seal was earned. */
  at: string | null;
  /** Mean blind score of the whole lesson. */
  score: number | null;
}

/**
 * The Master's Seal: a gold wax seal drawn in SVG with the master's name round its rim, and the lesson, date and blind
 * score beside it. This is the one place gold is used freely; it is only shown once the lesson is earned.
 */
export function SealCard({ master, lesson, at, score }: SealCardProps) {
  const rim = `SEALED BY ${master.toUpperCase()}`;
  const initial = master.trim().charAt(0).toUpperCase() || 'M';
  return (
    <section className="ap-seal" aria-label={`Master's Seal, awarded by ${master}`}>
      <svg className="ap-seal__wax" viewBox="0 0 200 200" role="img" aria-label="Gold wax seal">
        <defs>
          <radialGradient id="ap-seal-g" cx="38%" cy="32%" r="80%">
            <stop offset="0" stopColor="#f3dc93" />
            <stop offset="0.55" stopColor="#d9b45a" />
            <stop offset="1" stopColor="#9c7a2a" />
          </radialGradient>
          <path id="ap-seal-arc" d="M100 100 m-66 0 a66 66 0 1 1 132 0 a66 66 0 1 1 -132 0" />
        </defs>
        <path
          d="M100 6c14 0 20 12 33 14 13 2 26-3 34 8s0 23 6 35c6 12 20 17 19 31s-14 18-18 30c-4 12 3 26-8 35s-23 1-35 6c-12 5-17 20-31 19s-18-14-30-18c-12-4-26 3-35-8s-1-23-6-35C24 142 9 137 10 123s14-18 18-30c4-12-3-26 8-35s23-1 35-6c12-5 17-19 29-46z"
          fill="url(#ap-seal-g)"
          stroke="#7a5d1a"
          strokeWidth="1.5"
        />
        <circle cx="100" cy="100" r="78" fill="none" stroke="#7a5d1a" strokeWidth="1.4" opacity="0.7" />
        <circle cx="100" cy="100" r="50" fill="none" stroke="#7a5d1a" strokeWidth="1.4" opacity="0.7" />
        <text fontFamily="Cinzel, Georgia, serif" fontSize="13" fontWeight="700" letterSpacing="2.4" fill="#5b4510">
          <textPath href="#ap-seal-arc" startOffset="2%">
            {rim}
          </textPath>
        </text>
        <text x="100" y="118" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontSize="56" fontWeight="700" fill="#5b4510">
          {initial}
        </text>
      </svg>
      <div className="ap-seal__body">
        <h2 className="ap-seal__title">Sealed by the Master</h2>
        <p className="ap-seal__line">
          {master} vouches for you in <em>{lesson}</em>.
        </p>
        <p className="ap-seal__meta">
          {at ? `Sealed ${formatWhen(at)}.` : ''} {score !== null ? `Blind score ${score}.` : ''}
        </p>
        <p className="note">You were reviewed on a later day and passed the duel, so this holds tomorrow too.</p>
      </div>
    </section>
  );
}
