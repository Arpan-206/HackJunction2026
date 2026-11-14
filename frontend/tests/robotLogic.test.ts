import { describe, expect, it } from 'vitest';
import type { RobotDescription } from '../src/api/robotTypes';
import type { RobotState } from '../src/api/useRobotStream';
import { connectionLine, fingerLines, lagLine, sourceFor } from '../src/features/shared/robot/logic';

const robot: RobotDescription = {
  model: 'dex3_1',
  fingers: ['thumb', 'index', 'middle'],
  missing: ['ring', 'little'],
  joints: {
    left: [],
    right: ['thumb_0', 'thumb_1', 'thumb_2', 'index_0', 'index_1', 'middle_0', 'middle_1'].map((k) => `right_hand_${k}_joint`),
  },
  limits: { left: {}, right: {} },
  urdf: { left: 'dex3_1_l.urdf', right: 'dex3_1_r.urdf' },
};

const state = (p: Partial<RobotState>): RobotState => ({
  link: 'core',
  coreLabel: 'localhost:8765',
  coreDown: false,
  mockOnly: false,
  robot,
  described: true,
  fake: false,
  source: 'off',
  roles: {},
  lessonId: null,
  mode: null,
  lessons: [],
  lagMs: null,
  error: null,
  ...p,
});

describe('robot screen words', () => {
  it('"you" follows the glove role the core gives, master by default', () => {
    expect(sourceFor('you', { right: 'learner', left: 'master' })).toBe('learner');
    expect(sourceFor('you', { right: 'free', left: 'master' })).toBe('master');
    expect(sourceFor('you', {})).toBe('master');
    expect(sourceFor('lesson', {})).toBe('lesson');
    expect(sourceFor('off', { right: 'master' })).toBe('off');
  });

  it('says per finger how well the robot copies, in plain words with the right tone', () => {
    const lines = fingerLines(robot, 'right', { thumb: 1, index: 0.667, middle: 0.4 });
    expect(lines.map((l) => l.tone)).toEqual(['ok', 'plain', 'fix', 'missing', 'missing']);
    expect(lines[0].text).toBe('Thumb follows you fully (100%).');
    expect(lines[1].text).toBe('Index follows in 2 joints for your 3 (67%).');
    expect(lines[2].text).toBe('Middle is at its joint limit (40%): bend it less.');
    expect(lines[3].text).toMatch(/^Ring: the robot has no ring finger/);
  });

  it('describes the fingers before any message arrives', () => {
    const lines = fingerLines(robot, 'right', null);
    expect(lines[0].text).toBe('Thumb: copies all 2 of your bending joints.');
    expect(lines[1].text).toBe('Index: bends in 2 joints where you bend 3.');
  });

  it('names the connection: core with its model, core without one, the fallback and sample data', () => {
    expect(connectionLine(state({ fake: true })).text).toBe('Core reachable at localhost:8765 (simulated gloves). Unitree Dex3-1 loaded: 7 joints (thumb, index, middle).');
    expect(connectionLine(state({ robot: null })).tone).toBe('fix');
    expect(connectionLine(state({ link: 'mock', coreDown: true })).text).toMatch(/^Core not reachable at localhost:8765\./);
    expect(connectionLine(state({ link: 'mock', mockOnly: true })).text).toMatch(/^Sample data/);
    expect(connectionLine(state({ link: 'connecting' })).text).toBe('Looking for the core at localhost:8765...');
  });

  it('says the lag in milliseconds, or how to measure it', () => {
    expect(lagLine(null, 'core')).toBe('Lag: move a finger to measure it.');
    expect(lagLine(23, 'core')).toBe("Lag 23 ms from a glove change to the core's robot message.");
  });
});
