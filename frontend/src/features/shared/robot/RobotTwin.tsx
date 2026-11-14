import { useEffect, useRef, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import { DESIGN_ASPECT, TWIN_TARGET as TARGET, twinCamera } from './twinFraming';
import type { GloveFrame, HandFrame, Side } from '../../../api/types';
import type { RobotStreamHandle } from '../../../api/useRobotStream';
import { useCoreGloves } from '../../../api/useCoreGloves';
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
  /**
   * The hand that drives the robot, drawn beside it with strings. Null draws the robot alone. When a real engine drives
   * the robot, its own glove stream replaces `live` and `getFrame` here.
   */
  human: TwinHuman | null;
  className?: string;
  label?: string;
}

const HUMAN_X = -1.35;
const ROBOT_X = 1.35;
/**
 * Both hands float this far above their usual height. A curled fingertip sits near the bench, and the strings sag
 * below their ends, so without the lift the bench top hides the strings.
 */
const LIFT = 0.6;

/**
 * The robot is shown in a handshake pose: palm turned towards the human hand, thumb across. The Dex3-1 thumb grows out
 * of the palm face, so palm down would put it through the bench, and the curled fingers would hide under the palm.
 * Turned on its side, the curl reads from above as a claw closing towards the human hand.
 */
function robotRoll(side: Side): [number, number, number] {
  return [0, 0, side === 'right' ? -Math.PI / 2 : Math.PI / 2];
}

/** Width over height of an element, kept up to date. */
function useAspect(ref: RefObject<HTMLElement | null>): number {
  const [aspect, setAspect] = useState(DESIGN_ASPECT);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(Math.round((width / height) * 20) / 20);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return aspect;
}

/** Moves the canvas camera when the framing changes; the Canvas only reads its camera prop once. */
function CameraTo({ position }: { position: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const [x, y, z] = position;
  useEffect(() => {
    camera.position.set(x, y, z);
    camera.lookAt(...TARGET);
  }, [camera, x, y, z]);
  return null;
}

/**
 * Geppetto and Pinocchio: the human hand on the left, the Dex3-1 twin on the right, a string from each human fingertip
 * to the robot's. The fingers the robot lacks (ring and little) hang their strings loose and show as chalk ghosts.
 */
export function RobotTwin({ robot, human: given, className, label }: RobotTwinProps) {
  const humanRef = useRef<HandHandle>(null);
  const robotRef = useRef<RobotHandHandle>(null);
  const side: Side = robot.hand ?? given?.side ?? 'right';
  // A real engine drives the robot: draw the human hand from that engine's own glove stream, so both hands always come
  // from one place (the app's glove stream may be the in-browser sample while the robot is real). In lesson mode the
  // engine plays its own lesson step and sends no human hand, so the robot stands alone.
  const engineUrl = robot.status === 'open' && robot.hello && !robot.mock ? robot.url : null;
  const coreLive = useCoreGloves(engineUrl);
  const human: TwinHuman | null = !given ? null : !engineUrl ? given : robot.source === 'lesson' ? null : { ...given, side, live: coreLive, getFrame: undefined };
  const showHuman = human !== null;
  const box = useRef<HTMLDivElement>(null);
  const camera = twinCamera(useAspect(box));
  return (
    <div ref={box} className={`rb-twin ${className ?? ''}`}>
      <HandCanvas
        preset="pair"
        label={label ?? 'The robot hand beside the human hand that drives it, strings between their fingertips'}
        stage={{ cameraPosition: camera, target: TARGET, circleCenter: [0, -0.5], controls: 'limited' }}
      >
        <CameraTo position={camera} />
        {showHuman && human && <Hand ref={humanRef} side={human.side} style={human.style} live={human.live} getFrame={human.getFrame} position={[HUMAN_X, LIFT, 0]} centred={false} />}
        <RobotHand ref={robotRef} side={side} live={robot.latest} position={[showHuman ? ROBOT_X : 0, LIFT, 0]} rotation={robotRoll(side)} />
        {showHuman && <RobotStrings human={humanRef} robot={robotRef} />}
      </HandCanvas>
      <div className="rb-twin__caps" aria-hidden="true">
        {showHuman && human && <span className="rb-twin__cap">{human.label}</span>}
        <span className="rb-twin__cap rb-twin__cap--robot">Dex3-1</span>
      </div>
    </div>
  );
}
