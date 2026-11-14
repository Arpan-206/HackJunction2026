import { useParams } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { Card } from './ui';

/** Stand-in for a screen a feature agent will build. Replace the page component, keep the route. */
export function Placeholder({ kicker, title, owner }: { kicker: string; title: string; owner: 'master' | 'apprentice' }) {
  const params = useParams();
  const entries = Object.entries(params);
  return (
    <>
      <PageHeader kicker={kicker} title={title} />
      <Card className="placeholder">
        <p className="note">This screen is a placeholder. It belongs to the {owner} feature agent: src/features/{owner}/.</p>
        {entries.length > 0 && (
          <p>
            Route params:{' '}
            {entries.map(([k, v]) => (
              <code key={k} style={{ marginRight: '0.5rem' }}>
                {k}={v}
              </code>
            ))}
          </p>
        )}
      </Card>
    </>
  );
}
