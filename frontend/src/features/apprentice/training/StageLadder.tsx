import { STAGES, STAGE_LABEL, type PipelineConfig, type StageState } from '../pipeline/stages';

interface StageLadderProps {
  machine: StageState;
  cfg: PipelineConfig;
  /** True when the next rep is a scheduled review. */
  review: boolean;
  /** The one goal for the coming set, shown before it starts. */
  goal: string;
}

/**
 * Where the learner is on this step: the four stages as a ledger line, the clean-rep combo as ink dots, the rep within the
 * set and the one goal for it. It only re-renders when a rep is scored.
 */
export function StageLadder({ machine, cfg, review, goal }: StageLadderProps) {
  const at = STAGES.indexOf(machine.stage);
  const scored = machine.stage !== 'watch';
  return (
    <div className="ap-ladder" role="group" aria-label="Practice stage">
      <ol className="ap-ladder__rungs">
        {STAGES.map((s, i) => (
          <li key={s} className={i < at ? 'is-done' : i === at ? 'is-now' : ''} aria-current={i === at ? 'step' : undefined}>
            <span className="ap-ladder__n" aria-hidden="true">
              {i + 1}
            </span>
            {STAGE_LABEL[s]}
          </li>
        ))}
      </ol>
      {scored && (
        <p className="ap-ladder__combo" aria-label={`${machine.combo} clean reps in a row, ${cfg.cleanReps} needed`}>
          <span className="ap-ladder__pips" aria-hidden="true">
            {Array.from({ length: cfg.cleanReps }, (_, i) => (
              <i key={i} className={i < machine.combo ? 'is-on' : ''} />
            ))}
          </span>
          {review ? 'Review: one blind try.' : `${machine.combo} of ${cfg.cleanReps} clean reps in a row. Rep ${machine.repsInSet + 1} of ${cfg.setSize}.`}
        </p>
      )}
      <p className="ap-ladder__goal">{goal}</p>
    </div>
  );
}
