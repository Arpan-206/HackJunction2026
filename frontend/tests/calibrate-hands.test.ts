import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Calibration } from '../src/api/types';

const heading = vi.fn(() => Promise.resolve(true));
const calibrate = vi.fn();
const latestCalibration = vi.fn();

vi.mock('../src/api/coreCommand', () => ({ calibrateCoreHeading: () => heading() }));
vi.mock('../src/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/api')>();
  return { ...real, api: { ...real.api, calibrate: (...a: unknown[]) => calibrate(...a), latestCalibration: (...a: unknown[]) => latestCalibration(...a) } };
});

const { calibrationLine, lessonHands } = await import('../src/features/shared/CalibrateHands');
const { AIM_HOLD_MS, AIM_LEAD_MS, useCalibration } = await import('../src/features/shared/useCalibration');
const { renderHook } = await import('./hookRenderer');

const cal = (phase: 'flat' | 'fist'): Calibration => ({ id: `c-${phase}`, side: 'right', created_at: '2026-11-15T03:00:00Z' }) as unknown as Calibration;
const step = (hands: 'left' | 'right' | 'both') => ({ hands }) as never;

describe('lessonHands', () => {
  it('is the one hand every step names', () => {
    expect(lessonHands({ steps: [step('right'), step('right')], test: null } as never)).toBe('right');
    expect(lessonHands({ steps: [step('left')], test: null } as never)).toBe('left');
  });
  it('is both for a two-handed step, mixed hands or the typing test', () => {
    expect(lessonHands({ steps: [step('right'), step('both')], test: null } as never)).toBe('both');
    expect(lessonHands({ steps: [step('left'), step('right')], test: null } as never)).toBe('both');
    expect(lessonHands({ steps: [step('right')], test: { kind: 'air_typing' } } as never)).toBe('both');
  });
});

describe('calibrationLine', () => {
  it('names the hand still missing', () => {
    expect(calibrationLine('right', { left: false, right: false })).toBe('Calibrate your right hand');
    expect(calibrationLine('right', { left: false, right: true })).toBe('Hand calibrated');
    expect(calibrationLine('both', { left: false, right: false })).toBe('Calibrate your hands');
    expect(calibrationLine('both', { left: false, right: true })).toBe('Calibrate your left hand');
    expect(calibrationLine('both', { left: true, right: true })).toBe('Hands calibrated');
  });
});

describe('useCalibration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    heading.mockClear();
    calibrate.mockReset();
    latestCalibration.mockReset();
    latestCalibration.mockRejectedValue(Object.assign(new Error('none'), { status: 404 }));
    calibrate.mockImplementation((body: { phase: 'flat' | 'fist' }) => Promise.resolve(cal(body.phase)));
  });
  afterEach(() => vi.useRealTimers());

  it('tells the core to calibrate only after the flat and fist are saved, with the hand flat again', async () => {
    const h = renderHook(() => useCalibration('right'));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.result().latest).toBeNull();

    h.result().start();
    h.rerender();
    expect(h.result().phase).toBe('countdown-flat');
    h.result().countdownDone();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.result().phase).toBe('countdown-fist');
    expect(heading).not.toHaveBeenCalled();

    h.result().countdownDone();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.result().phase).toBe('aim');
    expect(h.result().latest?.id).toBe('c-fist');
    expect(calibrate.mock.calls.map((c) => (c[0] as { phase: string }).phase)).toEqual(['flat', 'fist']);
    expect(heading).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(AIM_LEAD_MS);
    expect(heading).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(AIM_HOLD_MS);
    expect(h.result().phase).toBe('idle');
    h.unmount();
  });

  it('cancel during the last step never reaches the core', async () => {
    const h = renderHook(() => useCalibration('right'));
    await vi.advanceTimersByTimeAsync(0);
    h.result().start();
    h.rerender();
    h.result().countdownDone();
    await vi.advanceTimersByTimeAsync(0);
    h.result().countdownDone();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.result().phase).toBe('aim');
    h.result().cancel();
    await vi.advanceTimersByTimeAsync(AIM_LEAD_MS + AIM_HOLD_MS);
    expect(heading).not.toHaveBeenCalled();
    expect(h.result().phase).toBe('idle');
    h.unmount();
  });
});
