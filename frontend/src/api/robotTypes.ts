import type { Finger, Side } from './types';

/**
 * Wire shapes of the core's /ws/robot socket (schema/robot.json, SPEC.md, core/server.py `handle_robot_ws`). These
 * belong to the core's frozen contract, not to docs/CONTRACT.md, so they live here and not in types.ts.
 */

/** What the robot follows: the expert's hand, the learner's hand, the loaded lesson, or nothing. */
export type RobotSource = 'master' | 'learner' | 'lesson' | 'off';

/** `hello.robot`: core/robot.py `Retargeter.describe()`. */
export interface RobotDescription {
  model: string;
  fingers: Finger[];
  missing: Finger[];
  joints: Record<Side, string[]>;
  /** [lower, upper] in radians per joint, from the URDF. */
  limits: Record<Side, Record<string, [number, number]>>;
  urdf: Record<Side, string>;
}

/** One tick of robot targets (schema/robot.json). */
export interface RobotMessage {
  v: 1;
  type: 'robot';
  /** Core clock, microseconds. */
  t: number;
  model: string;
  source: Exclude<RobotSource, 'off'>;
  hand: Side;
  angles_from?: 'hand' | 'lesson';
  /** Joint targets in radians, clamped to the URDF limits. */
  q: Record<string, number>;
  /** Each target as 0..1 of its limit range. */
  q_norm?: Record<string, number>;
  /** 0..1 per robot finger: coverage of the human joints times one minus the clipping loss. */
  fidelity: Partial<Record<Finger, number>>;
  missing: Finger[];
}

/** The parts of the core's `hello` the robot screen reads. */
export interface RobotHello {
  v: 1;
  type: 'hello';
  fake?: boolean;
  robot: RobotDescription | null;
  session?: { roles?: Partial<Record<Side, string>>; robot_source?: RobotSource; lesson_id?: string | null; mode?: string };
  lessons?: unknown[];
}

/** The core's command envelope (schema/cmd.json). */
export interface CoreCommand {
  v: 1;
  type: 'cmd';
  id: string;
  name: string;
  args?: Record<string, unknown>;
}

export interface CoreAck {
  v: 1;
  type: 'ack';
  id: string;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: { code: string; message: string };
}
