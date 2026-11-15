/**
 * Where the bench sits under a hand whose wrist is at the stage origin. The skinned mesh reaches down to y = -0.67 at rest
 * and to y = -1.04 when a finger presses a key (the five-finger scale, the single press and the card clip all measure
 * -1.04, probed over 14 s of each motion on the mesh itself), so a bench higher than that cuts the pressing fingertips off
 * below the paper. The bench is at that depth: the lowest fingertip just touches it and never goes through, and a resting
 * hand floats clear above it.
 */
export const HAND_FLOOR_Y = -1.05;
/** Height of a key's top line over the bench: the keyboard props rest on it. */
export const KEYBED_Y = HAND_FLOOR_Y + 0.06;
