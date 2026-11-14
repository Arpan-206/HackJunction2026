import { useCallback, useRef } from 'react';
import type { Side, Step } from '../../../../api/types';
import type { HandHandle } from '../../../../three';
import { useReferenceTrack } from '../../hooks/useReferenceTrack';
import { strikingKey } from '../../typing/typist';
import { TypingStage } from '../../typing/TypingStage';
import { FaultMarks } from './FaultMarks';
import type { ModeProps } from './types';

interface TypingDeskProps extends ModeProps {
  step: Step;
  /** Draw the solid keyboard ("Add a prop"); otherwise it is sketched in chalk on the bench. */
  solid: boolean;
}

/**
 * Touch typing lessons at the desk: both of the learner's wooden hands over a QWERTY keyboard, with the expert's hands as
 * ghosts in the same place. The coached hand follows the coach (and gets the usual vermilion correction marks); the other hand
 * follows the glove. The key the expert is striking is lit, read from the expert's finger and wrist; the gloves cannot tell
 * which key the learner reaches, so the lit key is a guide, never a score.
 */
export function TypingDesk({ coach, gloves, side, policy, toleranceDeg, step, solid }: TypingDeskProps) {
  const learner = useRef<HandHandle>(null);
  const other: Side = side === 'left' ? 'right' : 'left';
  const otherRef = useReferenceTrack(step.hands === 'both' ? step : null, other).track;
  const expert = useCallback(
    (s: Side) => (s === side ? coach.live.current.master : (otherRef?.handAt(coach.live.current.refTime) ?? null)),
    [coach, side, otherRef],
  );
  const getTarget = useCallback(() => strikingKey(expert(side)) ?? strikingKey(expert(other)), [expert, side, other]);
  const ghost = policy.showMaster ? { left: () => expert('left'), right: () => expert('right') } : null;
  const hand = (s: Side) =>
    s === side ? { handRef: learner, live: gloves.latest, getFrame: () => coach.live.current.learner } : { live: gloves.latest };

  return (
    <TypingStage
      solid={solid}
      getTarget={policy.showMaster ? getTarget : undefined}
      hands={{ left: hand('left'), right: hand('right') }}
      ghost={ghost}
      label={`Your two wooden hands over a ${solid ? 'keyboard' : 'keyboard sketched in chalk'}${policy.showMaster ? ", the expert's hands as ghosts over them" : ''}`}
    >
      <FaultMarks hand={learner} coach={coach} policy={policy} toleranceDeg={toleranceDeg} />
    </TypingStage>
  );
}
