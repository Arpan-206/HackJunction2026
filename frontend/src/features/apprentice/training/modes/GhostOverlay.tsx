import { useRef } from 'react';
import { HandCanvas, Keyboard, type HandHandle } from '../../../../three';
import { FaultMarks } from './FaultMarks';
import { LearnerHand, MasterHand } from './LearnerHand';
import { presetFor } from './Shadow';
import type { ModeProps } from './types';
import { FingerTinter } from './useFingerTints';

/** A white chalk ghost at the same position as the wooden hand, tinted per finger: malachite when right, vermilion when off. */
export function GhostOverlay({ coach, gloves, side, prop, policy, toleranceDeg }: ModeProps) {
  const learner = useRef<HandHandle>(null);
  const ghost = useRef<HandHandle>(null);
  return (
    <HandCanvas preset={presetFor(prop)} label="A translucent chalk ghost of the expert's hand overlaps your wooden hand">
      <FingerTinter hand={ghost} coach={coach} policy={policy} goodTint={true} />
      {prop === 'keyboard' && <Keyboard handRef={learner} />}
      <LearnerHand ref={learner} coach={coach} gloves={gloves} side={side} prop={prop} />
      <FaultMarks hand={learner} coach={coach} policy={policy} toleranceDeg={toleranceDeg} />
      {policy.showMaster && <MasterHand ref={ghost} coach={coach} side={side} prop={prop} style="ghost" scale={1.12} position={[0, 0.02, 0.05]} />}
    </HandCanvas>
  );
}
