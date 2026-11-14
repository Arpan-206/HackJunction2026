import type { Finger, HandFrame } from '../src/api/types';
import { FINGERS } from '../src/api/types';

export const DEG = Math.PI / 180;

/** A hand whose fingers each have the given total flexion in degrees (split evenly over three joints). */
export function handWith(totalDeg: Partial<Record<Finger, number>> = {}, quat: [number, number, number, number] = [0, 0, 0, 1]): HandFrame {
  const flexion = {} as HandFrame['flexion'];
  for (const f of FINGERS) {
    const r = ((totalDeg[f] ?? 0) * DEG) / 3;
    flexion[f] = [r, r, r];
  }
  return { side: 'right', wrist_quat: quat, wrist_pos: null, flexion };
}

export function vals(v: Partial<Record<Finger, number>> = {}): Record<Finger, number> {
  return { thumb: 0, index: 0, middle: 0, ring: 0, little: 0, ...v };
}
