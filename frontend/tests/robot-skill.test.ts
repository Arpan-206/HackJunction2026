import { describe, expect, it } from 'vitest';
import { FINGERS, type Finger, type HandFrame, type JointTriple } from '../src/api/types';
import { flexionDegrees } from '../src/features/apprentice/training/coach/deviation';
import {
  BEND_FAULT,
  BEND_STEP,
  FULL_CURL_RAD,
  LAG_STEP_S,
  PASS_SCORE,
  applyInstruction,
  bakeDemo,
  faultCandidates,
  fingerErrors,
  fixesFault,
  perfectSkill,
  planRounds,
  robotHandAt,
  robotScore,
  withFault,
  type CycleSource,
  type Fault,
  type Instruction,
} from '../src/features/shared/robot/teach/robotSkill';
import { restFrame } from '../src/three/motion';

const PERIOD = 2;
function frameWith(j: JointTriple): HandFrame {
  const f = restFrame();
  const flexion = {} as Record<Finger, JointTriple>;
  for (const k of FINGERS) flexion[k] = [...j] as JointTriple;
  return { ...f, flexion };
}
const curled: CycleSource = () => frameWith([1.0, 1.0, 0.8]);
const staticOpen: CycleSource = () => frameWith([0.1, 0.1, 0.1]);
/** Index moves over the cycle, others curled. */
const moving: CycleSource = (t) => {
  const f = frameWith([1.0, 1.0, 0.8]);
  const s = 0.6 + 0.6 * Math.sin((2 * Math.PI * t) / PERIOD);
  f.flexion.index = [s, s, s];
  return f;
};
const ramp: CycleSource = (t) => frameWith([t * 0.5, t * 0.5, t * 0.5]);
const ins = (finger: Finger, axis: 'bend' | 'time', dir: 1 | -1, amount = 1): Instruction => ({ finger, axis, dir, amount });

describe('applyInstruction', () => {
  it('moves bend by BEND_STEP * amount without mutating', () => {
    const s = perfectSkill();
    const n = applyInstruction(s, ins('index', 'bend', 1, 0.5));
    expect(n.index.bend).toBeCloseTo(BEND_STEP * 0.5);
    expect(s.index.bend).toBe(0);
    expect(n.thumb.bend).toBe(0);
  });
  it('moves lag by LAG_STEP_S * amount', () => {
    expect(applyInstruction(perfectSkill(), ins('ring', 'time', -1, 1.8)).ring.lag).toBeCloseTo(-LAG_STEP_S * 1.8);
    expect(applyInstruction(perfectSkill(), ins('ring', 'time', 1)).ring.lag).toBeCloseTo(LAG_STEP_S);
  });
  it('clamps bend to -1..1 and lag to -0.6..0.6', () => {
    let s = perfectSkill();
    for (let i = 0; i < 20; i++) s = applyInstruction(s, ins('index', 'bend', 1, 1.8));
    expect(s.index.bend).toBe(1);
    for (let i = 0; i < 40; i++) s = applyInstruction(s, ins('index', 'bend', -1, 1.8));
    expect(s.index.bend).toBe(-1);
    for (let i = 0; i < 20; i++) s = applyInstruction(s, ins('index', 'time', 1, 1.8));
    expect(s.index.lag).toBeCloseTo(0.6);
    for (let i = 0; i < 40; i++) s = applyInstruction(s, ins('index', 'time', -1, 1.8));
    expect(s.index.lag).toBeCloseTo(-0.6);
  });
});

describe('robotHandAt', () => {
  it('perfect skill returns the expert flexion', () => {
    expect(robotHandAt(moving, perfectSkill(), 0.4).flexion).toEqual(moving(0.4).flexion);
  });
  it('bend -1 gives zero flexion on that finger only', () => {
    const s = withFault({ finger: 'index', axis: 'bend', value: -1 });
    const h = robotHandAt(curled, s, 0);
    expect(h.flexion.index).toEqual([0, 0, 0]);
    expect(h.flexion.middle).toEqual(curled(0).flexion.middle);
  });
  it('bend 1 gives at least a full curl per joint', () => {
    const s = withFault({ finger: 'index', axis: 'bend', value: 1 });
    for (const r of robotHandAt(staticOpen, s, 0).flexion.index) expect(r).toBeGreaterThanOrEqual(FULL_CURL_RAD - 1e-9);
  });
  it('lag samples the source at t - lag', () => {
    const s = withFault({ finger: 'thumb', axis: 'time', value: 0.3 });
    expect(robotHandAt(ramp, s, 1).flexion.thumb).toEqual(ramp(0.7).flexion.thumb);
    expect(robotHandAt(ramp, s, 1).flexion.index).toEqual(ramp(1).flexion.index);
  });
});

describe('robotScore and fixesFault', () => {
  const score = (skill: ReturnType<typeof perfectSkill>) => robotScore(fingerErrors(curled, (t) => robotHandAt(curled, skill, t), PERIOD));
  it('is 100 for a perfect skill', () => {
    expect(score(perfectSkill())).toBe(100);
  });
  it('is below PASS_SCORE for a bend fault on a curled finger', () => {
    expect(score(withFault({ finger: 'index', axis: 'bend', value: -BEND_FAULT }))).toBeLessThan(PASS_SCORE);
  });
  it('two plain correct corrections reach PASS_SCORE', () => {
    let s = withFault({ finger: 'index', axis: 'bend', value: -BEND_FAULT });
    for (let i = 0; i < 2; i++) s = applyInstruction(s, ins('index', 'bend', 1));
    expect(score(s)).toBeGreaterThanOrEqual(PASS_SCORE);
  });
  it('two wrong-direction corrections lower the score', () => {
    const start = withFault({ finger: 'index', axis: 'bend', value: -BEND_FAULT });
    let s = start;
    for (let i = 0; i < 2; i++) s = applyInstruction(s, ins('index', 'bend', -1));
    expect(score(s)).toBeLessThan(score(start));
  });
  it('fixesFault checks finger, axis and direction', () => {
    const f: Fault = { finger: 'index', axis: 'bend', value: -BEND_FAULT };
    expect(fixesFault(ins('index', 'bend', 1), f)).toBe(true);
    expect(fixesFault(ins('index', 'bend', -1), f)).toBe(false);
    expect(fixesFault(ins('ring', 'bend', 1), f)).toBe(false);
    expect(fixesFault(ins('index', 'time', 1), f)).toBe(false);
    expect(fixesFault(ins('index', 'bend', 1), null)).toBe(false);
    const lag: Fault = { finger: 'thumb', axis: 'time', value: 0.2 };
    expect(fixesFault(ins('thumb', 'time', -1), lag)).toBe(true);
    expect(fixesFault(ins('thumb', 'time', 1), lag)).toBe(false);
  });
});

describe('faultCandidates and planRounds', () => {
  it('gives no time faults for a static pose', () => {
    const c = faultCandidates(curled, PERIOD);
    expect(c.length).toBeGreaterThan(0);
    expect(c.filter((x) => x.axis === 'time')).toEqual([]);
  });
  it('gives time faults for a moving finger', () => {
    expect(faultCandidates(moving, PERIOD).some((x) => x.axis === 'time' && x.finger === 'index')).toBe(true);
  });
  const cands: Fault[] = [
    { finger: 'index', axis: 'bend', value: -BEND_FAULT },
    { finger: 'ring', axis: 'bend', value: -BEND_FAULT },
  ];
  it('plans a first fault round with one catch and one relapse', () => {
    for (let i = 0; i < 30; i++) {
      const plan = planRounds(cands);
      expect(plan[0].kind).toBe('fault');
      expect(plan[0].fault).not.toBeNull();
      expect(plan.filter((p) => p.kind === 'catch')).toHaveLength(1);
      expect(plan.filter((p) => p.kind === 'relapse')).toHaveLength(1);
      expect(plan.find((p) => p.kind === 'catch')!.fault).toBeNull();
    }
  });
  it('with no candidates plans a single catch round', () => {
    expect(planRounds([])).toEqual([{ fault: null, kind: 'catch' }]);
  });
});

describe('bakeDemo', () => {
  it('weight 1 with a constant demo returns the demo flexion', () => {
    const demo = frameWith([0.3, 0.4, 0.5]);
    const baked = bakeDemo(moving, Array.from({ length: 12 }, () => demo), PERIOD, 1);
    for (const t of [0, 0.37, 1.1, 1.9, 2.5]) {
      const d = flexionDegrees(baked(t));
      const e = flexionDegrees(demo);
      for (const f of FINGERS) expect(d[f]).toBeCloseTo(e[f], 6);
    }
  });
});
