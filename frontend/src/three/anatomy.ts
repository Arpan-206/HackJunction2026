import type { Finger } from '../api/types';

/**
 * Hand anatomy shared by the motion synthesiser and the rig. The skinned hand's bones and flexion axes live in
 * handPose.ts (measured from the model); this file only holds the curl calibration.
 */

/** Joint angles (radians) at curl 0 per segment, and the extra angle at curl 1. Used to map a 0..1 curl to flexion. */
export const RELAXED: [number, number, number][] = [
  [0.1, 0.18, 0.15],
  [0.28, 0.38, 0.24],
  [0.28, 0.38, 0.24],
  [0.28, 0.38, 0.24],
  [0.3, 0.4, 0.26],
];
export const FULL: [number, number, number][] = [
  [0.75, 0.75, 0.55],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
  [1.15, 1.3, 0.85],
];

/** Finger names in contract order (index 0 is the thumb). */
export const FINGER_ORDER: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
