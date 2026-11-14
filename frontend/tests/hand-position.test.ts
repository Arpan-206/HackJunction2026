import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGUE, skillUsesHandPosition } from '../src/features/apprentice/skills/catalogue';
import { followsHandPosition, handCentre, handPositionMode, recentreHandPosition, resetHandCentres, setHandPositionWanted } from '../src/three/handPosition';

describe('hand position from the phone, per skill', () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null } });
  });
  afterEach(() => {
    setHandPositionWanted(false);
    vi.unstubAllGlobals();
  });

  it('is on for table tennis only', () => {
    expect(skillUsesHandPosition('table_tennis')).toBe(true);
    for (const c of CATALOGUE) if (c.id !== 'table_tennis') expect(skillUsesHandPosition(c.id)).toBe(false);
    expect(skillUsesHandPosition('general')).toBe(false);
  });

  it('is off until a screen asks for it', () => {
    expect(handPositionMode()).toBe('auto');
    expect(followsHandPosition()).toBe(false);
    setHandPositionWanted(true);
    expect(followsHandPosition()).toBe(true);
  });

  it('obeys the override', () => {
    store.set('apprentice.handPosition', 'on');
    expect(followsHandPosition()).toBe(true);
    setHandPositionWanted(true);
    store.set('apprentice.handPosition', 'off');
    expect(followsHandPosition()).toBe(false);
  });
});

describe('recentre the hand without calibrating', () => {
  const REST: [number, number, number] = [0.15, 0.1, -0.2];
  afterEach(() => resetHandCentres());

  it('measures from the rest pose until the learner recentres', () => {
    expect(handCentre('right', [0.4, 0.2, -0.1], REST, 1000)).toEqual(REST);
  });

  it('makes where the hand is now its centre, and keeps it after the press', () => {
    recentreHandPosition(1000);
    expect(handCentre('right', [0.4, 0.2, -0.1], REST, 1010)).toEqual([0.4, 0.2, -0.1]);
    // the hand moves on from its new centre; the centre itself stays put
    expect(handCentre('right', [0.5, 0.2, -0.1], REST, 1020)).toEqual([0.4, 0.2, -0.1]);
    expect(handCentre('right', [0.0, 0.0, 0.0], REST, 9000)).toEqual([0.4, 0.2, -0.1]);
  });

  it('recentres each side on its own, and only a side seen soon after the press', () => {
    recentreHandPosition(1000);
    expect(handCentre('left', [-0.3, 0.1, -0.2], [-0.15, 0.1, -0.2], 1100)).toEqual([-0.3, 0.1, -0.2]);
    // the right hand turns up after the window: it keeps the rest pose
    expect(handCentre('right', [0.4, 0.2, -0.1], REST, 2500)).toEqual(REST);
  });

  it('a second press takes the new position', () => {
    recentreHandPosition(1000);
    handCentre('right', [0.4, 0.2, -0.1], REST, 1010);
    recentreHandPosition(5000);
    expect(handCentre('right', [0.1, 0.1, -0.3], REST, 5010)).toEqual([0.1, 0.1, -0.3]);
  });
});
