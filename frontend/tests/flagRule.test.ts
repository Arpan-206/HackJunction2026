import { describe, expect, it } from 'vitest';
import { FINGERS, type Finger } from '../src/api/types';
import {
  applyDeadZone, flaggedFinger, fingerMatch, MATCH_IN_LINE, matchMeter, meterOff, statusOf, type FlagSnapshot, type FingerStatus,
} from '../src/features/apprentice/training/coach/deviation';
import { vals } from './helpers';

const TOL = 18;
const DEAD = 4;

/** Builds a snapshot the way the coach does: dead zone, then statusOf per finger. */
function snapOf(raw: Partial<Record<Finger, number>>): FlagSnapshot {
  const deviation = vals(Object.fromEntries(Object.entries(raw).map(([f, v]) => [f, applyDeadZone(v as number, DEAD)])));
  const status = {} as Record<Finger, FingerStatus>;
  for (const f of FINGERS) status[f] = statusOf(deviation[f], TOL);
  return { status, deviation };
}

describe('shared flag rule (stage label and match meter)', () => {
  it('names no finger and keeps the meter green while every finger is inside the tolerance', () => {
    // 22 raw degrees is 18 after the dead zone: exactly at the edge, still in line.
    const snap = snapOf({ ring: 22, index: -10 });
    expect(flaggedFinger(snap)).toBeNull();
    expect(meterOff(snap)).toBe(false);
    expect(Math.floor(matchMeter(snap.deviation, TOL))).toBe(MATCH_IN_LINE);
  });

  it('flags a finger just past the tolerance and turns the meter vermilion below the in-line mark in the same snapshot', () => {
    const snap = snapOf({ ring: 22.2 });
    expect(flaggedFinger(snap)).toBe('ring');
    expect(meterOff(snap)).toBe(true);
    expect(Math.floor(matchMeter(snap.deviation, TOL))).toBeLessThan(MATCH_IN_LINE);
  });

  it('picks the off finger with the largest deviation', () => {
    expect(flaggedFinger(snapOf({ index: 30, little: -50, thumb: 10 }))).toBe('little');
  });

  it('respects the attempt focus for the label, while the meter still reports any off finger', () => {
    const snap = snapOf({ little: -50, ring: 30 });
    expect(flaggedFinger(snap, ['ring'])).toBe('ring');
    expect(flaggedFinger(snap, ['thumb'])).toBeNull();
    expect(meterOff(snap)).toBe(true);
  });

  it('whenever a label shows, the meter is off and reads under the in-line mark (sweep)', () => {
    for (let d = -60; d <= 60; d += 0.25) {
      for (const f of FINGERS) {
        const snap = snapOf({ [f]: d });
        const flagged = flaggedFinger(snap) !== null;
        expect(meterOff(snap)).toBe(flagged);
        expect(fingerMatch(snap.deviation[f], TOL) < MATCH_IN_LINE).toBe(flagged);
      }
    }
  });
});
