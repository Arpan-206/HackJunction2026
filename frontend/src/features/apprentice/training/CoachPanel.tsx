import { FINGERS } from '../../../api/types';
import { MATCH_IN_LINE } from './coach/deviation';
import type { AttemptPolicy } from './coach/fade';
import { useCoachView, type Coach, type PracticeMode } from './coach/useCoach';
import { Button } from '../../../components/ui';

interface CoachPanelProps {
  coach: Coach;
  policy: AttemptPolicy;
  mode: PracticeMode;
  running: boolean;
}

/** The match meter (the weakest finger's match), the algorithmic tip from the worst finger and, in Follow practice, the checkpoint progress. */
export function CoachPanel({ coach, policy, mode, running }: CoachPanelProps) {
  const view = useCoachView(coach);
  const guiding = policy.liveCoach;
  // The meter is the weakest finger's match, floored so a finger just past the tolerance never rounds up into the green.
  const match = Math.floor(view.match);
  const anyOff = view.hasLearner && FINGERS.some((f) => view.status[f] === 'off');
  return (
    <div className="ap-coach">
      {guiding ? (
        <>
          <div className="ap-meter" role="meter" aria-label="Match with the expert" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.hasLearner ? match : 0}>
            <div className="ap-meter__head">
              <span>Match</span>
              <strong className="ap-meter__val">{view.hasLearner ? `${match}%` : 'No glove'}</strong>
            </div>
            <div className="ap-meter__track">
              <div className={`ap-meter__fill ${anyOff || match < MATCH_IN_LINE ? 'ap-meter__fill--off' : 'ap-meter__fill--ok'}`} style={{ width: `${view.hasLearner ? match : 0}%` }} />
            </div>
          </div>
          {running ? (
            <p className="ap-tip">Quiet while you move. The colours on your fingers are the coach.</p>
          ) : (
            <p className={`ap-tip ${view.tip ? 'ap-tip--active' : ''}`} aria-live="polite">
              {!view.hasLearner ? 'Put on a glove, or let the simulator play, to see live coaching.' : (view.tip ?? 'All fingers are in line. Hold the shape.')}
            </p>
          )}
        </>
      ) : (
        <p className="ap-tip">{policy.stage === 'watch' ? 'Just watch. Nothing is scored in this stage.' : 'No live guidance this rep. Trust your hand: the score comes at the end.'}</p>
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
