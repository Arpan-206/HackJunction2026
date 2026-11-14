import { Bone, Matrix4, Quaternion, Vector3, type Object3D } from 'three';

/**
 * Bone layout and pose maths for the skinned hand (joints named as in the WebXR hand). Pure: no WebGL, no loading, so the
 * flexion mapping is unit tested against the real model.
 *
 * Hand space: right hand, palm down, fingers along -z, y up (back of the hand), thumb towards -x. Flexion angles come
 * from the contract (radians, 0 straight): fingers MCP, PIP, DIP; thumb CMC, MCP, IP.
 */

/** WebXR joint names of each chain from its root to the tip, in contract finger order (thumb first). */
export const CHAINS: readonly (readonly string[])[] = [
  ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  ...['index', 'middle', 'ring', 'pinky'].map((f) => [
    `${f}-finger-metacarpal`,
    `${f}-finger-phalanx-proximal`,
    `${f}-finger-phalanx-intermediate`,
    `${f}-finger-phalanx-distal`,
    `${f}-finger-tip`,
  ]),
];

export const WRIST = 'wrist';

/** Index into each chain of the three bones the contract's flexion triple drives. */
export const DRIVEN: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [1, 2, 3],
  [1, 2, 3],
  [1, 2, 3],
  [1, 2, 3],
];

/** +1 spreads towards the thumb side, -1 towards the little finger, 0 never moves (the contract: away from the middle). */
export const SPREAD_DIR = [1, 1, 0, -1, -1] as const;

/** The thumb's CMC flexion that the model's bind pose shows: the relaxed value of the curl table in anatomy.ts. */
export const THUMB_CMC_REST = 0.1;
export interface ThumbTuning {
  /**
   * Swing of the thumb metacarpal per radian of contract CMC flexion. The CMC is a saddle joint whose opposition swing
   * is larger than the flexion a glove reports for it, so the reported angle is scaled up.
   */
  opposition: number;
  /** Pronation of the thumb metacarpal per radian of swing, so the thumb pad turns to face the finger pads. */
  roll: number;
  /** Scale of the thumb's MCP and IP flexion about the bind pose. */
  curl: number;
}

export const THUMB_TUNING: ThumbTuning = { opposition: 0.5, roll: 0.15, curl: 0.9 };
/**
 * Where a flexing thumb heads, in palm widths from the palm centre along the palm's distal, palmar and radial axes: in
 * front of the palm, over the middle phalanges of the index and middle fingers, which is where it lies in a fist and
 * where it meets the index in a pinch.
 */
export const THUMB_TARGET = { distal: 0.6, palmar: 0.8, radial: -0.15 };
/**
 * Visual limit on a finger's total flexion (MCP + PIP + DIP, radians): beyond `knee` the extra curl is compressed so the
 * total never passes knee + range, which is where this model's fingertips meet its palm in a fist.
 */
export const CURL_LIMIT = { knee: 3.3, range: 0.4 };
/** Ring and little metacarpals flex a little with their knuckles, which cups the palm in a fist (radian per radian). */
export const CUP_GAIN: readonly number[] = [0, 0, 0, 0.06, 0.13];
/**
 * Spread (radians, away from the middle finger) added to every pose. The model's fingers lie pressed together, and a
 * curled hand then reads as one lump; a hand at ease keeps a finger's width of air between its fingers.
 */
export const REST_SPREAD: readonly number[] = [0, 0.08, 0, 0.05, 0.1];

export interface BoneDesc {
  name: string;
  /** Index of the parent bone, -1 for the wrist (child of the hand root). */
  parent: number;
  /** Bind transform relative to the parent. */
  position: Vector3;
  quaternion: Quaternion;
  /** Bind transform in hand space. */
  worldPosition: Vector3;
  worldQuaternion: Quaternion;
  /** Inverse of the bind world matrix (the skin's inverse bind matrix). */
  inverse: Matrix4;
}

export interface JointDesc {
  bone: number;
  /** Flexion axis in the bone's local frame: a positive turn about it curls the bone towards the palm. */
  flexAxis: Vector3;
  /** Abduction axis in the bone's local frame, signed so a positive contract spread moves away from the middle. */
  spreadAxis: Vector3;
  /** Long axis of the bone in its local frame (towards the child), for the thumb's pronation. */
  rollAxis: Vector3;
  /** Flexion (radians) the bind pose already has at this joint. */
  bindFlex: number;
}

export interface FingerDesc {
  joints: [JointDesc, JointDesc, JointDesc];
  /** Bone at the fingertip. */
  tip: number;
  /** Metacarpal that cups with the knuckle (ring and little), or null. */
  cup: { bone: number; axis: Vector3; gain: number } | null;
}

export interface HandLayout {
  bones: BoneDesc[];
  fingers: FingerDesc[];
  /** Palm frame measured from the bind pose: palmar normal, radial (thumb side) and distal directions. */
  palm: PalmFrame;
  /**
   * Bind fan: the angle (radians, in the palm plane) of each finger's proximal phalanx away from the middle finger's,
   * signed like the contract spread (positive away from the middle). Thumb and middle are 0.
   */
  fan: number[];
}

export interface PalmFrame {
  /** Unit normal out of the palm (the side the thumb sits on). */
  palmar: Vector3;
  /** Unit direction from the little finger towards the index, in the palm plane. */
  radial: Vector3;
  /** Unit direction from the wrist to the middle knuckle. */
  distal: Vector3;
  /** Mean of the wrist and the four knuckles. */
  centre: Vector3;
  /** Distance between the index and little knuckles. */
  width: number;
}

const knuckle = (f: number) => CHAINS[f][1];

/**
 * Measures the palm from joint positions: the plane through the wrist and the knuckles, its normal signed towards the
 * thumb tip (in a relaxed hand the thumb rests in front of the palm), so no axis convention of the model is assumed.
 */
export function palmFrame(pos: (name: string) => Vector3): PalmFrame {
  const w = pos(WRIST);
  const i = pos(knuckle(1));
  const m = pos(knuckle(2));
  const r = pos(knuckle(3));
  const l = pos(knuckle(4));
  const distal = m.clone().sub(w).normalize();
  const across = i.clone().sub(l);
  const width = across.length();
  const radial = across.addScaledVector(distal, -across.dot(distal)).normalize();
  const centre = w.clone().add(i).add(m).add(r).add(l).multiplyScalar(0.2);
  const palmar = new Vector3().crossVectors(distal, radial).normalize();
  if (palmar.dot(pos(CHAINS[0][3]).clone().sub(centre)) < 0) palmar.negate();
  return { palmar, radial, distal, centre, width };
}

const _q = new Quaternion();
const _v = new Vector3();

/** World direction expressed in a bone's local frame. */
function toLocal(v: Vector3, worldQuat: Quaternion): Vector3 {
  return v.clone().applyQuaternion(_q.copy(worldQuat).invert()).normalize();
}

/** Signed angle from a to b about axis (all unit vectors). */
export function signedAngle(a: Vector3, b: Vector3, axis: Vector3): number {
  return Math.atan2(_v.crossVectors(a, b).dot(axis), a.dot(b));
}

/**
 * Builds the bone chain and the per-joint axes from bind world transforms (hand space). Every axis is derived from the
 * bind geometry: a finger bone curls in the plane of its own direction and the palm normal; the thumb curls towards
 * the base of the little finger in front of the palm, which is also the direction of opposition.
 */
export function buildLayout(world: (name: string) => { position: Vector3; quaternion: Quaternion }): HandLayout {
  const names = [WRIST, ...CHAINS.flat()];
  const index = new Map(names.map((n, i) => [n, i]));
  const parentOf = (n: string): number => {
    if (n === WRIST) return -1;
    for (const c of CHAINS) {
      const k = c.indexOf(n);
      if (k === 0) return 0;
      if (k > 0) return index.get(c[k - 1]) as number;
    }
    return -1;
  };
  const bones: BoneDesc[] = names.map((name) => {
    const w = world(name);
    const parent = parentOf(name);
    const inverse = new Matrix4().compose(w.position, w.quaternion, new Vector3(1, 1, 1)).invert();
    let position = w.position.clone();
    let quaternion = w.quaternion.clone();
    if (parent >= 0) {
      const p = world(names[parent]);
      const pq = p.quaternion.clone().invert();
      position = w.position.clone().sub(p.position).applyQuaternion(pq);
      quaternion = pq.multiply(w.quaternion);
    }
    return { name, parent, position, quaternion, worldPosition: w.position.clone(), worldQuaternion: w.quaternion.clone(), inverse };
  });

  const P = (n: string) => bones[index.get(n) as number].worldPosition;
  const palm = palmFrame(P);
  const thumbTarget = palm.centre
    .clone()
    .addScaledVector(palm.distal, palm.width * THUMB_TARGET.distal)
    .addScaledVector(palm.palmar, palm.width * THUMB_TARGET.palmar)
    .addScaledVector(palm.radial, palm.width * THUMB_TARGET.radial);

  const fingers: FingerDesc[] = CHAINS.map((chain, f) => {
    const dir = (k: number) => P(chain[k + 1]).clone().sub(P(chain[k])).normalize();
    const joints = DRIVEN[f].map((k, slot) => {
      const b = bones[index.get(chain[k]) as number];
      const d = dir(k);
      const toward = f === 0 ? thumbTarget.clone().sub(b.worldPosition) : palm.palmar;
      const flexW = new Vector3().crossVectors(d, toward).normalize();
      // The thumb abducts about the palm normal, the fingers about the axis that swings them across the palm plane.
      const spreadW = f === 0 ? palm.palmar.clone() : new Vector3().crossVectors(d, palm.radial).normalize();
      if (_v.crossVectors(spreadW, d).dot(palm.radial) < 0) spreadW.negate();
      let bindFlex = THUMB_CMC_REST;
      if (!(f === 0 && k === 0)) {
        const parentDir = k === 0 ? d : dir(k - 1);
        bindFlex = signedAngle(parentDir, d, flexW);
      }
      return {
        bone: index.get(chain[k]) as number,
        flexAxis: toLocal(flexW, b.worldQuaternion),
        spreadAxis: SPREAD_DIR[f] && slot === 0 ? toLocal(spreadW, b.worldQuaternion).multiplyScalar(Math.sign(SPREAD_DIR[f])) : new Vector3(),
        rollAxis: toLocal(d, b.worldQuaternion),
        bindFlex,
      } satisfies JointDesc;
    }) as [JointDesc, JointDesc, JointDesc];
    let cup: FingerDesc['cup'] = null;
    if (CUP_GAIN[f] > 0) {
      const meta = bones[index.get(chain[0]) as number];
      const axis = toLocal(new Vector3().crossVectors(dir(0), palm.palmar), meta.worldQuaternion);
      cup = { bone: index.get(chain[0]) as number, axis, gain: CUP_GAIN[f] };
    }
    return { joints, tip: index.get(chain[chain.length - 1]) as number, cup };
  });

  // Yaw of each proximal phalanx in the palm plane, relative to the middle finger's.
  const yaw = (f: number) => {
    const d = P(CHAINS[f][2]).clone().sub(P(CHAINS[f][1]));
    return Math.atan2(d.dot(palm.radial), d.dot(palm.distal));
  };
  const fan = [0, yaw(1) - yaw(2), 0, yaw(2) - yaw(3), yaw(2) - yaw(4)];

  return { bones, fingers, palm, fan };
}

/**
 * Glove core angles. The core (core/compat.py) sends the solver's geometric angles: each flexion is the unsigned angle
 * between two bones, the thumb's first value is the angle between the thumb and index metacarpals (a CMC stand-in), and
 * each spread is the angle between neighbouring proximal phalanges (thumb-index, index-middle, middle-ring, ring-little;
 * middle always 0). The contract's own sources (simulator, synthesiser, mock) send spread 0 at rest instead. A frame whose
 * spread has that core signature is read with the core's meaning; everything else keeps the contract's.
 */
export function isCoreAngleSpread(spread: Partial<Record<string, number>> | null | undefined): boolean {
  if (!spread) return false;
  const { thumb = 0, index = 0, middle = 0, ring = 0, little = 0 } = spread;
  return Math.abs(middle) < 1e-6 && thumb > 0.05 && index >= 0 && ring >= 0 && little >= 0 && index + ring + little > 0.02;
}

/**
 * The yaw difference (radians, in the palm plane) between two neighbouring proximal phalanges, from the 3D angle between
 * them and each one's flexion out of the palm plane: cos(angle) = cos f1 cos f2 cos(yaw) + sin f1 sin f2. With both
 * fingers curled far the yaw is lost in the curl, so it fades to `rest`.
 */
function yawBetween(angle: number, f1: number, f2: number, rest: number): number {
  const c = Math.cos(f1) * Math.cos(f2);
  const y = c > 1e-3 ? Math.acos(Math.min(1, Math.max(-1, (Math.cos(angle) - Math.sin(f1) * Math.sin(f2)) / c))) : rest;
  const trust = smoothstep(0.15, 0.5, c);
  return rest + (y - rest) * trust;
}

/** The core's natural yaw between neighbouring proximal phalanges of a relaxed hand (radians): the fallback when curled. */
const CORE_REST_YAW = 0.12;
/** Contract spread (radians) the core's angles can ask for, so a noisy reading never splays a finger off the hand. */
const CORE_SPREAD_LIMIT = { min: -0.3, max: 0.5 };

/**
 * Contract spreads (away from the middle finger, relative to the model's bind fan) from the core's inter-finger angles:
 * each neighbour's yaw is recovered from the 3D angle and the two flexions, chained out from the middle finger, and the
 * model's own fan is taken off. The thumb's spread is set by the caller.
 */
export function coreSpreadToContract(layout: HandLayout, flex: ArrayLike<number>, spread: ArrayLike<number>, out: number[]): number[] {
  const mcp = (f: number) => flex[f * 3] ?? 0;
  const im = yawBetween(spread[1] ?? 0, mcp(1), mcp(2), CORE_REST_YAW);
  const mr = yawBetween(spread[3] ?? 0, mcp(2), mcp(3), CORE_REST_YAW);
  const rl = yawBetween(spread[4] ?? 0, mcp(3), mcp(4), CORE_REST_YAW);
  const clamp = (v: number) => Math.min(CORE_SPREAD_LIMIT.max, Math.max(CORE_SPREAD_LIMIT.min, v));
  out[0] = 0;
  out[1] = clamp(im - layout.fan[1]);
  out[2] = 0;
  out[3] = clamp(mr - layout.fan[3]);
  out[4] = clamp(mr + rl - layout.fan[4]);
  return out;
}


/** Local quaternion of one driven joint for a flexion and spread (radians); writes and returns `out`. */
export function jointQuaternion(bind: Quaternion, j: JointDesc, flex: number, spread: number, roll: number, out: Quaternion): Quaternion {
  out.copy(bind);
  if (spread !== 0 && j.spreadAxis.lengthSq() > 0) out.multiply(_q.setFromAxisAngle(j.spreadAxis, spread));
  out.multiply(_q.setFromAxisAngle(j.flexAxis, flex - j.bindFlex));
  if (roll !== 0) out.multiply(_q.setFromAxisAngle(j.rollAxis, roll));
  return out;
}

const _spread: number[] = [0, 0, 0, 0, 0];

/**
 * Writes a pose onto the bones: 15 flexion angles (finger-major, contract order) and 5 spreads. Pure mutation of the
 * bone quaternions, no allocation, safe to call every frame. With `coreAngles` the values carry the glove core's meaning
 * (isCoreAngleSpread): the finger spreads are inter-finger angles, converted here, and the model's rest spread is not added
 * to them, since the wearer's own fan is in the reading.
 */
export function applyHandPose(
  bones: readonly Object3D[],
  layout: HandLayout,
  flex: ArrayLike<number>,
  spread: ArrayLike<number>,
  thumb: ThumbTuning = THUMB_TUNING,
  coreAngles = false,
): void {
  if (coreAngles) {
    // The thumb keeps the contract reading of its values: measured on a full recorded session (point, pinch, OK, claw,
    // fist...) that sits closer to the core skeleton than inverting the CMC stand-in does.
    const thumbSpread = spread[0] ?? 0;
    spread = coreSpreadToContract(layout, flex, spread, _spread);
    _spread[0] = thumbSpread;
  }
  for (let f = 0; f < 5; f++) {
    const fd = layout.fingers[f];
    // Past a tight fist the model's fingertips would sink into its palm, so the PIP and DIP give way softly (the knuckle
    // keeps its full angle, so the fist still closes). Only the drawing changes; the pose data is untouched.
    let squeeze = 1;
    if (f > 0) {
      const mid = (flex[f * 3 + 1] ?? 0) + (flex[f * 3 + 2] ?? 0);
      const total = (flex[f * 3] ?? 0) + mid;
      if (total > CURL_LIMIT.knee && mid > 0) {
        const capped = CURL_LIMIT.knee + CURL_LIMIT.range * Math.tanh((total - CURL_LIMIT.knee) / CURL_LIMIT.range);
        squeeze = Math.max(0, (mid - (total - capped)) / mid);
      }
    }
    for (let k = 0; k < 3; k++) {
      const j = fd.joints[k];
      let a = flex[f * 3 + k] ?? 0;
      if (k > 0) a *= squeeze;
      let roll = 0;
      if (f === 0 && k === 0) {
        const swing = (a - j.bindFlex) * thumb.opposition;
        a = j.bindFlex + swing;
        roll = swing * thumb.roll;
      } else if (f === 0) a = j.bindFlex + (a - j.bindFlex) * thumb.curl;
      jointQuaternion(layout.bones[j.bone].quaternion, j, a, k === 0 ? (spread[f] ?? 0) + (coreAngles && f > 0 ? 0 : REST_SPREAD[f]) : 0, roll, bones[j.bone].quaternion);
    }
    if (fd.cup) {
      const mcp = Math.max(0, (flex[f * 3] ?? 0) - fd.joints[0].bindFlex);
      bones[fd.cup.bone].quaternion.copy(layout.bones[fd.cup.bone].quaternion).multiply(_q.setFromAxisAngle(fd.cup.axis, mcp * fd.cup.gain));
    }
  }
  closePinch(bones, layout, flex[0] ?? 0);
}

/**
 * Pinch contact. Joint angles alone leave the thumb and index pads a little apart (a glove's thumb reading is coarse and
 * the model's thumb is not the wearer's), so when the thumb is flexed towards the fingers and its posed tip already sits
 * near the index tip, held out in front of the knuckle as in a pinch, the thumb's CMC and MCP turn the rest of the way
 * until the pads touch. Far apart, with the thumb at rest, or with the index curled into a fist, nothing changes; in
 * between the correction fades in, so a pinch closes smoothly.
 */
export const PINCH = {
  /** Unaided tip distance (hand-space units) at which the pads close fully, and beyond which the thumb is left alone. */
  near: 0.55,
  far: 0.7,
  /** Distance kept between the two tip joints when touching: about one fingertip's thickness. */
  contact: 0.16,
  /** How far in front of its knuckle (along the palm) the index tip must be for a pinch; curled back past it is a fist. */
  reachFrom: -0.4,
  reachTo: -0.25,
  /** Thumb CMC flexion (radians) over which the correction fades in: a thumb still near its rest is not pinching. */
  thumbFrom: 0.3,
  thumbTo: 0.42,
};

const _p = new Vector3();
const _wq = new Quaternion();
const _thumbTip = new Vector3();
const _indexTip = new Vector3();
const _indexKnuckle = new Vector3();
const _target = new Vector3();
const _joint = new Vector3();
const _jq = new Quaternion();
const _pq = new Quaternion();
const _a = new Vector3();
const _b = new Vector3();
const _r = new Quaternion();
const _pi = new Quaternion();
const _chain: number[] = [];

/** Hand-space position (and optionally rotation) of a bone from the current local transforms, without matrices. */
function boneWorld(bones: readonly Object3D[], layout: HandLayout, i: number, pos: Vector3, quat: Quaternion): void {
  _chain.length = 0;
  for (let b = i; b >= 0; b = layout.bones[b].parent) _chain.push(b);
  pos.set(0, 0, 0);
  quat.identity();
  for (let k = _chain.length - 1; k >= 0; k--) {
    const b = bones[_chain[k]];
    pos.add(_p.copy(b.position).applyQuaternion(quat));
    quat.multiply(b.quaternion);
  }
}

function closePinch(bones: readonly Object3D[], layout: HandLayout, thumbCmc: number): void {
  const pressing = smoothstep(PINCH.thumbFrom, PINCH.thumbTo, thumbCmc);
  if (pressing <= 0) return;
  const thumb = layout.fingers[0];
  const index = layout.fingers[1];
  boneWorld(bones, layout, thumb.tip, _thumbTip, _wq);
  boneWorld(bones, layout, index.tip, _indexTip, _wq);
  boneWorld(bones, layout, index.joints[0].bone, _indexKnuckle, _wq);
  const d0 = _thumbTip.distanceTo(_indexTip);
  const reach = _a.copy(_indexTip).sub(_indexKnuckle).dot(layout.palm.distal);
  const w = pressing * (1 - smoothstep(PINCH.near, PINCH.far, d0)) * smoothstep(PINCH.reachFrom, PINCH.reachTo, reach);
  if (w <= 0) return;
  // Aim at a point one contact distance short of the index tip, on the thumb's side of it.
  _target.copy(_thumbTip).sub(_indexTip);
  if (_target.lengthSq() < 1e-8) return;
  _target.setLength(PINCH.contact).add(_indexTip);
  _target.lerpVectors(_thumbTip, _target, w);
  // Cyclic coordinate descent over the MCP then the CMC: each turns so the tip swings onto the line to the target.
  const joints = [thumb.joints[1].bone, thumb.joints[0].bone];
  for (let it = 0; it < 4; it++) {
    for (const j of joints) {
      boneWorld(bones, layout, j, _joint, _jq);
      boneWorld(bones, layout, thumb.tip, _thumbTip, _wq);
      _a.copy(_thumbTip).sub(_joint);
      _b.copy(_target).sub(_joint);
      if (_a.lengthSq() < 1e-8 || _b.lengthSq() < 1e-8) continue;
      _r.setFromUnitVectors(_a.normalize(), _b.normalize());
      // World turn r on this bone: local' = parentWorld^-1 * r * parentWorld * local.
      _pq.copy(_jq).multiply(_q.copy(bones[j].quaternion).invert());
      const local = bones[j].quaternion;
      local.premultiply(_pi.copy(_pq).invert().multiply(_r).multiply(_pq));
      local.normalize();
    }
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Joint positions from the glove core (core/hand.py JOINT_NAMES): 26 points, x y z each, in the wrist frame of a right
 * hand (a left hand mirrored in x): fingers along -z, back of the hand +y, thumb towards -x. Index of each chain's first
 * joint, in CHAINS order; chain joint k is CORE_BASE[f] + k.
 */
export const CORE_BASE = [2, 6, 11, 16, 21] as const;
export const CORE_WRIST = 1;
export const CORE_JOINTS = 26;

/** Chain joints whose bone (towards the next joint) the core's positions drive: the three phalanges of each finger. */
const JOINT_DRIVEN: readonly (readonly number[])[] = [
  [0, 1, 2],
  [1, 2, 3],
  [1, 2, 3],
  [1, 2, 3],
  [1, 2, 3],
];

const _cw = new Vector3();
const _cr = new Vector3();
const _cd = new Vector3();
const _cn = new Vector3();
const _seg = new Vector3();
const _dir = new Vector3();
const _cur = new Vector3();
const _bq = new Quaternion();
const _wpq = new Quaternion();
const _sw = new Quaternion();
const _lq = new Quaternion();
const _pos = new Vector3();
const chainCache = new WeakMap<HandLayout, number[][]>();

/** Bone index of every joint of every chain, in CHAINS order (cached per layout). */
function chainBones(layout: HandLayout): number[][] {
  let c = chainCache.get(layout);
  if (!c) {
    c = CHAINS.map((chain) => chain.map((n) => layout.bones.findIndex((d) => d.name === n)));
    chainCache.set(layout, c);
  }
  return c;
}

function corePoint(j: ArrayLike<number>, i: number, out: Vector3): Vector3 {
  return out.set(j[i * 3], j[i * 3 + 1], j[i * 3 + 2]);
}

/**
 * Poses every phalanx from the core's joint positions, so the model shows exactly what the core's skeleton shows (the
 * debug view at /debug draws the same points). Each bone direction is read in the wearer's palm frame and laid into the
 * model's: the model's palm and metacarpals hold still, and every phalanx (thumb metacarpal included) takes the
 * direction of its counterpart, turning by the smallest swing from its bind orientation so it keeps its natural twist.
 * `weight` blends from the pose already on the bones (0) to the joint pose (1). Pure mutation, no allocation.
 */
export function applyJointPose(bones: readonly Object3D[], layout: HandLayout, joints: ArrayLike<number>, weight = 1): void {
  if (weight <= 0 || joints.length < CORE_JOINTS * 3) return;
  // The wearer's palm frame, same construction as palmFrame with a fixed handedness (the core's frame is right-handed).
  const w = corePoint(joints, CORE_WRIST, _cw);
  const knuckle = (f: number, out: Vector3) => corePoint(joints, CORE_BASE[f] + 1, out);
  knuckle(2, _cd).sub(w);
  if (_cd.lengthSq() < 1e-12) return;
  _cd.normalize();
  knuckle(1, _cr).sub(knuckle(4, _cn));
  _cr.addScaledVector(_cd, -_cr.dot(_cd));
  if (_cr.lengthSq() < 1e-12) return;
  _cr.normalize();
  _cn.crossVectors(_cr, _cd).normalize();
  const m = layout.palm;
  const cb = chainBones(layout);
  for (let f = 0; f < 5; f++) {
    for (const k of JOINT_DRIVEN[f]) {
      const bi = cb[f][k];
      // Target direction: the core's bone in its palm frame, rebuilt in the model's.
      corePoint(joints, CORE_BASE[f] + k + 1, _seg).sub(corePoint(joints, CORE_BASE[f] + k, _dir));
      if (_seg.lengthSq() < 1e-12) continue;
      _seg.normalize();
      const x = _seg.dot(_cr);
      const y = _seg.dot(_cn);
      const z = _seg.dot(_cd);
      _dir.copy(m.radial).multiplyScalar(x).addScaledVector(m.palmar, y).addScaledVector(m.distal, z).normalize();
      // The bone at its bind rotation under its parent as posed now, and the world swing that aims it.
      const parent = layout.bones[bi].parent;
      if (parent >= 0) boneWorld(bones, layout, parent, _pos, _wpq);
      else _wpq.identity();
      const bind = layout.bones[bi].quaternion;
      _cur.copy(layout.bones[cb[f][k + 1]].position).normalize().applyQuaternion(_bq.copy(_wpq).multiply(bind));
      _sw.setFromUnitVectors(_cur, _dir);
      // local = parentWorld^-1 * swing * parentWorld * bind
      _lq.copy(_wpq).invert().multiply(_sw).multiply(_wpq).multiply(bind).normalize();
      bones[bi].quaternion.slerp(_lq, Math.min(1, weight));
    }
  }
}

/** Creates the bone hierarchy at its bind pose under `root` (the wrist is its child). Returns bones in layout order. */
export function createBones(layout: HandLayout, root: Object3D): Bone[] {
  const bones = layout.bones.map((d) => {
    const b = new Bone();
    b.name = d.name;
    b.position.copy(d.position);
    b.quaternion.copy(d.quaternion);
    return b;
  });
  layout.bones.forEach((d, i) => (d.parent < 0 ? root : bones[d.parent]).add(bones[i]));
  return bones;
}
