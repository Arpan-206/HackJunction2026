import type { Finger, Side } from '../../../api/types';
import type { RobotDescription, RobotSource } from '../../../api/robotTypes';
import type { RobotState } from '../../../api/useRobotStream';
import { ROBOT_CONFIG } from '../../../mock/robot';
import { fingerOf } from '../../../three/robot/kinematics';

/** What the person picks on the teleop screen. */
export type DriveChoice = 'you' | 'lesson' | 'off';

export const FINGER_NAME: Record<Finger, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', little: 'Little' };

/**
 * The core source for a choice. "You" is whoever wears the gloves: the core drives the robot from a role (master or
 * learner), so it follows the role of the right glove, else the left, else master. In the browser any role does.
 */
export function sourceFor(choice: DriveChoice, roles: Partial<Record<Side, string>>): RobotSource {
  if (choice === 'off') return 'off';
  if (choice === 'lesson') return 'lesson';
  for (const side of ['right', 'left'] as Side[]) {
    const r = roles[side];
    if (r === 'master' || r === 'learner') return r;
  }
  return 'master';
}

export type Tone = 'ok' | 'plain' | 'fix' | 'missing';

export interface FingerLine {
  finger: Finger;
  text: string;
  tone: Tone;
}

/** Robot joints per finger from the robot description (joint names carry the finger). */
export function jointsPerFinger(robot: RobotDescription, side: Side): Partial<Record<Finger, number>> {
  const out: Partial<Record<Finger, number>> = {};
  for (const n of robot.joints[side] ?? []) {
    const f = fingerOf(n);
    if (f) out[f] = (out[f] ?? 0) + 1;
  }
  return out;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * One plain sentence per finger. A finger that follows fully is malachite; one the robot copies with fewer joints than
 * a person has is plain ink; one pushed past its joint limits is vermilion with what to change; a finger the robot does
 * not have says so.
 */
export function fingerLines(robot: RobotDescription | null, side: Side, fidelity: Partial<Record<Finger, number>> | null): FingerLine[] {
  const fingers: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
  const joints = robot ? jointsPerFinger(robot, side) : {};
  return fingers.map((f) => {
    const n = joints[f] ?? 0;
    if (robot && (robot.missing.includes(f) || n === 0)) return { finger: f, text: `${FINGER_NAME[f]}: the robot has no ${f} finger, so this string hangs loose.`, tone: 'missing' };
    const human = ROBOT_CONFIG.humanDofs[f] ?? 3;
    const coverage = Math.min(1, n / human);
    const fid = fidelity?.[f];
    if (fid === undefined) {
      const how = coverage >= 0.99 ? `copies all ${human} of your bending joints` : `bends in ${n} joints where you bend ${human}`;
      return { finger: f, text: `${FINGER_NAME[f]}: ${how}.`, tone: 'plain' };
    }
    if (fid < coverage - 0.02) return { finger: f, text: `${FINGER_NAME[f]} is at its joint limit (${pct(fid)}): bend it less.`, tone: 'fix' };
    if (coverage >= 0.99) return { finger: f, text: `${FINGER_NAME[f]} follows you fully (${pct(fid)}).`, tone: 'ok' };
    return { finger: f, text: `${FINGER_NAME[f]} follows in ${n} joints for your ${human} (${pct(fid)}).`, tone: 'plain' };
  });
}

const MODEL_NAME: Record<string, string> = { dex3_1: 'Unitree Dex3-1' };

export function modelName(model: string | undefined): string {
  return (model && MODEL_NAME[model]) || model || 'robot';
}

/** The connection sentence: core reachable or not, robot model loaded or not, or the browser stand-in. */
export function connectionLine(s: RobotState): { text: string; tone: Tone } {
  const robot = s.robot;
  const joints = robot ? robot.joints.right?.length ?? 0 : 0;
  const what = robot ? `${modelName(robot.model)} loaded: ${joints} joints (${robot.fingers.join(', ')})` : '';
  if (s.link === 'connecting') return { text: `Looking for the core at ${s.coreLabel}...`, tone: 'plain' };
  if (s.link === 'core') {
    if (!s.described) return { text: `Core reachable at ${s.coreLabel}. Waiting for its robot model...`, tone: 'plain' };
    if (!robot) return { text: `Core reachable at ${s.coreLabel}, but it has no robot model loaded. The core log says why (a missing URDF, usually).`, tone: 'fix' };
    return { text: `Core reachable at ${s.coreLabel}${s.fake ? ' (simulated gloves)' : ''}. ${what}.`, tone: 'ok' };
  }
  const how = robot ? ` ${what} in this browser.` : s.error ? ` The robot model could not be read: ${s.error}` : '';
  if (s.mockOnly) return { text: `Sample data: the core is not used, the robot is worked out in this browser with the core's table.${how}`, tone: 'plain' };
  return { text: `Core not reachable at ${s.coreLabel}. Until it answers, the robot is worked out in this browser with the core's table.${how}`, tone: 'plain' };
}

/** The lag sentence. */
export function lagLine(lagMs: number | null, link: RobotState['link']): string {
  if (lagMs === null) return 'Lag: move a finger to measure it.';
  const where = link === 'core' ? 'from a glove change to the core\'s robot message' : 'from a glove change to the robot, in this browser';
  return `Lag ${lagMs} ms ${where}.`;
}
