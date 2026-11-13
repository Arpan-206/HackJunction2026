import { useId } from 'react';
import { Button, Card } from '../../../components/ui';
import type { SteadinessHandle } from '../hooks/useSteadiness';

/**
 * The "Steadiness" slider: maps to the backend One Euro filter so a master can calm natural hand tremor
 * without making the hand feel sluggish. Also toggles the raw signal for comparison.
 */
export function SteadinessControl({ control }: { control: SteadinessHandle }) {
  const id = useId();
  const { steadiness, setSteadiness, raw, setRaw, online, error } = control;
  return (
    <Card title="Steadiness" className="mst-steady">
      <p className="note">
        Every hand trembles a little, even a master&rsquo;s. Raise steadiness to calm the tremor; lower it if the hand feels slow to follow you.
      </p>
      <div className="mst-steady__row">
        <label htmlFor={id} className="mst-steady__end">
          Responsive
        </label>
        <input id={id} type="range" min={0} max={1} step={0.01} value={steadiness} onChange={(e) => setSteadiness(Number(e.target.value))} disabled={!online || raw} aria-valuetext={`${Math.round(steadiness * 100)} per cent steady`} />
        <span className="mst-steady__end">Steady</span>
        <output className="mst-steady__value" htmlFor={id}>
          {Math.round(steadiness * 100)}
        </output>
      </div>
      <div className="mst-steady__row">
        <Button variant={raw ? 'primary' : 'secondary'} aria-pressed={raw} onClick={() => setRaw(!raw)} disabled={!online}>
          {raw ? 'Showing raw signal' : 'Show raw signal'}
        </Button>
        <span className="note">{raw ? 'Smoothing is off: you see the glove exactly as it reports.' : 'Smoothed: tremor is filtered out.'}</span>
      </div>
      {!online && <p className="note">The backend is offline, so steadiness cannot be changed yet.</p>}
      {error && (
        <p className="mst-alert" role="alert">
          {error}
        </p>
      )}
    </Card>
  );
}
