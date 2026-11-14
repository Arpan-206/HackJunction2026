import { Mesh, SphereGeometry, type Material, type Object3D } from 'three';

/**
 * Ball joint radius at each finger joint, in hand space at scale 1: knuckle (MCP, or CMC for the thumb), middle (PIP,
 * or MCP), end (DIP, or IP). Slightly wider than the finger there, so each joint shows as a bronze dome on both sides
 * of the steel, as on a jointed mannequin or a tendon-driven robot hand.
 */
export const ROBOT_JOINT_RADII: readonly [number, number, number] = [0.108, 0.092, 0.078];
/** Ball joints on the thumb read best a touch larger: its base sits deep in the palm. */
export const ROBOT_THUMB_SCALE = 1.08;

const geometry = new SphereGeometry(1, 20, 14);

/**
 * Adds a bronze ball joint to every finger joint bone of a robot-style hand. The balls are children of the bones, so
 * they follow the pose with no per-frame work. Returns the meshes so the rig can drop them on dispose (the geometry
 * is shared by every robot hand and never disposed; the material belongs to the hand's material set).
 */
export function addRobotJoints(fingers: readonly { name: string; joints: readonly Object3D[] }[], material: Material): Mesh[] {
  const added: Mesh[] = [];
  for (const f of fingers) {
    const k = f.name === 'thumb' ? ROBOT_THUMB_SCALE : 1;
    f.joints.forEach((bone, i) => {
      const ball = new Mesh(geometry, material);
      ball.scale.setScalar(ROBOT_JOINT_RADII[i] * k);
      ball.castShadow = true;
      ball.userData.robotJoint = true;
      bone.add(ball);
      added.push(ball);
    });
  }
  return added;
}
