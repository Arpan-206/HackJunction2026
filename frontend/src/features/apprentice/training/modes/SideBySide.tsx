import { useRef } from 'react';
import { HandCanvas, Keyboard, type HandHandle } from '../../../../three';
import { FingerChips } from '../FingerChips';
import { LearnerHand, MasterHand } from './LearnerHand';
import { presetFor } from './Shadow';
import type { ModeProps } from './types';

/** Master on the left and learner on the right with mirrored cameras, and a status chip per finger under the learner. */
export function SideBySide({ coach, gloves, side, prop, policy }: ModeProps) {
  const learner = useRef<HandHandle>(null);
  const preset = presetFor(prop);
  const zoom = prop === 'racket' ? 1.75 : prop === 'keyboard' ? 1.5 : 1.3;
  const target: [number, number, number] = prop === 'keyboard' ? [0, -0.1, -1.1] : [prop === 'racket' ? -0.3 : 0, -0.12, -0.62];
  return (
    <div className="ap-split">
      <figure className="ap-split__pane">
        <figcaption className="ap-split__cap">The master</figcaption>
        {policy.showMaster ? (
          <HandCanvas preset={preset} stage={{ cameraPosition: [-zoom * 1.9, zoom * 2.7, zoom * 2.4], target: [...target] }} label="The master's chalk hand">
            <MasterHand coach={coach} side={side} prop={prop} style="chalk" withProp />
          </HandCanvas>
        ) : (
          <p className="ap-split__hidden note">The master steps back for this attempt. Show your own hand.</p>
        )}
      </figure>
      <figure className="ap-split__pane">
        <figcaption className="ap-split__cap">You</figcaption>
        <HandCanvas preset={preset} stage={{ cameraPosition: [zoom * 1.9, zoom * 2.7, zoom * 2.4], target: [...target] }} label="Your wooden hand">
          {prop === 'keyboard' && <Keyboard handRef={learner} />}
          <LearnerHand ref={learner} coach={coach} gloves={gloves} side={side} prop={prop} />
        </HandCanvas>
        {policy.liveCoach && (
          <div className="ap-split__chips">
            <FingerChips coach={coach} compact policy={policy} />
          </div>
        )}
      </figure>
    </div>
  );
}
