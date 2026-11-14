import { Group, Matrix4, Skeleton, SkinnedMesh, type Bone, type Object3D, type Vector3 } from 'three';
import type { Finger, Side } from '../api/types';
import type { StageColors } from '../theme/themes';
import { FINGER_ORDER } from './anatomy';
import { applyDualQuaternionBoneTransform, installDualQuaternionSkinning, skinWithDualQuaternions } from './dqSkinning';
import type { HandTemplate } from './handModel';
import { applyHandPose, applyJointPose, createBones, THUMB_TUNING } from './handPose';
import { createHandMaterials, type HandMaterialSet, type HandStyle } from './materials';
import { addRobotJoints } from './robotHandParts';
import type { HandSmoother } from './smoothing';

export interface FingerRig {
  name: Finger;
  /** The knuckle bone (the CMC for the thumb); the same object as joints[0]. */
  base: Object3D;
  /** MCP, PIP, DIP bones (CMC, MCP, IP for the thumb), in hand space at scale 1. */
  joints: [Object3D, Object3D, Object3D];
  /** Bone at the fingertip, for trails, key presses and leader lines. */
  tip: Object3D;
}

export interface HandRig {
  /** Mirrored for left hands. Add props (racket) as children. */
  root: Group;
  fingers: FingerRig[];
  style: HandStyle;
  materials: HandMaterialSet;
  /** The skinned skin itself. */
  mesh: SkinnedMesh;
  bones: Bone[];
  /** A point on the back of the wrist in root space, for leader lines. */
  wristBack: Vector3;
  template: HandTemplate;
  /** Tints one finger (null restores the base colour). Cheap; call from effects, not per frame. */
  setFingerTint: (finger: Finger, color: string | null) => void;
  dispose: () => void;
}

const IDENTITY = new Matrix4();

installDualQuaternionSkinning();

/**
 * Builds one hand instance from the shared template: its own bones and skeleton, the skinned mesh and, for inked
 * styles, an outline hull bound to the same skeleton. Geometry is shared; materials and the skeleton are owned.
 */
export function buildHandRig(template: HandTemplate, style: HandStyle, stage: StageColors, side: Side, tint?: string): HandRig {
  const mats = createHandMaterials(style, stage, tint);
  const root = new Group();
  if (side === 'left') root.scale.x = -1;

  const bones = createBones(template.layout, root);
  const skeleton = new Skeleton(
    bones,
    template.layout.bones.map((b) => b.inverse.clone()),
  );
  const skin = (material: HandMaterialSet['fill']) => {
    const m = new SkinnedMesh(template.geometry, material);
    m.bind(skeleton, IDENTITY);
    // Bones move the surface far from its bind bounds, and the hand is always on stage anyway.
    m.frustumCulled = false;
    applyDualQuaternionBoneTransform(m);
    root.add(m);
    return m;
  };
  if (mats.prepass) {
    // Added before the fill: same position, so the transparent sort keeps it immediately ahead of the fill.
    const depth = skin(mats.prepass);
    depth.userData.noCast = true;
  }
  const mesh = skin(mats.fill);
  skinWithDualQuaternions(skeleton, mesh);
  if (mats.line) {
    const hull = skin(mats.line);
    hull.userData.noCast = true;
    hull.renderOrder = -1;
  }

  const fingers: FingerRig[] = template.layout.fingers.map((f, i) => {
    const joints = f.joints.map((j) => bones[j.bone]) as [Bone, Bone, Bone];
    return { name: FINGER_ORDER[i], base: joints[0], joints, tip: bones[f.tip] };
  });
  const parts = style === 'robot' && mats.accent ? addRobotJoints(fingers, mats.accent) : [];

  return {
    root,
    fingers,
    style,
    materials: mats,
    mesh,
    bones,
    wristBack: template.wristBack.clone(),
    template,
    setFingerTint: mats.setTint,
    dispose() {
      parts.forEach((p) => p.removeFromParent());
      mats.dispose();
      skeleton.dispose();
    },
  };
}

/**
 * Writes a smoothed pose onto the rig's bones: the angles, then, while the core's skeleton is on hand for this hand, every
 * phalanx from its joint positions (blended in by the smoother's jointWeight). Pure mutation, no allocation.
 */
export function applyPose(rig: HandRig, s: HandSmoother): void {
  applyHandPose(rig.bones, rig.template.layout, s.flex, s.spread, THUMB_TUNING, s.coreAngles);
  if (s.jointWeight > 0) applyJointPose(rig.bones, rig.template.layout, s.joints, s.jointWeight);
}
