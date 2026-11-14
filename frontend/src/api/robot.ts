import { FINGERS, type Finger, type Side } from './types';

/**
 * Wire types for the core's robot socket, `ws://core:8765/ws/robot`. They mirror `schema/robot.json`, the `robot` block
 * of `hello.json` and `cmd.json`/`ack.json` in the repo's `schema/` folder (SPEC.md, the core's contract), not
 * docs/CONTRACT.md, which has no robot field. Keep them in step with those schemas, never with guesses.
 */

export type RobotSource = 'master' | 'learner' | 'lesson' | 'off';
export const ROBOT_SOURCES: readonly RobotSource[] = ['master', 'learner', 'lesson', 'off'] as const;

/** `hello.robot`: the model the core retargets to, per side. */
export interface RobotDescription {
  model: string;
  fingers: Finger[];
  /** Human fingers the robot has no finger for. */
  missing: Finger[];
  joints: Record<Side, string[]>;
  /** URDF lower and upper limit in radians per joint name. */
  limits: Record<Side, Record<string, [number, number]>>;
  urdf?: Record<Side, string>;
}

export interface RobotSessionState {
  robot_source?: RobotSource;
  /** Which role each physical hand plays in the core: `master`, `learner` or `free`. */
  roles?: Partial<Record<Side, string>>;
  mode?: string;
  lesson_id?: string | null;
  step?: number | null;
}

export interface RobotHello {
  v: 1;
  type: 'hello';
  t: number;
  robot: RobotDescription | null;
  session: RobotSessionState;
  fake?: boolean;
}

/** One tick of joint targets, sent only while a source is on and a hand (or lesson step) feeds it. */
export interface RobotMessage {
  v: 1;
  type: 'robot';
  /** Core clock, microseconds. */
  t: number;
  model: string;
  source: Exclude<RobotSource, 'off'>;
  hand: Side;
  angles_from?: 'hand' | 'lesson';
  /** Joint name to radians, clamped to the URDF limits. */
  q: Record<string, number>;
  /** 0 at the lower limit, 1 at the upper. */
  q_norm?: Record<string, number>;
  /** Per robot finger, 0 to 1: how much of the human finger the robot can copy. */
  fidelity: Partial<Record<Finger, number>>;
  missing: Finger[];
}

export interface RobotAck {
  v: 1;
  type: 'ack';
  t: number;
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export type RobotIncoming = RobotHello | RobotMessage | RobotAck;

export interface RobotCommand {
  v: 1;
  type: 'cmd';
  id: string;
  name: 'set_robot_source' | 'ping' | 'set_roles';
  args?: Record<string, unknown>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Parses one socket message, or returns null for anything that is not a hello, robot or ack of the right shape. */
export function parseRobotIncoming(raw: unknown): RobotIncoming | null {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    try {
      m = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isObj(m) || typeof m.type !== 'string') return null;
  if (m.type === 'hello') return isObj(m.session) ? (m as unknown as RobotHello) : null;
  if (m.type === 'ack') return typeof m.id === 'string' && typeof m.ok === 'boolean' ? (m as unknown as RobotAck) : null;
  if (m.type === 'robot') {
    if (!isObj(m.q) || !isObj(m.fidelity) || !Array.isArray(m.missing)) return null;
    if (m.hand !== 'left' && m.hand !== 'right') return null;
    if (m.source !== 'master' && m.source !== 'learner' && m.source !== 'lesson') return null;
    return m as unknown as RobotMessage;
  }
  return null;
}

/** User-facing names for the sources. Wire values keep the core's words. */
export const SOURCE_LABEL: Record<RobotSource, string> = {
  master: 'Expert glove',
  learner: 'Apprentice glove',
  lesson: 'Lesson',
  off: 'Off',
};

export const SOURCE_HINT: Record<RobotSource, string> = {
  master: 'The robot copies the expert while they record.',
  learner: 'The robot copies the apprentice as they practise.',
  lesson: 'The robot plays the lesson step, as the expert recorded it.',
  off: 'The robot rests.',
};

export const SOURCE_OPTIONS: { id: RobotSource; label: string; hint: string }[] = ROBOT_SOURCES.map((id) => ({ id, label: SOURCE_LABEL[id], hint: SOURCE_HINT[id] }));

/** `right_hand_index_0_joint` reads as `index 0`. */
export function shortJointName(name: string): string {
  return name
    .replace(/^(left|right)_hand_/, '')
    .replace(/_joint$/, '')
    .replace(/_/g, ' ');
}

/** The human finger a robot joint stands in for, from its name. */
export function jointFinger(name: string): Finger | null {
  for (const f of FINGERS) if (name.includes(f)) return f;
  return null;
}

/** The hand that carries a role in the core, from `hello.session.roles`. */
export function handWithRole(roles: RobotSessionState['roles'], role: 'master' | 'learner'): Side | null {
  if (!roles) return null;
  for (const side of ['left', 'right'] as Side[]) if (roles[side] === role) return side;
  return null;
}

/**
 * Why the robot is still: one line for the moment a source is on but no robot message arrives. The core sends
 * nothing while the source's hand is not tracked or no lesson step is playing.
 */
export function waitingLine(source: RobotSource, session: RobotSessionState | null): string {
  if (source === 'off') return 'The robot rests.';
  if (source === 'lesson') {
    return session?.lesson_id ? 'Waiting for a lesson step to play (learn or playback mode in the engine).' : 'No lesson is loaded in the engine, so there is no step to play.';
  }
  const who = source === 'master' ? 'expert' : 'apprentice';
  const side = handWithRole(session?.roles, source);
  if (!side) return `No glove plays the ${who} in the engine right now, so the robot waits.`;
  return `Waiting for the ${who}'s ${side} glove to be tracked.`;
}
