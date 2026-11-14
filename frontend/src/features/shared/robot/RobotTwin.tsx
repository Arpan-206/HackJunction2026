import { useEffect, useRef, useState, type RefObject } from 'react';
import { DESIGN_ASPECT, TWIN_TARGET as TARGET, twinCamera } from './twinFraming';
import type { GloveFrame, HandFrame, Side } from '../../../api/types';
import type { RobotStreamHandle } from '../../../api/useRobotStream';
import { useCoreGloves } from '../../../api/useCoreGloves';
import { Hand, HandCanvas, RobotHand, RobotStrings, type HandHandle, type HandStyle, type RobotHandHandle, type StringTarget } from '../../../three';
import { useRobotModelChoice, type RobotModelChoice } from './robotPrefs';

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

/** A lesson played in the browser: the five-finger robot copies its reference hand (the Dex3-1 needs the engine's own lesson). */
export interface TwinLesson {
  getFrame: (t: number) => HandFrame | null;
  /** The hand the lesson step is performed with; both the expert's hand and the robot take this side. */
  side: Side;
  /** The step title, for the panel. */
  label: string;
}

interface RobotTwinProps {
  robot: RobotStreamHandle;
  /** Which robot to draw. Defaults to the choice in localStorage (`apprentice.robotModel`). */
  model?: RobotModelChoice;
  /** A lesson played in the browser. Only the five-finger robot follows it; it replaces `human` while it plays. */
  lesson?: TwinLesson | null;
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

/**
 * The five-finger robot follows a little behind the hand that drives it, as motors do: a longer smoothing time constant
 * than the human hand's 0.045 s. It is a render effect only, the pose itself is the human's.
 */
const HUMANOID_LAG_S = 0.09;

/** The caption under each robot. */
export const ROBOT_CAPTION: Record<RobotModelChoice, string> = { dex3_1: 'Dex3-1', humanoid: 'Five-finger robot' };

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

/**
 * Geppetto and Pinocchio: the human hand on the left, the Dex3-1 twin on the right, a string from each human fingertip
 * to the robot's. The fingers the robot lacks (ring and little) hang their strings loose and show as chalk ghosts.
 */
export function RobotTwin({ robot, model: given_model, lesson, human: given, className, label }: RobotTwinProps) {
  const [chosen] = useRobotModelChoice();
  const model = given_model ?? chosen;
  return model === 'humanoid' ? (
    <HumanoidTwin robot={robot} lesson={lesson ?? null} human={given} className={className} label={label} />
  ) : (
    <DexTwin robot={robot} human={given} className={className} label={label} />
  );
}

function DexTwin({ robot, human: given, className, label }: RobotTwinProps) {
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
        stage={{ cameraPosition: camera, target: TARGET, circleCenter: [0, -0.5], controls: 'orbit' }}
      >
        {showHuman && human && <Hand ref={humanRef} side={human.side} style={human.style} live={human.live} getFrame={human.getFrame} position={[HUMAN_X, LIFT, 0]} centred={false} />}
        <RobotHand ref={robotRef} side={side} live={robot.latest} position={[showHuman ? ROBOT_X : 0, LIFT, 0]} rotation={robotRoll(side)} />
        {showHuman && <RobotStrings human={humanRef} robot={robotRef} />}
      </HandCanvas>
      <div className="rb-twin__caps" aria-hidden="true">
        {showHuman && human && <span className="rb-twin__cap">{human.label}</span>}
        <span className="rb-twin__cap rb-twin__cap--robot">{ROBOT_CAPTION.dex3_1}</span>
      </div>
    </div>
  );
}

/**
 * The five-finger humanoid robot: the app's own hand mesh drawn in steel with bronze ball joints. It has a finger for
 * every human finger and a joint for every human joint, so it copies the driving hand as it is, with no retargeting
 * and no engine: every string is taut. Who drives it: a lesson played in the browser when one plays; otherwise the
 * human hand shown beside it. When the engine is connected and its source is off, it rests with the Dex3-1.
 */
function HumanoidTwin({ robot, lesson, human: given, className, label }: Omit<RobotTwinProps, 'model' | 'lesson'> & { lesson: TwinLesson | null }) {
  const humanRef = useRef<HandHandle>(null);
  const robotRef = useRef<StringTarget>(null);
  const engineUrl = robot.status === 'open' && robot.hello && !robot.mock ? robot.url : null;
  const coreLive = useCoreGloves(engineUrl);
  const side: Side = lesson?.side ?? given?.side ?? robot.hand ?? 'right';
  let human: TwinHuman | null = given ?? null;
  if (lesson) human = { side, style: 'chalk', getFrame: lesson.getFrame, label: 'The expert' };
  else if (human && engineUrl) human = robot.source === 'off' || robot.source === 'lesson' ? null : { ...human, live: coreLive, getFrame: undefined };
  const box = useRef<HTMLDivElement>(null);
  const camera = twinCamera(useAspect(box));
  return (
    <div ref={box} className={`rb-twin ${className ?? ''}`}>
      <HandCanvas
        preset="pair"
        label={label ?? 'The five-finger robot hand beside the human hand that drives it, strings between their fingertips'}
        stage={{ cameraPosition: camera, target: TARGET, circleCenter: [0, -0.5], controls: 'orbit' }}
      >
        {human && <Hand ref={humanRef} side={human.side} style={human.style} live={human.live} getFrame={human.getFrame} position={[HUMAN_X, LIFT, 0]} centred={false} />}
        <Hand
          ref={robotRef as RefObject<HandHandle>}
          side={side}
          style="robot"
          live={human?.live}
          getFrame={human?.getFrame}
          smoothing={HUMANOID_LAG_S}
          position={[human ? ROBOT_X : 0, LIFT, 0]}
          centred={false}
        />
        {human && <RobotStrings human={humanRef} robot={robotRef} />}
      </HandCanvas>
      <div className="rb-twin__caps" aria-hidden="true">
        {human && <span className="rb-twin__cap">{human.label}</span>}
        <span className="rb-twin__cap rb-twin__cap--robot">{ROBOT_CAPTION.humanoid}</span>
      </div>
    </div>
  );
}
