import type { Step } from '../../../api';
import { Button, Field, TextArea } from '../../../components/ui';
import { motionLabel, primarySide, STRICTNESS, strictnessOf } from '../lib';
import { DescribeMotion } from './DescribeMotion';
import { GuideHand } from './GuideHand';
import { HandsControl } from './HandsControl';
import { RevealFile } from '../files/RevealFile';
import { rememberHands, shownProp, useShowProps } from '../../shared/sessionPrefs';

interface StepEditorProps {
  step: Step;
  index: number;
  count: number;
  onChange: (fields: Partial<Step>) => void;
  onMove: (delta: -1 | 1) => void;
  /** Removes the step; the parent offers an undo. */
  onDelete: () => void;
  onRecord: () => void;
  onReplay: () => void;
}

const num = (v: string, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * One editable lesson step: title, instruction, repetitions, room for error, a guide hand (the master's own take
 * once recorded, otherwise the mock motion), and the record, replay, reorder and delete actions.
 */
export function StepEditor({ step, index, count, onChange, onMove, onDelete, onRecord, onReplay }: StepEditorProps) {
  const recorded = Boolean(step.reference_recording_id);
  const n = index + 1;
  const level = strictnessOf(step.tolerance);
  const [showProps] = useShowProps();
  return (
    <li className="mst-step card">
      <div className="mst-step__guide">
        <GuideHand
          label={recorded ? `Your recorded take for step ${n}` : `Mock guide for step ${n}`}
          motion={step.motion}
          recordingId={step.reference_recording_id}
          side={primarySide(step.hands)}
          prop={shownProp(step.prop, showProps)}
        />
        <div className="mst-step__status">
          {recorded ? (
            <>
              <strong>Your own hand</strong>, recorded
            </>
          ) : (
            <>Mock guide: {motionLabel(step.motion)}</>
          )}
        </div>
      </div>

      <div className="mst-step__form">
        <div className="mst-step__top">
          <span className="mst-step__n" aria-hidden="true">
            {n}
          </span>
          <Field label="Title" value={step.title} onChange={(e) => onChange({ title: e.target.value })} />
        </div>
        <TextArea label="Instruction" value={step.instruction} rows={3} onChange={(e) => onChange({ instruction: e.target.value })} />
        <HandsControl
          value={step.hands}
          context={`for step ${n}`}
          locked={recorded ? 'Recorded this way. To change it, open Record this step again.' : null}
          onChange={(hands) => {
            rememberHands(step.move_id, hands);
            onChange({ hands });
          }}
        />
        {!recorded && <DescribeMotion side={primarySide(step.hands)} stepNumber={n} onMotion={(motion) => onChange({ motion })} />}
        <div className="mst-step__nums">
          <Field label="Repetitions" type="number" min={1} max={30} value={step.repetitions} onChange={(e) => onChange({ repetitions: Math.max(1, Math.round(num(e.target.value, 1))) })} />
          <div className="mst-strict" role="group" aria-label={`Strictness for step ${n}`}>
            <span className="field__label">Strictness</span>
            <div className="mst-seg">
              {STRICTNESS.map((o) => (
                <Button key={o.id} variant="toggle" aria-pressed={level === o.id} onClick={() => onChange({ tolerance: { ...step.tolerance, angle_deg: o.angle_deg, timing_ms: o.timing_ms } })}>
                  {o.label}
                </Button>
              ))}
            </div>
            <span className="mst-strict__note">
              {step.tolerance.angle_deg} degrees and {step.tolerance.timing_ms} ms of room{level ? '' : ' (custom)'}
            </span>
          </div>
        </div>
        <div className="mst-step__actions">
          <Button variant="secondary" onClick={onRecord}>{recorded ? 'Record this step again' : 'Record this step'}</Button>
          {recorded && (
            <Button variant="secondary" onClick={onReplay}>
              Replay take
            </Button>
          )}
          <span className="mst-step__spacer" />
          <Button variant="ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move step ${n} up`}>
            Up
          </Button>
          <Button variant="ghost" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move step ${n} down`}>
            Down
          </Button>
          <span className="mst-step__danger">
            <Button variant="ghost" onClick={onDelete} aria-label={`Delete step ${n}`}>
              Delete
            </Button>
          </span>
        </div>
        {step.reference_recording_id && <RevealFile kind="recording" id={step.reference_recording_id} what={`the reference take of step ${n}`} />}
      </div>
    </li>
  );
}
