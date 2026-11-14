import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOGUE, skillUsesHandPosition } from '../src/features/apprentice/skills/catalogue';
import { followsHandPosition, handPositionMode, setHandPositionWanted } from '../src/three/handPosition';

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
