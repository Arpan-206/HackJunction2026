import { useRef } from 'react';
import { HandCanvas, Keyboard, PropCue, type HandHandle } from '../../../three';
import { FaultMarks } from '../../apprentice/training/modes/FaultMarks';
import { LearnerHand, MasterHand } from '../../apprentice/training/modes/LearnerHand';
import { Crossbar, Strings } from '../../apprentice/training/modes/Strings';
import { MASTER_LIFT, type ModeProps } from '../../apprentice/training/modes/types';
import { FingerTinter } from '../../apprentice/training/modes/useFingerTints';
import { CameraControls, ExpertCameraRig, useCameraRig } from '../components/ExpertCamera';
import { EXPERT_STAGE_CAMERA, expertFrame, expertStage } from '../components/cameraPresets';

/**
 * The reference take as the apprentice will meet it, in the training room's own Strings or Ghost guidance, built from the
 * same pieces as the training modes but seen from the expert's first-person view (behind and above the wrist) with the
 * expert stage's camera buttons. The training room keeps its own cameras.
 */
export function ReplayStage({ view, ...p }: ModeProps & { view: 'strings' | 'ghost' }) {
  const { coach, gloves, side, prop, cue, policy, toleranceDeg } = p;
  const learner = useRef<HandHandle>(null);
  const master = useRef<HandHandle>(null);
  const rig = useCameraRig();
  const frame = expertFrame(view === 'strings' ? 'replayStrings' : 'replayGhost', [side]);
  const preset = EXPERT_STAGE_CAMERA[frame.key];
  const label =
    view === 'strings'
      ? "The expert's hand hangs from a marionette cross above the wooden hand, with a string to each fingertip"
      : "A translucent chalk ghost of the expert's hand overlaps the wooden hand";
  return (
    <>
      <HandCanvas preset="single" stage={expertStage(frame)} label={label}>
        <ExpertCameraRig frame={frame} sides={[side]} preset={preset} rig={rig} />
        <FingerTinter hand={master} coach={coach} policy={policy} goodTint={view === 'ghost'} />
        {prop === 'keyboard' && <Keyboard handRef={learner} />}
        <PropCue prop={cue} hand={learner} />
        <LearnerHand ref={learner} coach={coach} gloves={gloves} side={side} prop={prop} cue={cue} />
        <FaultMarks hand={learner} coach={coach} policy={policy} toleranceDeg={toleranceDeg} />
        {view === 'strings' ? (
          <>
            <MasterHand ref={master} coach={coach} side={side} prop={prop} style="chalk" position={[0, MASTER_LIFT, 0]} />
            <Crossbar master={master} height={0.95} />
            <Strings master={master} learner={learner} coach={coach} policy={policy} />
          </>
        ) : (
          <MasterHand ref={master} coach={coach} side={side} prop={prop} style="ghost" scale={1.12} position={[0, 0.02, 0.05]} />
        )}
      </HandCanvas>
      <CameraControls rig={rig} base={preset} />
    </>
  );
}
