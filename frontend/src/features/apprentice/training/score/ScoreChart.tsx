import { FINGERS, type Finger, type ScoreResult } from '../../../../api/types';
import { FINGER_LABEL } from '../coach/tips';
import { OK_FROM } from './scoreRules';

interface ScoreChartProps {
  result: ScoreResult;
  weakest: Finger;
  /** Whether every finger reached OK_FROM; when not, the weakest finger is the one correction. */
  allGood: boolean;
}

/**
 * The flat score: one thick high-contrast bar per finger and one for the timing, a tick at the clean mark (70), and the
 * number in large figures. Malachite for a part that reached the mark, vermilion only for parts below it.
 */
export function ScoreChart({ result, weakest, allGood }: ScoreChartProps) {
  const rows: { id: Finger | 'timing'; name: string; value: number }[] = [
    ...FINGERS.map((f) => ({ id: f, name: FINGER_LABEL[f], value: Math.round(result.per_finger[f]) })),
    { id: 'timing', name: 'Timing', value: Math.round(result.timing) },
  ];
  return (
    <div className="ap-chart">
      <ul className="ap-chart__rows" aria-label="Score per finger">
        {rows.map((r) => {
          const ok = r.value >= OK_FROM;
          const flagged = r.id === weakest && !allGood;
          return (
            <li key={r.id} className={`ap-chart__row ${r.id === 'timing' ? 'ap-chart__row--timing' : ''}`}>
              <span className="ap-chart__name">{r.name}</span>
              <span className="ap-chart__track" role="presentation">
                <span className={`ap-chart__fill ${ok ? 'ap-chart__fill--ok' : 'ap-chart__fill--off'}`} style={{ width: `${r.value}%` }} />
                <span className="ap-chart__mark" style={{ left: `${OK_FROM}%` }} />
              </span>
              <span className={`ap-chart__val ${flagged ? 'ap-chart__val--off' : ''}`} aria-label={`${r.name} ${r.value} out of 100${ok ? '' : ', below the clean mark'}`}>
                {r.value}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="ap-chart__key">The tick marks {OK_FROM}: a part at or past it held the expert's shape.</p>
    </div>
  );
}
