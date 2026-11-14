import { useRef } from 'react';
import { HandCanvas, Keyboard, type HandHandle } from '../../../../three';
import { FaultMarks } from './FaultMarks';
import { LearnerHand, MasterHand } from './LearnerHand';
import { Crossbar, Strings } from './Strings';
import { MASTER_LIFT, type ModeProps } from './types';
import { FingerTinter } from './useFingerTints';

/**
 * Pinocchio guidance: the master's ghost hand hovers above the wooden hand, hung from a crossbar, and a string joins each
 * ghost fingertip to the matching learner fingertip. Slack means right; taut and vermilion means correct me.
 */
export function Marionette({ coach, gloves, side, prop, policy, toleranceDeg, combo }: ModeProps) {
  const learner = useRef<HandHandle>(null);
  const master = useRef<HandHandle>(null);
  return (
    <HandCanvas
      preset="single"
      label="The expert's ghost hand hangs from a marionette cross above your wooden hand, with a string to each fingertip"
      stage={{ cameraPosition: [2.7, 3.5, 4.9], target: [0, 0.9, -0.85], circleCenter: [0, -0.5], controls: 'limited' }}
    >
      <FingerTinter hand={master} coach={coach} policy={policy} goodTint={false} />
      {prop === 'keyboard' && <Keyboard handRef={learner} />}
      <LearnerHand ref={learner} coach={coach} gloves={gloves} side={side} prop={prop} />
      <FaultMarks hand={learner} coach={coach} policy={policy} toleranceDeg={toleranceDeg} />
      {policy.showMaster && (
        <>
          <MasterHand ref={master} coach={coach} side={side} prop={prop} style="chalk" position={[0, MASTER_LIFT, 0]} />
          <Crossbar master={master} height={0.95} />
        </>
      )}
      <Strings master={master} learner={learner} coach={coach} policy={policy} combo={combo} />
    </HandCanvas>
  );
}
