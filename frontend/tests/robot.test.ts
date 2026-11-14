import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { handWithRole, parseRobotIncoming, shortJointName, SOURCE_OPTIONS, waitingLine } from '../src/api/robot';
import { angleFeatures, autoSign, describeRobot, limitsOf, pickHand, retargetAngles, retargetHand, robotMessage } from '../src/mock/robot';
import { fingerOfName, forwardKinematics, linkShapes, pointInRoot, restPose, URDF_TO_SCENE, urdfToHandMatrix } from '../src/three/robot/kinematics';
import { movableJoints, parseUrdf } from '../src/three/robot/urdf';
import { DEG, handWith } from './helpers';

const dir = path.resolve(__dirname, '../public/models/robots/dex3_1');
const right = parseUrdf(readFileSync(path.join(dir, 'dex3_1_r.urdf'), 'utf8'));
const left = parseUrdf(readFileSync(path.join(dir, 'dex3_1_l.urdf'), 'utf8'));
const limits = { left: limitsOf(left), right: limitsOf(right) };

describe('URDF reader on the Dex3-1 files', () => {
  it('finds the palm, seven revolute joints with their limits, axes and origins', () => {
    expect(right.name).toBe('dex3_1_r');
    expect(right.root).toBe('right_hand_palm_link');
    expect(right.links.map((l) => l.name)).toHaveLength(8);
    const joints = movableJoints(right);
    expect(joints.map((j) => j.name)).toEqual([
      'right_hand_thumb_0_joint',
      'right_hand_thumb_1_joint',
      'right_hand_thumb_2_joint',
      'right_hand_middle_0_joint',
      'right_hand_middle_1_joint',
      'right_hand_index_0_joint',
      'right_hand_index_1_joint',
    ]);
    const index0 = joints.find((j) => j.name === 'right_hand_index_0_joint')!;
    expect(index0.type).toBe('revolute');
    expect(index0.parent).toBe('right_hand_palm_link');
    expect(index0.child).toBe('right_hand_index_0_link');
    expect(index0.origin.xyz).toEqual([0.0777, -0.0016, 0.0285]);
    expect(index0.axis).toEqual([0, 0, 1]);
    expect(index0.lower).toBe(0);
    expect(index0.upper).toBeCloseTo(1.5708, 3);
    const thumb0 = joints.find((j) => j.name === 'right_hand_thumb_0_joint')!;
    expect(thumb0.axis).toEqual([0, 1, 0]);
    expect(thumb0.lower).toBeCloseTo(-1.0472, 3);
  });

  it('keeps the centre of mass and the thumb collision box, and ignores the commented-out floating base', () => {
    const tip = right.links.find((l) => l.name === 'right_hand_index_1_link')!;
    expect(tip.inertialOrigin?.[0]).toBeCloseTo(0.0263, 3);
    const thumb1 = right.links.find((l) => l.name === 'right_hand_thumb_1_link')!;
    expect(thumb1.collisionBox?.size).toEqual([0.02, 0.03, 0.02]);
    expect(right.joints.some((j) => j.name === 'floating_base_joint')).toBe(false);
    expect(right.links.some((l) => l.name === 'world')).toBe(false);
  });

  it('mirrors the left hand: thumb on the other side, flexion limits negative', () => {
    const lj = Object.fromEntries(movableJoints(left).map((j) => [j.name, j]));
    expect(lj.left_hand_thumb_1_joint.origin.xyz[1]).toBeCloseTo(-0.0193, 4);
    expect(lj.left_hand_index_0_joint.lower).toBeCloseTo(-1.5708, 3);
    expect(lj.left_hand_index_0_joint.upper).toBe(0);
  });

  it('names the finger of each joint', () => {
    expect(fingerOfName('right_hand_thumb_2_joint')).toBe('thumb');
    expect(fingerOfName('left_hand_middle_0_link')).toBe('middle');
    expect(fingerOfName('right_hand_palm_link')).toBeNull();
  });
});

describe('capsules from the joint origins', () => {
  it('gives every link a shape and each finger a tip at the end of its last capsule', () => {
    const { shapes, tips } = linkShapes(right);
    expect([...shapes.keys()]).toHaveLength(8);
    const palm = shapes.get('right_hand_palm_link')!;
    expect(palm[0].kind).toBe('box');
    const seg = shapes.get('right_hand_index_0_link')![0];
    expect(seg.kind).toBe('capsule');
    if (seg.kind === 'capsule') expect(seg.to).toEqual([0.0458, 0, 0]);
    expect(tips.index?.link).toBe('right_hand_index_1_link');
    expect(tips.index?.point[0]).toBeCloseTo(0.0526, 3);
    expect(tips.thumb?.link).toBe('right_hand_thumb_2_link');
    expect(tips.thumb?.point[1]).toBeCloseTo(0.0526, 3);
    expect(tips.ring).toBeUndefined();
  });
});

describe('forward kinematics', () => {
  it('puts the straight index tip 17.6 cm out along x and curls it towards the palm (+y) when the knuckle flexes', () => {
    const { tips } = linkShapes(right);
    const open = forwardKinematics(right, restPose(right));
    const tip = pointInRoot(open, tips.index!.link, tips.index!.point);
    expect(tip.x).toBeCloseTo(0.0777 + 0.0458 + 0.0526, 4);
    // The tip point is twice the centre of mass, which sits a few millimetres off the segment axis.
    expect(Math.abs(tip.y)).toBeLessThan(0.01);
    expect(tip.z).toBeCloseTo(0.0285, 3);

    const bent = forwardKinematics(right, { right_hand_index_0_joint: Math.PI / 2 });
    const bentTip = pointInRoot(bent, tips.index!.link, tips.index!.point);
    // The tip's few millimetres of sideways offset turn into x when the finger stands up.
    expect(bentTip.x).toBeCloseTo(0.0777, 2);
    expect(bentTip.y).toBeCloseTo(-0.0016 + 0.0458 + 0.0526, 3);
  });

  it('bends the left index the other way, towards its palm at -y', () => {
    const { tips } = linkShapes(left);
    const bent = forwardKinematics(left, { left_hand_index_0_joint: -Math.PI / 2 });
    const tip = pointInRoot(bent, tips.index!.link, tips.index!.point);
    expect(tip.y).toBeLessThan(-0.09);
  });

  it('places the thumb at the palm centre pointing out of the palm; thumb_1 bends it and thumb_0 then swings it', () => {
    const { tips } = linkShapes(right);
    const open = forwardKinematics(right, restPose(right));
    const thumbTip = pointInRoot(open, tips.thumb!.link, tips.thumb!.point);
    expect(thumbTip.y).toBeGreaterThan(0.1);
    expect(Math.abs(thumbTip.z)).toBeLessThan(0.01);
    // thumb_1 turns about z, so the straight thumb (+y) leans into x; thumb_0 (about y) then moves that lean in z.
    const bent = pointInRoot(forwardKinematics(right, { right_hand_thumb_1_joint: -0.6 }), tips.thumb!.link, tips.thumb!.point);
    expect(bent.x).toBeGreaterThan(thumbTip.x + 0.03);
    const swung = pointInRoot(forwardKinematics(right, { right_hand_thumb_1_joint: -0.6, right_hand_thumb_0_joint: 0.8 }), tips.thumb!.link, tips.thumb!.point);
    expect(Math.abs(swung.z - bent.z)).toBeGreaterThan(0.02);
  });
});

describe('URDF frame to hand space', () => {
  const inHand = (side: 'left' | 'right', p: Vector3) => p.clone().applyMatrix4(urdfToHandMatrix(side)).multiplyScalar(URDF_TO_SCENE);

  it('is a proper rotation for both sides', () => {
    for (const side of ['left', 'right'] as const) expect(urdfToHandMatrix(side).determinant()).toBeCloseTo(1, 6);
  });

  it('sends fingers along -z, the palm down, and keeps the index on the thumb side', () => {
    const { tips } = linkShapes(right);
    const fk = forwardKinematics(right, restPose(right));
    const index = inHand('right', pointInRoot(fk, tips.index!.link, tips.index!.point));
    const middle = inHand('right', pointInRoot(fk, tips.middle!.link, tips.middle!.point));
    const thumb = inHand('right', pointInRoot(fk, tips.thumb!.link, tips.thumb!.point));
    expect(index.z).toBeLessThan(-1.5);
    expect(index.x).toBeLessThan(middle.x);
    // The Dex3-1 thumb sits at the palm centre near the wrist and points out of the palm, so it hangs below the hand.
    expect(Math.abs(thumb.x)).toBeLessThan(0.1);
    expect(thumb.z).toBeGreaterThan(index.z + 0.8);
    expect(thumb.y).toBeLessThan(-0.5);
    const bent = forwardKinematics(right, { right_hand_index_0_joint: Math.PI / 2 });
    const bentIndex = inHand('right', pointInRoot(bent, tips.index!.link, tips.index!.point));
    expect(bentIndex.y).toBeLessThan(index.y - 0.5);

    const lt = linkShapes(left).tips;
    const lfk = forwardKinematics(left, restPose(left));
    const lIndex = inHand('left', pointInRoot(lfk, lt.index!.link, lt.index!.point));
    const lMiddle = inHand('left', pointInRoot(lfk, lt.middle!.link, lt.middle!.point));
    const lThumb = inHand('left', pointInRoot(lfk, lt.thumb!.link, lt.thumb!.point));
    expect(lIndex.x).toBeGreaterThan(lMiddle.x);
    expect(Math.abs(lThumb.x)).toBeLessThan(0.1);
    expect(lThumb.y).toBeLessThan(-0.5);
  });

  it('keeps the robot about as long as the skinned human hand', () => {
    const { tips } = linkShapes(right);
    const fk = forwardKinematics(right, restPose(right));
    const tip = inHand('right', pointInRoot(fk, tips.middle!.link, tips.middle!.point));
    expect(Math.abs(tip.z)).toBeGreaterThan(1.5);
    expect(Math.abs(tip.z)).toBeLessThan(2.1);
    expect(new Matrix4().identity().determinant()).toBe(1);
  });
});

describe('mock retarget, a port of core/robot.py', () => {
  it('reads the flexion sign off the limit range, as the core does', () => {
    expect(autoSign(0, 1.57)).toBe(1);
    expect(autoSign(-1.57, 0)).toBe(-1);
    expect(autoSign(-1.0472, 1.0472)).toBe(1);
  });

  it('a flat hand gives near-zero joints, full fidelity for the thumb and two thirds for index and middle', () => {
    const t = retargetHand(handWith({}), limits.right);
    for (const name of ['right_hand_index_0_joint', 'right_hand_index_1_joint', 'right_hand_middle_0_joint', 'right_hand_thumb_1_joint', 'right_hand_thumb_0_joint']) {
      expect(Math.abs(t.q[name])).toBeLessThan(0.05);
    }
    expect(t.missing).toEqual(['ring', 'little']);
    expect(Object.keys(t.fidelity).sort()).toEqual(['index', 'middle', 'thumb']);
    expect(t.fidelity.index).toBeCloseTo(2 / 3, 3);
    expect(t.fidelity.thumb).toBe(1);
  });

  it('pins the weighted sums: 30 degrees per joint gives index_0 at 30 and index_1 at 0.7*30 + 0.5*30', () => {
    const t = retargetHand(handWith({ index: 90, middle: 45 }), limits.right);
    expect(t.q.right_hand_index_0_joint).toBeCloseTo(30 * DEG, 4);
    expect(t.q.right_hand_index_1_joint).toBeCloseTo(36 * DEG, 4);
    expect(t.q.right_hand_middle_0_joint).toBeCloseTo(15 * DEG, 4);
    expect(t.q_norm.right_hand_index_0_joint).toBeCloseTo((30 * DEG) / 1.5708, 2);
  });

  it('clamps a fist at the mirrored limits for left and right and lowers the fidelity by the clipped share', () => {
    const fist = handWith({ thumb: 180, index: 400, middle: 400 });
    const r = retargetHand(fist, limits.right);
    const l = retargetHand({ ...fist, side: 'left' }, limits.left);
    expect(r.q.right_hand_index_0_joint).toBeCloseTo(1.5708, 3);
    expect(l.q.left_hand_index_0_joint).toBeCloseTo(-1.5708, 3);
    expect(r.q.right_hand_index_1_joint).toBeCloseTo(1.74533, 3);
    expect(l.q.left_hand_index_1_joint).toBeCloseTo(-1.74533, 3);
    expect(r.fidelity.index!).toBeLessThan(2 / 3);
    expect(r.fidelity.index!).toBeGreaterThan(0.3);
    for (const v of Object.values(r.q_norm)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('forces the thumb swing sign per side as config.toml does and maps the flat thumb spread to zero', () => {
    const a = angleFeatures(handWith({}));
    expect(a.spread_thumb_index).toBe(40);
    const r = retargetAngles({ ...a, spread_thumb_index: 70 }, 'right', limits.right);
    const l = retargetAngles({ ...a, spread_thumb_index: 70 }, 'left', limits.left);
    expect(r.q.right_hand_thumb_0_joint).toBeCloseTo(-30 * DEG, 4);
    expect(l.q.left_hand_thumb_0_joint).toBeCloseTo(30 * DEG, 4);
  });

  it('describes the robot like hello.robot and builds a robot message from a glove frame', () => {
    const d = describeRobot({ left, right });
    expect(d.model).toBe('dex3_1');
    expect(d.fingers).toEqual(['thumb', 'index', 'middle']);
    expect(d.missing).toEqual(['ring', 'little']);
    expect(d.joints.right).toHaveLength(7);
    expect(d.limits.right.right_hand_index_1_joint[1]).toBeCloseTo(1.74533, 4);
    const frame = { t: 1, source: 'simulator' as const, hands: [handWith({ index: 60 }), { ...handWith({ index: 20 }), side: 'left' as const }] };
    expect(pickHand(frame, 'learner')?.side).toBe('right');
    expect(pickHand(frame, 'master')?.side).toBe('left');
    expect(pickHand(frame, 'off')).toBeNull();
    const msg = robotMessage(frame, 'lesson', limits, 123)!;
    expect(msg.type).toBe('robot');
    expect(msg.hand).toBe('right');
    expect(msg.angles_from).toBe('lesson');
    expect(msg.q.right_hand_index_0_joint).toBeCloseTo(20 * DEG, 4);
    expect(parseRobotIncoming(JSON.stringify(msg))?.type).toBe('robot');
  });
});

describe('robot wire helpers', () => {
  it('parses hello, robot and ack and rejects the rest', () => {
    expect(parseRobotIncoming('{')).toBeNull();
    expect(parseRobotIncoming({ type: 'frame' })).toBeNull();
    expect(parseRobotIncoming({ v: 1, type: 'hello', t: 1, robot: null, session: { robot_source: 'off' } })?.type).toBe('hello');
    expect(parseRobotIncoming({ v: 1, type: 'ack', t: 1, id: 'a', ok: false, error: { code: 'bad_args', message: 'x' } })?.type).toBe('ack');
    expect(parseRobotIncoming({ v: 1, type: 'robot', t: 1, model: 'dex3_1', source: 'off', hand: 'right', q: {}, fidelity: {}, missing: [] })).toBeNull();
    expect(parseRobotIncoming({ v: 1, type: 'robot', t: 1, model: 'dex3_1', source: 'learner', hand: 'right', q: {}, fidelity: {}, missing: [] })?.type).toBe('robot');
  });

  it('labels the sources for the UI without the word master, and shortens joint names', () => {
    expect(SOURCE_OPTIONS.map((o) => o.label)).toEqual(['Expert glove', 'Apprentice glove', 'Lesson', 'Off']);
    expect(SOURCE_OPTIONS.map((o) => o.id)).toEqual(['master', 'learner', 'lesson', 'off']);
    expect(shortJointName('right_hand_index_0_joint')).toBe('index 0');
    expect(shortJointName('left_hand_thumb_2_joint')).toBe('thumb 2');
  });

  it('explains a silent robot from the session roles', () => {
    const session = { roles: { left: 'free', right: 'learner' }, lesson_id: 'fake-demo' };
    expect(handWithRole(session.roles, 'learner')).toBe('right');
    expect(handWithRole(session.roles, 'master')).toBeNull();
    expect(waitingLine('master', session)).toMatch(/No glove plays the expert/);
    expect(waitingLine('learner', session)).toMatch(/apprentice's right glove/);
    expect(waitingLine('lesson', session)).toMatch(/lesson step/);
    expect(waitingLine('lesson', { lesson_id: null })).toMatch(/No lesson is loaded/);
    expect(waitingLine('off', null)).toBe('The robot rests.');
  });
});
