import { describe, expect, it } from 'vitest';
import type { MotionSpec } from '../src/api/types';
import { motionSpecSchema } from '../src/api/schemas';
import { MOVES } from '../src/mock/seed';
import { handFrame, poseAt } from '../src/mock/synth';
import { synthFrame } from '../src/three/motion';
import { motionPeriod } from '../src/features/apprentice/training/coach/reference';

const move = (id: string): MotionSpec => {
  const m = MOVES.find((x) => x.id === id);
  if (!m) throw new Error(`no move ${id}`);
  return m.default_motion;
};

/** Same values as backend/tests/test_new_skills.py, so the port and the backend agree. */
describe('keyframes and per-hand hold poses (port of the backend synthesiser)', () => {
  it('every new move validates against the wire schema', () => {
    for (const m of MOVES.filter((x) => ['shadow_puppets', 'surgical_grips', 'crochet'].includes(x.skill))) {
      expect(motionSpecSchema.safeParse(m.default_motion).success, m.id).toBe(true);
    }
  });

  it('eases into each key over the first half of its slot and holds it', () => {
    const dog = move('sp_talking_dog');
    expect(motionPeriod(dog)).toBeCloseTo(1.2);
    expect(poseAt(dog, 1.1).curls[0]).toBeCloseTo(0.6);
    expect(poseAt(dog, 0.5).curls[0]).toBeCloseTo(0.1);
    expect(poseAt(dog, 0.6 + 0.15).curls[0]).toBeCloseTo(0.35);
    expect(handFrame(dog, 'right', 0.37)).toEqual(handFrame(dog, 'right', 1.57));
  });

  it('turns the wrist: the bird flaps by pitch, the hook rolls on a yarn-over', () => {
    const bird = move('sp_flapping_bird');
    expect(poseAt(bird, 0.35).pitch).toBeCloseTo((30 * Math.PI) / 180, 3);
    expect(poseAt(bird, 0.75).pitch).toBeCloseTo((-30 * Math.PI) / 180, 3);
    const chain = move('cr_chain');
    expect(poseAt(chain, 0.33, 'right').roll).toBeCloseTo((40 * Math.PI) / 180, 3);
    expect(poseAt(chain, 0.33, 'left').curls[1]).toBeCloseTo(0.05);
    expect(poseAt(chain, 0.33, 'right').curls[1]).toBeCloseTo(0.4);
  });

  it('gives the snail a fist shell on the left and feelers on the right', () => {
    const snail = move('sp_snail');
    expect(poseAt(snail, 0, 'left').curls[1]).toBeCloseTo(0.95);
    expect(poseAt(snail, 0, 'right').curls[1]).toBeCloseTo(0);
  });

  it('the preview synthesiser shows the same keyframed wrist and curls as the port', () => {
    const chain = move('cr_chain');
    for (const side of ['left', 'right'] as const) {
      const a = synthFrame(chain, 0.33, side);
      const b = handFrame(chain, side, 0.33);
      a.wrist_quat.forEach((v, i) => expect(v).toBeCloseTo(b.wrist_quat[i], 3));
    }
    expect(synthFrame(chain, 0.33, 'left').flexion.index[0]).toBeLessThan(synthFrame(chain, 0.7, 'left').flexion.index[0]);
  });
});
