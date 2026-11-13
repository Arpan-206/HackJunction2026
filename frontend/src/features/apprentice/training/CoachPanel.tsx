import type { AttemptPolicy } from './coach/fade';
import { useCoachView, type Coach, type PracticeMode } from './coach/useCoach';
import { Button } from '../../../components/ui';

interface CoachPanelProps {
  coach: Coach;
  policy: AttemptPolicy;
  mode: PracticeMode;
  running: boolean;
}

/** The match meter, the algorithmic tip from the worst finger and, in Follow practice, the checkpoint progress. */
export function CoachPanel({ coach, policy, mode, running }: CoachPanelProps) {
  const view = useCoachView(coach);
  const guiding = policy.liveCoach;
  const match = Math.round(view.match);
  return (
    <div className="ap-coach">
      {guiding ? (
        <>
          <div className="ap-meter" role="meter" aria-label="Match with the master" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.hasLearner ? match : 0}>
            <div className="ap-meter__head">
              <span>Match</span>
              <strong className="ap-meter__val">{view.hasLearner ? `${match}%` : 'No glove'}</strong>
            </div>
            <div className="ap-meter__track">
              <div className={`ap-meter__fill ${match >= 75 ? 'ap-meter__fill--ok' : 'ap-meter__fill--off'}`} style={{ width: `${view.hasLearner ? match : 0}%` }} />
            </div>
          </div>
          <p className={`ap-tip ${view.tip ? 'ap-tip--active' : ''}`} aria-live="polite">
            {!view.hasLearner ? 'Put on a glove, or let the simulator play, to see live coaching.' : (view.tip ?? 'All fingers are in line. Hold the shape.')}
          </p>
        </>
      ) : (
        <p className="ap-tip">No live guidance this attempt. Trust your hand: the score comes at the end.</p>
      )}
      {mode === 'follow' && (
        <div className="ap-follow" aria-live="polite">
          <span>
            Checkpoint {Math.max(1, view.checkpoint)} of {Math.max(1, view.checkpoints)}
          </span>
          <span className="ap-follow__hold" aria-hidden="true">
            <span className="ap-follow__fill" style={{ width: `${Math.round(view.holdFraction * 100)}%` }} />
          </span>
          <span className="ap-follow__state">{!running ? 'Ghost is ready' : view.waiting ? 'Ghost waits: match the pose for half a second' : 'Ghost is moving'}</span>
          {running && view.waiting && (
            <Button variant="ghost" onClick={coach.skip}>
              Skip checkpoint
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
