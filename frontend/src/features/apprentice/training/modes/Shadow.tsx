import { useRef } from 'react';
import { HandCanvas, Keyboard, PropCue, type CameraPreset, type HandHandle } from '../../../../three';
import { FaultMarks } from './FaultMarks';
import { LearnerHand, MasterHand } from './LearnerHand';
import type { ModeProps } from './types';
import { FingerTinter } from './useFingerTints';

/** Preset that frames the hand with its prop. */
export function presetFor(prop: ModeProps['prop']): CameraPreset {
  return prop === 'racket' ? 'racket' : prop === 'keyboard' ? 'keyboard' : 'single';
}

/** The master is a dark translucent shadow at the same position, under the wooden hand; fingers that are off glow vermilion. */
export function Shadow({ coach, gloves, side, prop, cue, policy, toleranceDeg }: ModeProps) {
  const learner = useRef<HandHandle>(null);
  const shadow = useRef<HandHandle>(null);
  return (
    <HandCanvas preset={presetFor(prop === 'none' ? cue : prop)} label="A dark shadow of the expert's hand lies beneath your wooden hand">
      <FingerTinter hand={shadow} coach={coach} policy={policy} goodTint={false} />
      {prop === 'keyboard' && <Keyboard handRef={learner} />}
      <PropCue prop={cue} hand={learner} />
      {policy.showMaster && <MasterHand ref={shadow} coach={coach} side={side} prop={prop} style="shadow" scale={1.1} position={[0, -0.4, 0]} />}
      <LearnerHand ref={learner} coach={coach} gloves={gloves} side={side} prop={prop} cue={cue} />
      <FaultMarks hand={learner} coach={coach} policy={policy} toleranceDeg={toleranceDeg} />
    </HandCanvas>
  );
}
