import { Link } from 'react-router-dom';
import { useLessons } from '../../api';
import { PageHeader } from '../../components/PageHeader';
import { Badge, Card } from '../../components/ui';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function Arrow() {
  return (
    <svg width="26" height="12" viewBox="0 0 28 14" aria-hidden="true" {...stroke}>
      <path d="M0 7h25M19 1l7 6-7 6" />
    </svg>
  );
}

/** Master landing: start from scratch or generate steps, then existing lessons. */
export function MasterHome() {
  const { data: lessons, error, loading } = useLessons();
  return (
    <>
      <PageHeader kicker="Il maestro" title="Master's studio" />
      <div className="choices">
        <Card as="article" className="choice card--interactive">
          <Link to="/master/scratch" style={{ position: 'absolute', inset: 0 }} aria-label="Start from scratch" />
          <svg className="choice__icon" viewBox="0 0 64 64" aria-hidden="true" {...stroke}>
            <circle cx="32" cy="32" r="22" />
            <path d="M32 6 16 58M32 6l16 52M21 38h22" />
            <circle cx="32" cy="6" r="2.5" />
          </svg>
          <h2>Start from scratch</h2>
          <p className="note">Choose each move yourself from the catalogue, set repetitions and room for error, then record your takes.</p>
          <span className="choice__cta">
            Compose steps <Arrow />
          </span>
        </Card>

        <Card as="article" className="choice card--interactive">
          <Link to="/master/generate" style={{ position: 'absolute', inset: 0 }} aria-label="Generate steps" />
          <svg className="choice__icon" viewBox="0 0 64 64" aria-hidden="true" {...stroke}>
            <path d="M12 54 44 12c3-4 8-4 8 0s-4 5-8 8L18 54z" />
            <path d="M40 22l4 4" />
            <path d="M50 38v10M45 43h10M14 14v8M10 18h8" />
          </svg>
          <h2>Generate steps</h2>
          <p className="note">Describe the skill in your own words and a lesson plan is drafted for you to adjust before recording.</p>
          <span className="choice__cta">
            Describe a lesson <Arrow />
          </span>
        </Card>
      </div>

      <h2 className="section-title">Your lessons</h2>
      {loading && <p className="note">Consulting the ledger...</p>}
      {error && <p className="note">The backend is not answering ({error.message}). Lessons will appear here once it is.</p>}
      {lessons && lessons.length === 0 && <p className="note">No lessons yet. Begin one above.</p>}
      {lessons && lessons.length > 0 && (
        <ul className="lesson-list">
          {lessons.map((l) => (
            <li key={l.id}>
              <Link to={`/master/lessons/${l.id}`} className="card card--interactive lesson-row">
                <span>
                  <strong>{l.title}</strong> <span className="note">{l.steps.length} steps</span>
                </span>
                <Badge tone={l.source === 'seed' ? 'lapis' : 'neutral'}>{l.source}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
