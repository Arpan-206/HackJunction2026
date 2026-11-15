import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/client', () => ({
  api: { devState: vi.fn(), setDevState: vi.fn() },
}));

import { api } from '../src/api/client';
import { ensureNoGloves, noGlovesPref, setNoGloves } from '../src/features/shared/noGloves';
import { shouldOpenGlovesOnStart } from '../src/features/shared/gloves/logic';
import { demoModePref } from '../src/features/shared/settings';
import { mockGloveStatus } from '../src/mock/rig';

afterEach(() => vi.unstubAllGlobals());

const devState = vi.mocked(api.devState);
const setDevState = vi.mocked(api.setDevState);

/** A backend that reports (and follows) a glove source. */
function backendOn(source: string) {
  let current = source;
  devState.mockImplementation(async () => ({ glove_source: current }) as never);
  setDevState.mockImplementation(async (patch) => {
    current = (patch as { glove_source: string }).glove_source;
    return { glove_source: current } as never;
  });
}

beforeEach(() => {
  // The suite runs in node: a Map-backed localStorage stands in for the browser's.
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage });
  noGlovesPref.reset();
  demoModePref.reset();
  devState.mockReset();
  setDevState.mockReset();
});

describe('shouldOpenGlovesOnStart with No gloves', () => {
  it('stays closed even when demo mode or real gloves would open it', () => {
    const real = mockGloveStatus('external', 'ready');
    expect(shouldOpenGlovesOnStart(real, true, false, true)).toBe(false);
    expect(shouldOpenGlovesOnStart(real, false, false, true)).toBe(false);
    expect(shouldOpenGlovesOnStart(real, true, false, false)).toBe(true);
  });
});

describe('setNoGloves', () => {
  it('moves a rokoko_udp backend to the simulator and back', async () => {
    backendOn('rokoko_udp');
    await setNoGloves(true);
    expect(noGlovesPref.get()).toBe(true);
    expect(setDevState).toHaveBeenCalledTimes(1);
    expect(setDevState).toHaveBeenLastCalledWith({ glove_source: 'simulator' });

    await setNoGloves(false);
    expect(noGlovesPref.get()).toBe(false);
    expect(setDevState).toHaveBeenCalledTimes(2);
    expect(setDevState).toHaveBeenLastCalledWith({ glove_source: 'rokoko_udp' });
  });

  it('does not post or restore when the backend already runs the simulator', async () => {
    backendOn('simulator');
    await setNoGloves(true);
    await setNoGloves(false);
    expect(setDevState).not.toHaveBeenCalled();
    expect(noGlovesPref.get()).toBe(false);
  });

  it('does not restore a source when the backend was moved off the simulator meanwhile', async () => {
    backendOn('rokoko_udp');
    await setNoGloves(true);
    setDevState.mockClear();
    devState.mockImplementation(async () => ({ glove_source: 'external' }) as never);
    await setNoGloves(false);
    expect(setDevState).not.toHaveBeenCalled();
  });

  it('turns demo mode off while on and restores it after', async () => {
    backendOn('simulator');
    demoModePref.set(true);
    await setNoGloves(true);
    expect(demoModePref.get()).toBe(false);
    await setNoGloves(false);
    expect(demoModePref.get()).toBe(true);
  });

  it('leaves demo mode off when it was off before', async () => {
    backendOn('simulator');
    await setNoGloves(true);
    await setNoGloves(false);
    expect(demoModePref.get()).toBe(false);
  });

  it('does not throw when reading the backend fails, and the flag still flips', async () => {
    devState.mockRejectedValue(new Error('down'));
    await expect(setNoGloves(true)).resolves.toBe(false);
    expect(noGlovesPref.get()).toBe(true);
    expect(setDevState).not.toHaveBeenCalled();
    await expect(setNoGloves(false)).resolves.toBe(true);
    expect(noGlovesPref.get()).toBe(false);
  });

  it('does not throw when posting fails, and the flag still flips both ways', async () => {
    devState.mockResolvedValue({ glove_source: 'rokoko_udp' } as never);
    setDevState.mockRejectedValue(new Error('refused'));
    await expect(setNoGloves(true)).resolves.toBe(false);
    expect(noGlovesPref.get()).toBe(true);

    devState.mockResolvedValue({ glove_source: 'simulator' } as never);
    await expect(setNoGloves(false)).resolves.toBe(true);
    expect(noGlovesPref.get()).toBe(false);
  });

  it('is a no-op when called with the current value', async () => {
    backendOn('rokoko_udp');
    await setNoGloves(false);
    expect(devState).not.toHaveBeenCalled();
    expect(setDevState).not.toHaveBeenCalled();

    await setNoGloves(true);
    devState.mockClear();
    setDevState.mockClear();
    await setNoGloves(true);
    expect(devState).not.toHaveBeenCalled();
    expect(setDevState).not.toHaveBeenCalled();
  });

  it('persists the flag in localStorage and clears it when off', async () => {
    backendOn('simulator');
    await setNoGloves(true);
    expect(window.localStorage.getItem('apprentice.noGloves')).toBe('1');
    await setNoGloves(false);
    expect(window.localStorage.getItem('apprentice.noGloves')).toBeNull();
    expect(window.localStorage.getItem('apprentice.noGloves.before')).toBeNull();
  });
});

describe('ensureNoGloves', () => {
  it('does nothing while the flag is off', () => {
    backendOn('rokoko_udp');
    ensureNoGloves();
    expect(devState).not.toHaveBeenCalled();
  });

  it('re-applies the simulator when the flag is on and the backend is not on it', async () => {
    backendOn('rokoko_udp');
    noGlovesPref.set(true);
    ensureNoGloves();
    await vi.waitFor(() => expect(setDevState).toHaveBeenCalledWith({ glove_source: 'simulator' }));
  });
});
