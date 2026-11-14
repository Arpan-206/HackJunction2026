import { describe, expect, it } from 'vitest';
import type { GloveFrame, MotionSpec, Side } from '../src/api/types';
import { scoreFrames } from '../src/mock/scoring';
import { FINGER_NAMES, handFrame, synthesise } from '../src/mock/synth';
import movesJson from '../src/mock/data/moves.json';
import { synthFrame } from '../src/three/motion';

/**
 * Lane thumb-align: the preview hand (three/motion.ts synthFrame) must show the same joint angles as the scorer's
 * reference (mock/synth.ts, the port of the backend synthesiser), so a pose copied exactly from the preview scores as
 * perfect. Before the fix the preview's thumb skipped THUMB_FLEXION_SCALE and sat up to 26 degrees of total thumb
 * flexion off (letter M).
 */

interface Move {
  id: string;
  hands: 'left' | 'right' | 'both';
  default_motion: MotionSpec;
}

const MOVES = (movesJson as unknown as Move[]).filter((m) => m.id.startsWith('fs_') || m.id.startsWith('sp_'));
const MAX_JOINT_DEG = 5;
const FPS = 30;
const RAD = 180 / Math.PI;

const sidesOf = (m: Move): Side[] => (m.hands === 'both' ? ['left', 'right'] : [m.hands]);

/** Seconds to sample: one loop of a keyframed motion, two seconds of a held pose. */
function durationOf(spec: MotionSpec): number {
  if (spec.preset === 'keyframes') return spec.keys.reduce((s, k) => s + k.ms, 0) / 1000;
  return 2;
}

/** The largest per-joint gap in degrees between the preview and the scorer's reference over the whole motion. */
function worstJointDeg(spec: MotionSpec, side: Side): { deg: number; finger: string } {
  let worst = { deg: 0, finger: '' };
  const n = Math.round(durationOf(spec) * FPS);
  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    const preview = synthFrame(spec, t, side).flexion;
    const target = handFrame(spec, side, t).flexion;
    for (const f of FINGER_NAMES) {
      for (let j = 0; j < 3; j++) {
        const d = Math.abs(preview[f][j] - target[f][j]) * RAD;
        if (d > worst.deg) worst = { deg: d, finger: `${f}[${j}]` };
      }
    }
  }
  return worst;
}

describe('the preview thumb matches the scorer thumb', () => {
  it('covers all 26 letters, both words and the five shadow puppets', () => {
    expect(MOVES.filter((m) => /^fs_[a-z]$/.test(m.id))).toHaveLength(26);
    expect(MOVES.filter((m) => m.id.startsWith('sp_'))).toHaveLength(5);
  });

  for (const move of MOVES) {
    for (const side of sidesOf(move)) {
      it(`${move.id} (${side}): every joint within ${MAX_JOINT_DEG} degrees of the scorer's target`, () => {
        const worst = worstJointDeg(move.default_motion, side);
        expect(worst.deg, `${move.id} ${side} ${worst.finger}`).toBeLessThan(MAX_JOINT_DEG);
      });
    }
  }

  it('a pose copied exactly from the preview scores as perfect', () => {
    const tolerance = { angle_deg: 18, timing_ms: 250 };
    for (const move of MOVES) {
      for (const side of sidesOf(move)) {
        const spec = move.default_motion;
        const seconds = Math.max(2, durationOf(spec));
        const reference = synthesise(spec, side, seconds, FPS);
        const copied: GloveFrame[] = reference.map((f) => ({ t: f.t, source: 'replay', hands: [{ ...synthFrame(spec, f.t, side), spread: null }] }));
        const result = scoreFrames(reference, copied, side, tolerance);
        expect(result.overall, `${move.id} ${side}`).toBeGreaterThanOrEqual(99);
      }
    }
  });
});
