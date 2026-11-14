/** Framing for the robot twin's camera. Pure, so it is unit tested without WebGL. */

export type Vec3 = [number, number, number];

export const TWIN_TARGET: Vec3 = [0.1, 0.25, -0.8];
export const TWIN_CAMERA: Vec3 = [1.9, 3.7, 5.6];
/** Width over height the camera above frames both hands for; a narrower pane pulls the camera back to fit them. */
export const DESIGN_ASPECT = 1.4;
export const MAX_PULL = 2.4;

/** The camera for a pane of this aspect: the same view, moved back along its line of sight until both hands fit. */
export function twinCamera(aspect: number): Vec3 {
  // A power under 1: a tall pane may crop the hands' outer edges a little, which beats two tiny hands.
  const k = Math.min(MAX_PULL, Math.max(1, (DESIGN_ASPECT / Math.max(0.1, aspect)) ** 0.8));
  return [0, 1, 2].map((i) => TWIN_TARGET[i] + (TWIN_CAMERA[i] - TWIN_TARGET[i]) * k) as Vec3;
}
