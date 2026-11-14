import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Group, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MotionSpec, Side } from '../src/api/types';
import { FINGER_ORDER } from '../src/three/anatomy';
import { buildHandTemplate, type HandTemplate } from '../src/three/handModel';
import { applyHandPose, createBones } from '../src/three/handPose';
import { synthFrame } from '../src/three/motion';
import {
  LAMP_POS,
  layoutFor,
  projectToWall,
  PUPPET_X,
  PUPPET_Y,
  PUPPET_Z,
  puppetLayout,
  raiseFor,
  WALL_VIEW,
  WALL_Z,
  wallMagnification,
  type HandPlacement,
} from '../src/three/ShadowTheatre';
import { shapeName } from '../src/features/apprentice/training/modes/ShadowPuppets';
import seed from '../src/mock/data/seed-shadow-puppets.json';

describe('shadow theatre', () => {
  it('projects a point from the lamp onto the wall, magnified', () => {
    const p = new Vector3(0.5, 0.3, PUPPET_Z);
    const onWall = projectToWall(p, new Vector3());
    const k = wallMagnification(PUPPET_Z);
    expect(k).toBeGreaterThan(2.5);
    expect(onWall.z).toBeCloseTo(WALL_Z + 0.02);
    expect(onWall.x).toBeCloseTo(LAMP_POS[0] + 0.5 * k);
    expect(onWall.y).toBeCloseTo(LAMP_POS[1] + (0.3 - LAMP_POS[1]) * k);
  });

  it('a point on the lamp-to-wall axis stays on it', () => {
    const onWall = projectToWall(new Vector3(LAMP_POS[0], LAMP_POS[1], 0), new Vector3());
    expect(onWall.x).toBeCloseTo(LAMP_POS[0]);
    expect(onWall.y).toBeCloseTo(LAMP_POS[1]);
  });

  it('lays out one hand, wings for two hands, and the snail by name', () => {
    expect(layoutFor('sp_rabbit', 'right')).toBe('right');
    expect(layoutFor(null, 'left')).toBe('left');
    expect(layoutFor('sp_flapping_bird', 'both')).toBe('wings');
    expect(layoutFor('cr_chain', 'both')).toBe('wings');
    expect(layoutFor('sp_snail', 'both')).toBe('snail');
    expect(puppetLayout('right').map((p) => p.side)).toEqual(['right']);
    expect(puppetLayout('wings').map((p) => p.side).sort()).toEqual(['left', 'right']);
    expect(puppetLayout('snail').map((p) => p.side).sort()).toEqual(['left', 'right']);
  });

  it('raises the swan higher than the rabbit, and the dog lowest', () => {
    expect(raiseFor('sp_swan')).toBeGreaterThan(raiseFor('sp_rabbit'));
    expect(raiseFor('sp_talking_dog')).toBeLessThan(raiseFor('sp_rabbit'));
    expect(puppetLayout('right', 0.4, raiseFor('sp_swan'))[0].tilt).toBeCloseTo(-raiseFor('sp_swan'));
  });

  it('names the shape from the lesson title', () => {
    expect(shapeName({ title: 'Lesson 2: The talking dog' })).toBe('The talking dog');
    expect(shapeName({ title: 'The swan' })).toBe('The swan');
  });
});

type SeedStep = (typeof seed.steps)[number];

/* The five seeded shapes, posed on the skinned hand exactly as the theatre places them, projected onto the wall. */
describe('shadow theatre framing', () => {
  let tpl: HandTemplate;
  beforeAll(async () => {
    const buf = fs.readFileSync(path.resolve(__dirname, '../public/models/hands/right.glb'));
    const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
    tpl = buildHandTemplate(gltf.scene);
  });

  /** Wall positions of every knuckle and fingertip, the tips alone, and the wrist, for one placed hand at time t. */
  function shadowOf(step: SeedStep, p: HandPlacement, x: number, t: number) {
    const caster = new Group();
    caster.position.set(x, PUPPET_Y, PUPPET_Z);
    const tilt = new Group();
    tilt.rotation.set(0, 0, p.tilt);
    const outer = new Group();
    outer.position.set(...p.position);
    outer.rotation.set(...p.rotation);
    outer.scale.setScalar(p.scale);
    const inner = new Group();
    const root = new Group();
    if (p.side === 'left') root.scale.x = -1;
    caster.add(tilt);
    tilt.add(outer);
    outer.add(inner);
    inner.add(root);
    const bones = createBones(tpl.layout, root);
    const f = synthFrame(step.motion as MotionSpec, t, p.side);
    inner.quaternion.set(...f.wrist_quat);
    applyHandPose(bones, tpl.layout, FINGER_ORDER.flatMap((n) => f.flexion[n]), [0, 0, 0, 0, 0]);
    caster.updateMatrixWorld(true);
    const wall = (v: Vector3) => projectToWall(v, new Vector3());
    return {
      points: tpl.layout.fingers.flatMap((fd) => [fd.tip, fd.joints[0].bone].map((b) => wall(bones[b].getWorldPosition(new Vector3())))),
      tips: tpl.layout.fingers.map((fd) => wall(bones[fd.tip].getWorldPosition(new Vector3()))),
      wrist: wall(root.localToWorld(tpl.wristBack.clone())),
    };
  }

  const placementsOf = (step: SeedStep) => puppetLayout(layoutFor(step.move_id, step.hands as Side | 'both'), undefined, raiseFor(step.move_id));

  it.each(seed.steps.map((s) => [s.move_id, s] as const))('%s stays on the wall, below the name, for the whole rep', (_id, step) => {
    for (const x of [-PUPPET_X, PUPPET_X]) {
      for (let t = 0; t < 2.4; t += 0.1) {
        for (const p of placementsOf(step)) {
          for (const v of shadowOf(step, p, x, t).points) {
            expect(v.y).toBeLessThan(WALL_VIEW.top);
            expect(v.y).toBeGreaterThan(WALL_VIEW.bottom);
            expect(v.x).toBeGreaterThan(WALL_VIEW.left);
            expect(v.x).toBeLessThan(WALL_VIEW.right);
          }
        }
      }
    }
  });

  it("keeps the expert's shadow and the learner's apart", () => {
    for (const step of seed.steps) {
      for (let t = 0; t < 2.4; t += 0.2) {
        const xs = (x: number) => placementsOf(step).flatMap((p) => shadowOf(step, p, x, t).points.map((v) => v.x));
        expect(Math.max(...xs(-PUPPET_X))).toBeLessThan(Math.min(...xs(PUPPET_X)));
      }
    }
  });

  it("stands the rabbit's ears and the swan's neck up", () => {
    const at = (id: string) => {
      const step = seed.steps.find((s) => s.move_id === id)!;
      return shadowOf(step, placementsOf(step)[0], PUPPET_X, 0);
    };
    const rabbit = at('sp_rabbit');
    // Index and middle tips (the ears) well above the wrist and above the curled ring and little finger.
    for (const ear of [rabbit.tips[1], rabbit.tips[2]]) {
      expect(ear.y - rabbit.wrist.y).toBeGreaterThan(1.5);
      expect(ear.y).toBeGreaterThan(Math.max(rabbit.tips[3].y, rabbit.tips[4].y) + 1);
    }
    const swan = at('sp_swan');
    // The neck (wrist to the head) rises at more than 45 degrees; the dog's jaw, by contrast, lies near level.
    const head = swan.tips[2];
    expect(Math.atan2(head.y - swan.wrist.y, Math.abs(head.x - swan.wrist.x))).toBeGreaterThan(Math.PI / 4);
  });
});
