import { meterOff } from './coach/deviation';
import type { AttemptPolicy } from './coach/fade';
import { useCoachView, type Coach, type PracticeMode } from './coach/useCoach';
import { Button } from '../../../components/ui';

interface CoachPanelProps {
  coach: Coach;
  policy: AttemptPolicy;
  mode: PracticeMode;
  running: boolean;
}

/**
 * The match meter (the weakest finger's match) and, in Follow practice, the checkpoint progress. Between reps the policy is a
 * rehearsal: the meter reads a neutral "Ready" with no colour and no value, because nothing has been judged yet. While a rep
 * runs, the correction itself is the label on the stage, so the panel never repeats it.
 */
export function CoachPanel({ coach, policy, mode, running }: CoachPanelProps) {
  const view = useCoachView(coach);
  const guiding = policy.liveCoach;
  const rehearsal = Boolean(policy.rehearsal);
  // The meter is the weakest finger's match, floored so a finger just past the tolerance never rounds up into the green.
  const match = Math.floor(view.match);
  // Vermilion exactly when the stage label can show: both read the same snapshot through the same rule.
  const anyOff = view.hasLearner && meterOff(view);
  const judged = view.hasLearner && !rehearsal;
  return (
    <div className="ap-coach">
      {guiding ? (
        <>
          <div
            className="ap-meter"
            role="meter"
            aria-label="Match with the expert"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={judged ? match : undefined}
            aria-valuetext={judged ? `${match} per cent` : view.hasLearner ? 'Ready' : 'No glove'}
          >
            <div className="ap-meter__head">
              <span>Match</span>
              <strong className={`ap-meter__val ${judged ? '' : 'ap-meter__val--idle'}`}>{judged ? `${match}%` : view.hasLearner ? 'Ready' : 'No glove'}</strong>
            </div>
            <div className="ap-meter__track">
              {judged && <div className={`ap-meter__fill ${anyOff ? 'ap-meter__fill--off' : 'ap-meter__fill--ok'}`} style={{ width: `${match}%` }} />}
            </div>
          </div>
          <p className="ap-tip">
            {!view.hasLearner
              ? 'Put on a glove, or let the simulator play, to see live coaching.'
              : running
                ? 'Quiet while you move. The colours on your fingers are the coach.'
                : 'Rehearse freely. Colours and corrections start with the rep.'}
          </p>
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
