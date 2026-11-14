import { followsHandPosition } from './handPosition';
import { delayProbe } from '../api/delayProbe';
import { forwardRef, Suspense, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Mesh, Vector3, type Camera, type Material, type Object3D, type Quaternion } from 'three';
import type { Finger, GloveFrame, HandFrame, MotionSpec, Side } from '../api/types';
import { FINGER_ORDER } from './anatomy';
import { HAND_SCALE, loadHandTemplate, useHandTemplate, type HandTemplate } from './handModel';
import { applyPose, buildHandRig, type HandRig } from './handRig';
import { LiveJointsGate } from './liveJoints';
import type { HandStyle } from './materials';
import { restFrame, synthFrame } from './motion';
import { FingertipTrails, JointRings } from './overlays';
import { HandSmoother, type SmoothingConfig } from './smoothing';
import { useStageAnchor, useStageColors } from './stageContext';

/** The core's [rest_pose] wrist positions (config.toml), metres: wrist_pos here means "not moved". */
const CORE_REST: Record<Side, [number, number, number]> = { left: [-0.15, 0.1, -0.2], right: [0.15, 0.1, -0.2] };
/** The furthest the hand moves from its place on the stage, metres per axis: the core's work box half sizes. */
const MAX_OFFSET_M: [number, number, number] = [0.225, 0.125, 0.15];

/** The hand's wrist stays inside this share of the picture (1 is the edge), which leaves room for the fingers. */
const VIEW_LIMIT = 0.68;
/** The hand never comes nearer to the camera than this share of its resting distance, so it cannot fill the picture. */
const VIEW_NEAREST = 0.7;
const VIEW_O = new Vector3();
const VIEW_P = new Vector3();

/**
 * The largest share (0 to 1) of the offset `o` from `base` (both in `parent` space) that keeps the hand in view.
 * 1 when the full offset is in view; a base that is itself out of view gives 0, so the hand stays where the scene put it.
 */
function viewShare(parent: Object3D | null, camera: Camera, base: Vector3, o: Vector3): number {
  if (!parent || o.lengthSq() === 0) return 1;
  const restDist = parent.localToWorld(VIEW_P.copy(base)).distanceTo(camera.position);
  const inView = (s: number) => {
    parent.localToWorld(VIEW_P.copy(base).addScaledVector(o, s));
    if (VIEW_P.distanceTo(camera.position) < restDist * VIEW_NEAREST) return false;
    VIEW_P.project(camera);
    return Math.abs(VIEW_P.x) <= VIEW_LIMIT && Math.abs(VIEW_P.y) <= VIEW_LIMIT && VIEW_P.z < 1;
  };
  if (inView(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    if (inView(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface HandProps {
  side?: Side;
  /** chalk (master), wood (apprentice), ghost (translucent overlay), shadow (dark guidance). Default chalk. */
  style?: HandStyle;
  /** Static or React-state-driven frame. Prefer `live` or `getFrame` for anything that changes at frame rate. */
  frame?: HandFrame | null;
  /** Live glove frame ref, e.g. useGloveStream().latest. The hand matching `side` is used. Read every render frame. */
  live?: RefObject<GloveFrame | null>;
  /** Local preview motion (src/three/motion.ts). Used when no live or explicit frame is available. */
  motion?: MotionSpec;
  /** Called every render frame with the scene time in seconds; return a HandFrame to drive the hand (replay, ghost reference). */
  getFrame?: (t: number) => HandFrame | null;
  /** Render smoothing: time constants in seconds, a single number, or false to disable. Default tau 0.045 s. */
  smoothing?: SmoothingConfig | number | false;
  position?: [number, number, number];
  /** Static euler rotation applied outside the wrist orientation. */
  rotation?: [number, number, number];
  scale?: number;
  /**
   * On a stage that provides a ring centre (HandCanvas and the stills, on the hand-only layouts), the hand is placed so
   * its visual centre (not its wrist) lands on the ring centre plus `position`, for a hand lying flat (no pitch or roll in
   * `rotation`). Pass false to place the wrist at `position` as on a bare stage. Default true.
   */
  centred?: boolean;
  /** Base colour override for every finger. */
  tint?: string;
  /** Per-finger colour overrides, e.g. vermilion for a wrong finger, malachite for a right one. */
  fingerTint?: Partial<Record<Finger, string>>;
  /** Finger drawn in gold leaf. */
  focusFinger?: Finger | null;
  /** Multiplies the opacity of ghost and shadow styles (0..1), for fading cues. */
  opacity?: number;
  showJoints?: boolean;
  showTrails?: boolean;
  /**
   * How frame.wrist_pos (metres, core world) moves the hand. 'auto' (default): only while the
   * frame carries a position, which the core sends when its hand root (the phone's colour plus
   * depth) tracks the wrist; gloves alone send null, so the hand stays put as before. The offset
   * is from the core's rest pose for that side, in scene units. false: never move.
   */
  followWristPos?: boolean | 'auto';
  /** Objects in hand space, e.g. <Racket />. */
  children?: ReactNode;
}

/** A hand counts as lying flat (and so as centrable) when its static rotation has no pitch or roll beyond this (radians). */
const FLAT_TOLERANCE = 0.2;

/**
 * Where the hand's origin (the wrist) goes so that its visual centre sits on the stage anchor plus `position`. The centre
 * is a fixed point of the template (right hand; a left hand mirrors x), turned by the hand's yaw and scaled with it, so
 * the centre holds still while the wrist and fingers animate. With no anchor, or a hand that is raised or tipped, the
 * wrist stays at `position`.
 */
/** True when `centredPosition` actually centres the hand (a flat hand on a stage with a ring centre), so the wrist is not where it is held. */
export function isCentred(rotation: readonly [number, number, number], anchor: readonly [number, number] | null): boolean {
  return !!anchor && Math.abs(rotation[0]) <= FLAT_TOLERANCE && Math.abs(rotation[2]) <= FLAT_TOLERANCE;
}

/**
 * Where the wrist group sits so that turning it by `q` leaves the hand's visual centre `c` (wrist space) where it is:
 * t = c - q c. A hand turned about its wrist swings its fingers wherever the glove points, out of the frame or at the
 * camera; turned about its centre it stays on the ring at its own size whatever the wrist heading.
 */
export function pivotOffset(q: Quaternion, c: readonly [number, number, number], out: Vector3): Vector3 {
  out.set(c[0], c[1], c[2]).applyQuaternion(q);
  return out.set(c[0] - out.x, c[1] - out.y, c[2] - out.z);
}

export function centredPosition(
  position: readonly [number, number, number],
  rotation: readonly [number, number, number],
  scale: number,
  side: Side,
  centre: readonly [number, number],
  anchor: readonly [number, number] | null,
): [number, number, number] {
  if (!anchor || Math.abs(rotation[0]) > FLAT_TOLERANCE || Math.abs(rotation[2]) > FLAT_TOLERANCE) return [position[0], position[1], position[2]];
  const cx = (side === 'left' ? -centre[0] : centre[0]) * scale;
  const cz = centre[1] * scale;
  const yaw = rotation[1];
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return [position[0] + anchor[0] - (cx * c + cz * s), position[1], position[2] + anchor[1] - (-cx * s + cz * c)];
}

/** Imperative handle: the rig and a fingertip helper, for props and overlays. */
export interface HandHandle {
  rig: HandRig;
  group: Group;
  /** World position of a fingertip. */
  getTipWorld: (finger: Finger, out: Vector3) => Vector3;
  /** Pose currently shown, after smoothing. Flexion order matches the contract. */
  smoother: HandSmoother;
}

const OUTER_DEFAULT: [number, number, number] = [0, 0, 0];

function pickHand(f: GloveFrame | null | undefined, side: Side): HandFrame | null {
  if (!f) return null;
  for (const h of f.hands) if (h.side === side) return h;
  return null;
}

// Start fetching the hand model as soon as any 3D code loads, so the first hand rarely waits.
if (typeof window !== 'undefined' && import.meta.env.MODE !== 'test') void loadHandTemplate();

/**
 * The skinned 3D hand. Driven by (in priority order) getFrame, live, frame, motion, then a relaxed rest pose.
 * All pose updates mutate three.js objects inside useFrame: nothing here re-renders React per frame. The hand model
 * loads once; until it has, nothing is drawn and the ref stays null.
 */
export const Hand = forwardRef<HandHandle, HandProps>(function Hand(props, ref) {
  return (
    <Suspense fallback={null}>
      <LoadedHand {...props} handRef={ref} />
    </Suspense>
  );
});

function LoadedHand(props: HandProps & { handRef: React.ForwardedRef<HandHandle> }) {
  const template = useHandTemplate();
  if (!template) return null;
  return <HandBody {...props} template={template} />;
}

function HandBody({
  template,
  handRef: ref,
  side = 'right',
  style = 'chalk',
  frame,
  live,
  motion,
  getFrame,
  smoothing,
  position = OUTER_DEFAULT,
  rotation = OUTER_DEFAULT,
  scale = 1,
  centred = true,
  tint,
  fingerTint,
  focusFinger = null,
  opacity = 1,
  showJoints = false,
  showTrails = false,
  followWristPos = 'auto',
  children,
}: HandProps & { template: HandTemplate; handRef: React.ForwardedRef<HandHandle> }) {
  const stage = useStageColors();
  const anchor = useStageAnchor();
  const outer = useRef<Group>(null);
  const inner = useRef<Group>(null);
  const smoother = useMemo(() => new HandSmoother(), []);
  const jointsGate = useMemo(() => new LiveJointsGate(), []);
  const rig = useMemo(() => buildHandRig(template, style, stage, side, tint), [template, style, stage, side, tint]);
  const rest = useMemo(() => restFrame(side), [side]);
  const pivot = useMemo(() => new Vector3(), []);
  const pivoting = centred && isCentred(rotation, anchor);
  const centreLocal = useMemo<[number, number, number]>(() => [(side === 'left' ? -1 : 1) * template.centre[0], 0, template.centre[1]], [side, template]);
  const handle = useMemo<HandHandle>(
    () => ({
      rig,
      smoother,
      get group() {
        return outer.current as Group;
      },
      getTipWorld: (finger, out) => rig.fingers[FINGER_ORDER.indexOf(finger)].tip.getWorldPosition(out),
    }),
    [rig, smoother],
  );
  const selfRef = useRef<HandHandle>(handle);
  selfRef.current = handle;

  useEffect(() => () => rig.dispose(), [rig]);
  useImperativeHandle(ref, () => handle, [handle]);

  useEffect(() => {
    FINGER_ORDER.forEach((f) => rig.setFingerTint(f, fingerTint?.[f] ?? (focusFinger === f ? stage.gold : null)));
  }, [rig, fingerTint, focusFinger, stage.gold]);

  useEffect(() => {
    if (style !== 'ghost' && style !== 'shadow') return;
    const seen = new Set<Material>();
    rig.root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const m = o.material as Material;
      if (seen.has(m)) return;
      seen.add(m);
      m.userData.baseOpacity ??= m.opacity;
      m.opacity = (m.userData.baseOpacity as number) * opacity;
    });
  }, [rig, style, opacity]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    let target: HandFrame | null = null;
    let joints: Float32Array | null = null;
    if (getFrame) target = getFrame(t);
    if (!target && live) {
      target = pickHand(live.current, side);
      // A live hand fed by the glove core is drawn from the core's full skeleton when it is on hand (three/liveJoints.ts).
      joints = jointsGate.pick(live.current, target, side);
    }
    if (!target && frame) target = frame;
    if (!target && motion) target = synthFrame(motion, t, side);
    if (!target) target = rest;

    smoother.step(target, Math.min(delta, 0.1), smoothing, joints);
    delayProbe.drawn();
    applyPose(rig, smoother);
    const g = inner.current;
    if (g) {
      g.quaternion.copy(smoother.quat);
      if (pivoting) pivotOffset(smoother.quat, centreLocal, pivot);
      else pivot.set(0, 0, 0);
      if (target.wrist_pos && (followWristPos === true || (followWristPos === 'auto' && followsHandPosition()))) {
        // the core's wrist position in metres, offset from its rest pose and scaled to the stage (hand-root lane)
        // clamped to the core's work box half sizes, so the hand cannot leave the stage
        const r = CORE_REST[side];
        const off = (k: number) => {
          const m = MAX_OFFSET_M[k] * HAND_SCALE;
          return Math.min(m, Math.max(-m, (smoother.pos[k] - r[k]) * HAND_SCALE));
        };
        // then pulled back along the same line until the hand is inside the picture (any screen, any camera)
        VIEW_O.set(off(0), off(1), off(2));
        const k = viewShare(g.parent, state.camera, pivot, VIEW_O);
        pivot.addScaledVector(VIEW_O, k);
      }
      g.position.copy(pivot);
    }
  });

  const at = centredPosition(position, rotation, scale, side, template.centre, centred ? anchor : null);
  return (
    <group ref={outer} position={at} rotation={rotation} scale={scale}>
      <group ref={inner}>
        <primitive object={rig.root}>{children}</primitive>
      </group>
      {showJoints && <JointRings handRef={selfRef} />}
      {showTrails && <FingertipTrails handRef={selfRef} focus={focusFinger} />}
    </group>
  );
}
