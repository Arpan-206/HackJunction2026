import { useEffect, useMemo, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Vector3 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Finger } from '../../api/types';
import type { HandHandle } from '../Hand';
import { useStageColors } from '../stageContext';
import type { RobotHandHandle } from './RobotHand';

/**
 * "Geppetto drives Pinocchio": a marionette string from each human fingertip to the matching robot fingertip. Strings
 * arc up like a puppeteer's while the robot follows and sag when it does not. Fingers the robot lacks get a short
 * string that ends loose below the human fingertip. Lives in world space: mount it at the root of the canvas.
 */

const SEGMENTS = 28;

export interface MarionetteStringsProps {
  human: RefObject<HandHandle>;
  robot: RefObject<RobotHandHandle>;
  /** Fingers with a robot counterpart. */
  fingers: Finger[];
  /** Fingers the robot lacks: their strings hang loose. */
  loose: Finger[];
  /** Read every frame: true while the robot follows (strings taut), false when released (strings sag). */
  taut: RefObject<boolean>;
  /** Hide every string (e.g. when the hand drawn is not the one driving the robot). */
  hidden?: boolean;
}

function makeLine(mat: LineMaterial): Line2 {
  const geo = new LineGeometry();
  geo.setPositions(new Array((SEGMENTS + 1) * 3).fill(0));
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  return line;
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const p = new Vector3();

/** Fills `out` with a quadratic curve a -> b bent through control point c. */
function curve(out: number[], from: Vector3, ctrl: Vector3, to: Vector3): void {
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const u = 1 - t;
    p.set(0, 0, 0)
      .addScaledVector(from, u * u)
      .addScaledVector(ctrl, 2 * u * t)
      .addScaledVector(to, t * t);
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
}

export function MarionetteStrings({ human, robot, fingers, loose, taut, hidden = false }: MarionetteStringsProps) {
  const stage = useStageColors();
  const mats = useMemo(() => {
    const ink = new Color(stage.ink).getHex();
    return {
      live: new LineMaterial({ color: ink, linewidth: 2.2, transparent: true, opacity: 0.85 }),
      loose: new LineMaterial({ color: ink, linewidth: 1.6, dashed: true, dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.5 }),
    };
  }, [stage.ink]);
  const liveCount = fingers.length;
  const looseCount = loose.length;
  const lines = useMemo(
    () => ({
      live: Array.from({ length: liveCount }, () => makeLine(mats.live)),
      loose: Array.from({ length: looseCount }, () => makeLine(mats.loose)),
    }),
    [liveCount, looseCount, mats],
  );
  const buf = useMemo(() => new Array<number>((SEGMENTS + 1) * 3).fill(0), []);
  const sag = useMemo(() => ({ v: 0 }), []);

  useEffect(
    () => () => {
      [...lines.live, ...lines.loose].forEach((l) => l.geometry.dispose());
    },
    [lines],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  useFrame((state, delta) => {
    mats.live.resolution.set(state.size.width, state.size.height);
    mats.loose.resolution.set(state.size.width, state.size.height);
    const h = human.current;
    const r = robot.current;
    const want = taut.current ? 1 : 0;
    sag.v += (want - sag.v) * (1 - Math.exp(-Math.min(delta, 0.1) / 0.18));
    lines.live.forEach((line, i) => {
      line.visible = !hidden && !!h && !!r;
      if (!line.visible || !h || !r) return;
      h.getTipWorld(fingers[i], a);
      if (!r.getTipWorld(fingers[i], b)) {
        line.visible = false;
        return;
      }
      const d = a.distanceTo(b);
      // Taut: an arc up to an imagined control bar above. Released: the string sags between the hands.
      c.copy(a).add(b).multiplyScalar(0.5);
      c.y += d * (0.42 * sag.v - 0.22 * (1 - sag.v));
      curve(buf, a, c, b);
      line.geometry.setPositions(buf);
    });
    lines.loose.forEach((line, i) => {
      line.visible = !hidden && !!h;
      if (!line.visible || !h) return;
      h.getTipWorld(loose[i], a);
      b.copy(a).add(p.set(0.28 + i * 0.08, -0.62, 0.1));
      c.copy(a).add(p.set(0.42, 0.18, 0));
      curve(buf, a, c, b);
      line.geometry.setPositions(buf);
      line.computeLineDistances();
    });
  });

  return (
    <group>
      {lines.live.map((l, i) => (
        <primitive key={`s-${i}`} object={l} />
      ))}
      {lines.loose.map((l, i) => (
        <primitive key={`l-${i}`} object={l} />
      ))}
    </group>
  );
}
