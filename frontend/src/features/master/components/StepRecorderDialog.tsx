import { useEffect, useState } from 'react';
import { useDevState, useGloveStream, type Side, type Step } from '../../../api';
import { useCalibration } from '../../shared/useCalibration';
import { useSimulatorMotion } from '../hooks/useSimulatorMotion';
import type { RecorderPhase } from '../hooks/useRecorder';
import type { TakeBook } from '../hooks/useTakeBook';
import { primarySide } from '../lib';
import { CalibrationPanel } from '../../shared/CalibrationPanel';
import { FingerLanes } from './FingerLanes';
import { LiveHandStage } from './LiveHandStage';
import { Modal } from './Modal';
import { RecorderPanel } from './RecorderPanel';
import { ReplayPlayer } from './ReplayPlayer';

interface StepRecorderDialogProps {
  step: Step;
  lessonId: string;
  book: TakeBook;
  /** Called whenever the step's reference take changes, so the lesson always points at the chosen take. */
  onReference: (recordingId: string) => void;
  onClose: () => void;
}

/**
 * "Record this step": the same live stage, calibration and recorder the scratch studio uses, opened in a dialog
 * for one lesson step. The kept reference take is written back to the step as you go.
 */
export function StepRecorderDialog({ step, lessonId, book, onReference, onClose }: StepRecorderDialogProps) {
  const glove = useGloveStream();
  const { state } = useDevState(0);
  const [side, setSide] = useState<Side>(primarySide(step.hands));
  const [replay, setReplay] = useState<string[] | null>(null);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const calibration = useCalibration(side);
  const reference = book.referenceFor(step.id);
  const takes = book.takesFor(step.id);

  useSimulatorMotion(glove, state?.glove_source ?? null, step.motion);

  useEffect(() => {
    if (reference && reference !== step.reference_recording_id) onReference(reference);
  }, [reference, step.reference_recording_id, onReference]);

  return (
    <Modal title={`Record: ${step.title}`} onClose={onClose} wide>
      <div className="mst-studio mst-studio--dialog">
        <div className="mst-studio__view">
          {replay ? (
            <ReplayPlayer items={replay.map((id) => ({ id, label: `Take ${takes.find((t) => t.id === id)?.n ?? ''}`.trim() }))} side={side} prop={step.prop} onClose={() => setReplay(null)} />
          ) : (
            <>
              <LiveHandStage glove={glove} showJoints showTrails={false} prop={step.prop}>
                {phase === 'recording' && <span className="mst-recmark">REC</span>}
              </LiveHandStage>
              <FingerLanes getHand={() => glove.latest.current?.hands.find((h) => h.side === side) ?? glove.latest.current?.hands[0] ?? null} />
            </>
          )}
        </div>
        <div className="mst-studio__side">
          <CalibrationPanel side={side} onSide={setSide} cal={calibration} compact />
          <RecorderPanel
            slot={step.id}
            title="Your takes"
            targetReps={step.repetitions}
            book={book}
            contextFor={() => ({ lessonId, stepId: step.id })}
            onReplay={setReplay}
            onPhase={setPhase}
          />
        </div>
      </div>
    </Modal>
  );
}
