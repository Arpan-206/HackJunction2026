import type { Step } from '../../../api';
import { Badge, Button, Field, TextArea } from '../../../components/ui';
import { motionLabel, primarySide } from '../lib';
import { GuideHand } from './GuideHand';

interface StepEditorProps {
  step: Step;
  index: number;
  count: number;
  onChange: (fields: Partial<Step>) => void;
  onMove: (delta: -1 | 1) => void;
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
  return (
    <li className="mst-step card">
      <div className="mst-step__guide">
        <GuideHand
          label={recorded ? `Your recorded take for step ${n}` : `Mock guide for step ${n}`}
          motion={step.motion}
          recordingId={step.reference_recording_id}
          side={primarySide(step.hands)}
          prop={step.prop}
        />
        <div className="mst-step__status">
          {recorded ? <Badge tone="ok">Your take</Badge> : <Badge>Mock guide: {motionLabel(step.motion)}</Badge>}
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
        <div className="mst-step__nums">
          <Field label="Repetitions" type="number" min={1} max={30} value={step.repetitions} onChange={(e) => onChange({ repetitions: Math.max(1, Math.round(num(e.target.value, 1))) })} />
          <Field
            label="Angle tolerance (deg)"
            type="number"
            min={1}
            max={90}
            value={step.tolerance.angle_deg}
            onChange={(e) => onChange({ tolerance: { ...step.tolerance, angle_deg: num(e.target.value, 18) } })}
          />
          <Field
            label="Timing tolerance (ms)"
            type="number"
            min={20}
            max={2000}
            step={10}
            value={step.tolerance.timing_ms}
            onChange={(e) => onChange({ tolerance: { ...step.tolerance, timing_ms: num(e.target.value, 250) } })}
          />
        </div>
        <div className="mst-step__actions">
          <Button onClick={onRecord}>{recorded ? 'Record this step again' : 'Record this step'}</Button>
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
          <Button variant="ghost" onClick={onDelete} aria-label={`Delete step ${n}`}>
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}
