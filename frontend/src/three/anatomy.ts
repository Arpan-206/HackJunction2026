import type { Finger } from '../api/types';

/**
 * Hand anatomy shared by the rig builder and the motion synthesiser.
 * Right hand, palm down, fingers along -z, y up, thumb towards -x. Units are arbitrary scene units (about 1 per 9 cm).
 */

export interface FingerSpec {
  name: Finger;
  base: [number, number, number];
  yaw: number;
  roll: number;
  /** Phalanx lengths: proximal, middle, distal. */
  lens: [number, number, number];
  /** Phalanx radii. */
  rad: [number, number, number];
  /** +1 spreads towards -x (thumb side), -1 towards +x, 0 never moves. */
  spreadDir: number;
}

export const FINGER_SPECS: FingerSpec[] = [
  { name: 'thumb', base: [-0.4, -0.04, -0.3], yaw: 0.78, roll: -0.35, lens: [0.3, 0.25, 0.21], rad: [0.1, 0.092, 0.084], spreadDir: 1 },
  { name: 'index', base: [-0.285, 0.0, -1.0], yaw: 0.05, roll: 0, lens: [0.42, 0.26, 0.2], rad: [0.079, 0.074, 0.069], spreadDir: 1 },
  { name: 'middle', base: [-0.095, 0.012, -1.04], yaw: 0.0, roll: 0, lens: [0.46, 0.3, 0.22], rad: [0.082, 0.077, 0.071], spreadDir: 0 },
  { name: 'ring', base: [0.095, 0.0, -1.0], yaw: -0.04, roll: 0, lens: [0.43, 0.28, 0.21], rad: [0.078, 0.073, 0.067], spreadDir: -1 },
  { name: 'little', base: [0.275, -0.02, -0.91], yaw: -0.11, roll: 0, lens: [0.33, 0.21, 0.18], rad: [0.069, 0.064, 0.06], spreadDir: -1 },
];

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

/** Palm and wrist dimensions shared by the geometry builders. */
export const PALM = {
  zWrist: 0.16,
  zKnuckle: -1.02,
};
