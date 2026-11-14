import { useEffect, useState } from 'react';
import { useDevState, useGloveStream, type Hands, type Side, type Step } from '../../../api';
import { useCalibration } from '../../shared/useCalibration';
import { useSimulatorMotion } from '../hooks/useSimulatorMotion';
import type { RecorderPhase } from '../hooks/useRecorder';
import type { TakeBook } from '../hooks/useTakeBook';
import { primarySide } from '../lib';
import { CalibrationPanel } from '../../shared/CalibrationPanel';
import { PropSwitch } from '../../shared/PropSwitch';
import { rememberHands, shownProp, useShowProps } from '../../shared/sessionPrefs';
import { Card } from '../../../components/ui';
import { HandsControl } from './HandsControl';
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
  /** Changes the step's hands set-up (allowed until the first take in this dialog). */
  onHands: (hands: Hands) => void;
  onClose: () => void;
}

/**
 * "Record this step": the same live stage, calibration and recorder the scratch studio uses, opened in a dialog
 * for one lesson step. The kept reference take is written back to the step as you go.
 */
export function StepRecorderDialog({ step, lessonId, book, onReference, onHands, onClose }: StepRecorderDialogProps) {
  const glove = useGloveStream();
  const { state } = useDevState(0);
  const [side, setSide] = useState<Side>(primarySide(step.hands));
  const [replay, setReplay] = useState<string[] | null>(null);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const calibration = useCalibration(side);
  const reference = book.referenceFor(step.id);
  const takes = book.takesFor(step.id);
  const [showProps] = useShowProps();
  const prop = shownProp(step.prop, showProps);
  const handsLocked = takes.length > 0 || phase !== 'idle' ? "Set for this step's takes. Delete them to change it." : null;
  const changeHands = (h: Hands) => {
    rememberHands(step.move_id, h);
    if (h !== 'both') setSide(h);
    onHands(h);
  };

  useSimulatorMotion(glove, state?.glove_source ?? null, step.motion);

  useEffect(() => {
    if (reference && reference !== step.reference_recording_id) onReference(reference);
  }, [reference, step.reference_recording_id, onReference]);

  return (
    <Modal title={`Record: ${step.title}`} onClose={onClose} wide>
      <div className="mst-studio mst-studio--dialog">
        <div className="mst-studio__view">
          {replay ? (
            <ReplayPlayer items={replay.map((id) => ({ id, label: `Take ${takes.find((t) => t.id === id)?.n ?? ''}`.trim() }))} side={side} hands={step.hands} prop={prop} onClose={() => setReplay(null)} />
          ) : (
            <>
              <LiveHandStage glove={glove} showJoints showTrails={false} prop={prop} hands={step.hands} live={phase === 'recording'} />
              <FingerLanes getHand={() => glove.latest.current?.hands.find((h) => h.side === side) ?? glove.latest.current?.hands[0] ?? null} />
            </>
          )}
        </div>
        <div className="mst-studio__side">
          <Card title="Set up" className="mst-setup">
            <HandsControl value={step.hands} onChange={changeHands} locked={handsLocked} />
            {step.reference_recording_id && !handsLocked && <span className="note">Changing hands sets the earlier take aside; record a new one.</span>}
            <PropSwitch prop={step.prop} />
          </Card>
          <CalibrationPanel side={side} onSide={setSide} cal={calibration} compact hideSide={step.hands !== 'both'} />
          <RecorderPanel
            slot={step.id}
            title="Your takes"
            targetReps={step.repetitions}
            book={book}
            contextFor={() => ({ lessonId, stepId: step.id, hands: step.hands })}
            onReplay={setReplay}
            onPhase={setPhase}
          />
        </div>
      </div>
    </Modal>
  );
}
