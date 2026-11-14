import { Component, lazy, Suspense, useState, type KeyboardEvent, type ReactNode } from 'react';
import { FINGERS, type Finger, type HandFrame, type ScoreResult, type Side } from '../../../../api/types';
import { useScoreView, type ScoreView as View } from '../../../shared/settings';
import { FINGER_LABEL } from '../coach/tips';
import { ScoreChart } from './ScoreChart';

const ScoreScene = lazy(() => import('./ScoreScene'));

/** Falls back to the flat chart when the 3D scene cannot draw (no WebGL, lost context on load). */
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface ScoreViewProps {
  result: ScoreResult;
  weakest: Finger;
  allGood: boolean;
  mastery: boolean;
  pose?: HandFrame | null;
  side: Side;
  attempt: number;
}

/** Everything the 3D scene shows, read aloud, since the scene itself is a picture. */
function spoken(result: ScoreResult): string {
  const parts = FINGERS.map((f) => `${FINGER_LABEL[f]} ${Math.round(result.per_finger[f])}`);
  return `Overall ${Math.round(result.overall)}, ${parts.join(', ')}, timing ${Math.round(result.timing)}`;
}

/**
 * The score shown as the 3D scene (the default, from Settings) or as the flat chart. Clicking or tapping the scene, or
 * pressing Enter or Space on it, flips to the chart; clicking the chart or its "Show in 3D" button flips back. The flip
 * holds for this result only; the Settings choice decides how the next one opens.
 */
export function ScoreView({ result, weakest, allGood, mastery, pose, side, attempt }: ScoreViewProps) {
  const [preferred] = useScoreView();
  const [flipped, setFlipped] = useState<View | null>(null);
  const view = flipped ?? preferred;
  const flip = () => setFlipped(view === '3d' ? '2d' : '3d');
  const chart = <ScoreChart result={result} weakest={weakest} allGood={allGood} />;

  if (view === '2d') {
    return (
      <div className="ap-scoreview ap-scoreview--2d">
        {/* The chart is a mouse and touch shortcut back to 3D; keyboard users have the button below. */}
        <div className="ap-scoreview__chart" onClick={flip}>
          {chart}
        </div>
        <button type="button" className="ap-scoreview__flip" onClick={flip}>
          Show in 3D
        </button>
      </div>
    );
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      flip();
    }
  };
  return (
    <div className="ap-scoreview ap-scoreview--3d">
      <SceneBoundary fallback={chart}>
        <div className="ap-score3d" role="button" tabIndex={0} aria-label={`Score in 3D. ${spoken(result)}. Show as a flat chart.`} onClick={flip} onKeyDown={onKey}>
          <Suspense fallback={<p className="note ap-score3d__wait">Setting the bench...</p>}>
            <ScoreScene result={result} weakest={weakest} allGood={allGood} mastery={mastery} pose={pose} side={side} line={`Rep ${attempt}, timing ${Math.round(result.timing)}`} />
          </Suspense>
        </div>
      </SceneBoundary>
      <p className="ap-scoreview__caption" aria-hidden="true">
        Click the score for the flat chart.
      </p>
    </div>
  );
}
