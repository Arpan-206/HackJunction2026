/**
 * Where the keys of a QWERTY keyboard lie on the bench, in scene units, sized to the hand model: a key pitch of 0.28 is the
 * spacing of the fingertips in the hover pose, so with the index fingers on F and J every finger sits over its home key.
 * Pure numbers, no three.js, so the layout is unit tested.
 */

export const KEY_PITCH = 0.28;
/** Depth (z) of the home row's key centres. Fingertips hover here; the hand's knuckles are towards +z. */
export const HOME_Z = -1.52;
/** Bench height under the keyboard, matching the stage's keyboard preset. */
export const BENCH_Y = -0.55;
/** Top of a solid keycap. */
export const KEYTOP_Y = -0.47;

/** The three letter rows and their stagger as on a real keyboard: Q a quarter key left of A, Z half a key right. */
export const TYPING_ROWS: { keys: string; dx: number; row: number }[] = [
  { keys: 'qwertyuiop', dx: -0.25, row: -1 },
  { keys: "asdfghjkl;'", dx: 0, row: 0 },
  { keys: 'zxcvbnm,./', dx: 0.5, row: 1 },
];
/** The space bar: centred under B, five and a half keys wide, a row below Z. */
export const SPACE = { x: 0.25 * KEY_PITCH, z: HOME_Z + 2 * KEY_PITCH, width: 5.5 * KEY_PITCH };

/** Centre (x, z) of a key on the bench, or null for a key not drawn. G and H straddle x = 0. */
export function keyCenter(key: string): [number, number] | null {
  if (key === ' ') return [SPACE.x, SPACE.z];
  const k = key.toLowerCase();
  for (const r of TYPING_ROWS) {
    const i = r.keys.indexOf(k);
    if (i >= 0) return [(i - 4.5 + r.dx) * KEY_PITCH, HOME_Z + r.row * KEY_PITCH];
  }
  return null;
}

/** Index fingertip of the hover pose, relative to the hand origin, measured from the hand model (tests/typingLayout.test.ts). */
export const INDEX_TIP_X = -0.35;
/** Each hand's origin: the index fingertip over F (left, mirrored) or J (right), lifted so the hover pose clears the keys. */
export const TYPING_HAND_X = 1.5 * KEY_PITCH - INDEX_TIP_X;
export const TYPING_HAND_Y = 0.26;
/** Extent of everything drawn, for the camera and the chalk canvas. */
export const KEYBOARD_BOUNDS = { x0: -5.6 * KEY_PITCH, x1: 5.9 * KEY_PITCH, z0: HOME_Z - 1.6 * KEY_PITCH, z1: HOME_Z + 2.6 * KEY_PITCH };
