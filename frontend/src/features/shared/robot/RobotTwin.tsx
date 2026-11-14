import { useRef, type RefObject } from 'react';
import type { GloveFrame, HandFrame, Side } from '../../../api/types';
import type { RobotStreamHandle } from '../../../api/useRobotStream';
import { Hand, HandCanvas, RobotHand, RobotStrings, type HandHandle, type HandStyle, type RobotHandHandle } from '../../../three';

export interface TwinHuman {
  side: Side;
  style: HandStyle;
  /** Live glove frame ref, read every render frame. */
  live?: RefObject<GloveFrame | null>;
  /** Or a frame per render frame (the coach's learner or master). */
  getFrame?: (t: number) => HandFrame | null;
  /** Caption under the human hand: "You", "The expert", "The lesson". */
  label: string;
}

interface RobotTwinProps {
  robot: RobotStreamHandle;
  /** The hand that drives the robot, drawn beside it with strings. Null draws the robot alone. */
  human: TwinHuman | null;
  /** The robot and the human come from different engines (sample glove, real robot): draw the robot alone and say so. */
  decoupled?: boolean;
  className?: string;
  label?: string;
}

const HUMAN_X = -1.0;
const ROBOT_X = 1.0;

/**
 * Geppetto and Pinocchio: the human hand on the left, the Dex3-1 twin on the right, a string from each human fingertip
 * to the robot's. The fingers the robot lacks (ring and little) hang their strings loose and show as chalk ghosts.
 */
export function RobotTwin({ robot, human, decoupled = false, className, label }: RobotTwinProps) {
  const humanRef = useRef<HandHandle>(null);
  const robotRef = useRef<RobotHandHandle>(null);
  const showHuman = human !== null && !decoupled;
  const side: Side = robot.hand ?? human?.side ?? 'right';
  return (
    <div className={`rb-twin ${className ?? ''}`}>
      <HandCanvas
        preset="pair"
        label={label ?? 'The robot hand beside the human hand that drives it, strings between their fingertips'}
        stage={{ cameraPosition: [2.6, 3.6, 5.2], target: [0.1, -0.1, -0.7], circleCenter: [0, -0.5], controls: 'limited' }}
      >
        {showHuman && human && <Hand ref={humanRef} side={human.side} style={human.style} live={human.live} getFrame={human.getFrame} position={[HUMAN_X, 0, 0]} />}
        <RobotHand ref={robotRef} side={side} live={robot.latest} position={[showHuman ? ROBOT_X : 0, 0, 0]} />
        {showHuman && <RobotStrings human={humanRef} robot={robotRef} />}
      </HandCanvas>
      <div className="rb-twin__caps" aria-hidden="true">
        {showHuman && human && <span className="rb-twin__cap">{human.label}</span>}
        <span className="rb-twin__cap rb-twin__cap--robot">Dex3-1</span>
      </div>
      {decoupled && <p className="note rb-twin__note">The robot follows the engine; the sample glove here does not drive it.</p>}
    </div>
  );
}
