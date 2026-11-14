import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import type { Finger, Side } from '../../api/types';
import { FINGER_ORDER } from '../anatomy';
import { useStageColors } from '../stageContext';
import { applyRobotPose, buildRobotRig, type RobotRig } from './robotRig';
import { parseUrdf, type UrdfModel } from './urdf';

/** A pose for the robot: joint radians by URDF joint name. */
export interface RobotPose {
  q: Record<string, number>;
}

/** The latest pose and when it arrived (performance.now()), the shape useRobotStream keeps in its `latest` ref. */
export interface RobotPoseLatest {
  msg: RobotPose | null;
  at: number;
}

export interface RobotHandProps {
  side?: Side;
  /** Latest robot message and arrival time, read every render frame. Older than `holdMs`, the hand relaxes. */
  live?: RefObject<RobotPoseLatest>;
  /** Or a function called every render frame with the scene time; return joint radians by URDF name. */
  getQ?: (t: number) => Record<string, number> | null;
  /** How long the last pose is held once messages stop (the source went off, or its hand was lost). Default 1000. */
  holdMs?: number;
  /** Render smoothing time constant in seconds; false disables. Default 0.045 s, as the human hand. */
  smoothing?: number | false;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** Extra scale on top of the fit to hand space. Default 1. */
  scale?: number;
  /** Draw chalk ghosts where the human fingers the robot lacks would be. Default true. */
  showMissing?: boolean;
  /** Per-finger colour overrides for the robot's own fingers. */
  fingerTint?: Partial<Record<Finger, string>>;
  /** A parsed URDF to use instead of loading the shipped one for `side`. */
  model?: UrdfModel;
}

export interface RobotHandHandle {
  rig: RobotRig;
  group: Group;
  /** World position of a robot fingertip, or null when the robot has no such finger. */
  getTipWorld: (finger: Finger, out: Vector3) => Vector3 | null;
  hasFinger: (finger: Finger) => boolean;
}

const ORIGIN: [number, number, number] = [0, 0, 0];
const DEFAULT_TAU = 0.045;

const modelCache = new Map<Side, Promise<UrdfModel>>();

/** Loads and parses the shipped Dex3-1 URDF for one side, once. */
export function loadRobotModel(side: Side): Promise<UrdfModel> {
  let p = modelCache.get(side);
  if (!p) {
    p = fetch(`/models/robots/dex3_1/dex3_1_${side[0]}.urdf`)
      .then((res) => {
        if (!res.ok) throw new Error(`robot model for the ${side} hand: HTTP ${res.status}`);
        return res.text();
      })
      .then(parseUrdf);
    p.catch(() => modelCache.delete(side));
    modelCache.set(side, p);
  }
  return p;
}

/** The parsed URDF for a side, null until it has loaded (or when it cannot). */
export function useRobotModel(side: Side, override?: UrdfModel): { model: UrdfModel | null; error: string | null } {
  const [state, setState] = useState<{ side: Side; model: UrdfModel | null; error: string | null }>({ side, model: override ?? null, error: null });
  useEffect(() => {
    if (override) return;
    let alive = true;
    loadRobotModel(side)
      .then((model) => alive && setState({ side, model, error: null }))
      .catch((e: unknown) => alive && setState({ side, model: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      alive = false;
    };
  }, [side, override]);
  if (override) return { model: override, error: null };
  return state.side === side ? { model: state.model, error: state.error } : { model: null, error: null };
}

/**
 * The robot twin: a Unitree Dex3-1 hand drawn from its URDF, driven by joint targets from the core's /ws/robot. Pose
 * updates happen inside useFrame on three.js objects; React never re-renders per frame.
 */
export const RobotHand = forwardRef<RobotHandHandle, RobotHandProps>(function RobotHand(props, ref) {
  const { model } = useRobotModel(props.side ?? 'right', props.model);
  if (!model) return null;
  return <RobotBody {...props} loaded={model} handRef={ref} />;
});

function RobotBody({
  loaded,
  handRef: ref,
  side = 'right',
  live,
  getQ,
  holdMs = 1000,
  smoothing,
  position = ORIGIN,
  rotation = ORIGIN,
  scale = 1,
  showMissing = true,
  fingerTint,
}: RobotHandProps & { loaded: UrdfModel; handRef: React.ForwardedRef<RobotHandHandle> }) {
  const stage = useStageColors();
  const outer = useRef<Group>(null);
  const rig = useMemo(() => buildRobotRig(loaded, side, stage, showMissing), [loaded, side, stage, showMissing]);
  const shown = useRef<Record<string, number>>({});
  const handle = useMemo<RobotHandHandle>(
    () => ({
      rig,
      get group() {
        return outer.current as Group;
      },
      getTipWorld: (finger, out) => {
        const tip = rig.tips[finger];
        return tip ? tip.getWorldPosition(out) : null;
      },
      hasFinger: (finger) => Boolean(rig.tips[finger]),
    }),
    [rig],
  );
  useImperativeHandle(ref, () => handle, [handle]);
  useEffect(() => () => rig.dispose(), [rig]);

  useEffect(() => {
    FINGER_ORDER.forEach((f) => rig.setFingerTint(f, fingerTint?.[f] ?? null));
  }, [rig, fingerTint]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    let target: Record<string, number> | null = null;
    if (getQ) target = getQ(t);
    if (!target && live) {
      const l = live.current;
      if (l && l.msg && performance.now() - l.at <= holdMs) target = l.msg.q;
    }
    const q = shown.current;
    const dt = Math.min(delta, 0.1);
    const tau = smoothing === false ? 0 : smoothing ?? DEFAULT_TAU;
    const k = tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
    // Relax towards rest (every joint at zero) when nothing drives the hand, more slowly than it follows a live pose.
    const relax = target ? k : 1 - Math.exp(-dt / 0.35);
    for (const j of rig.joints) {
      const want = target ? (target[j.name] ?? 0) : 0;
      const cur = q[j.name] ?? 0;
      q[j.name] = cur + (want - cur) * (target ? relax : relax);
    }
    applyRobotPose(rig, q);
  });

  return (
    <group ref={outer} position={position} rotation={rotation} scale={scale}>
      <primitive object={rig.root} />
    </group>
  );
}
