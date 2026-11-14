import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { LAMP_POS, layoutFor, projectToWall, PUPPET_Z, puppetLayout, raiseFor, WALL_Z, wallMagnification } from '../src/three/ShadowTheatre';
import { shapeName } from '../src/features/apprentice/training/modes/ShadowPuppets';

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
