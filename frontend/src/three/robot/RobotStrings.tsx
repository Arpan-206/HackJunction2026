import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, Mesh, MeshToonMaterial, SphereGeometry, Vector3, type InstancedInterleavedBuffer } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { FINGERS, type Finger } from '../../api/types';
import type { HandHandle } from '../Hand';
import { toonGradient } from '../materials';
import { useStageColors } from '../stageContext';
import { STRING_POINTS, writeStringSegments } from '../stringMath';

/** Anything with fingertips the strings can tie to: the Dex3-1 twin, or a five-finger hand drawn as a robot. */
export interface StringTarget {
  /** World position of a fingertip, or null when there is no such finger. */
  getTipWorld: (finger: Finger, out: Vector3) => Vector3 | null;
}

const SEGMENTS = STRING_POINTS - 1;
const FAN = [-0.9, -0.45, 0, 0.45, 0.9];
/** How far a thread from a finger the robot lacks hangs below the human fingertip, in scene units. */
const LOOSE_DROP = 0.42;

function makeLine(width: number, color: Color): Line2 {
  const geo = new LineGeometry();
  geo.setPositions(new Float32Array(STRING_POINTS * 3));
  const mat = new LineMaterial({ color: color.getHex(), linewidth: width, worldUnits: false, transparent: true });
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 5;
  return line;
}

interface RobotStringsProps {
  human: RefObject<HandHandle>;
  robot: RefObject<StringTarget | null>;
  visible?: boolean;
}

/**
 * Geppetto's strings from the human fingertips to the robot's: one slack thread per finger the robot has. A finger the
 * robot lacks gets a short thread that hangs from the human fingertip into nothing, with a bead at its loose end.
 * Geometry is rewritten in place every frame, so React never re-renders.
 */
export function RobotStrings({ human, robot, visible = true }: RobotStringsProps) {
  const stage = useStageColors();
  const size = useThree((s) => s.size);
  const built = useMemo(() => {
    const group = new Group();
    const chalk = new Color(stage.chalk);
    const ink = new Color(stage.ink);
    const lines = FINGERS.map(() => {
      const l = makeLine(3.2, chalk);
      group.add(l);
      return l;
    });
    const beadGeo = new SphereGeometry(0.045, 12, 10);
    const beads = FINGERS.map(() => {
      const m = new Mesh(beadGeo, new MeshToonMaterial({ color: stage.chalk, gradientMap: toonGradient() }));
      group.add(m);
      return m;
    });
    return { group, lines, beads, beadGeo, chalk, ink };
  }, [stage.chalk, stage.ink]);

  useEffect(
    () => () => {
      built.lines.forEach((l) => {
        l.geometry.dispose();
        (l.material as LineMaterial).dispose();
      });
      built.beads.forEach((b) => (b.material as MeshToonMaterial).dispose());
      built.beadGeo.dispose();
    },
    [built],
  );

  const scratch = useRef({ a: new Vector3(), b: new Vector3(), seg: new Float32Array(SEGMENTS * 6) });

  useFrame(() => {
    const h = human.current;
    const r = robot.current;
    built.group.visible = Boolean(visible && h && r);
    if (!built.group.visible || !h || !r) return;
    const { a, b, seg } = scratch.current;
    FINGERS.forEach((f, i) => {
      const line = built.lines[i];
      const bead = built.beads[i];
      h.getTipWorld(f, a);
      const has = r.getTipWorld(f, b) !== null;
      if (!has) {
        // No robot finger to reach: the thread falls from the fingertip and ends in a bead.
        b.set(a.x, a.y - LOOSE_DROP, a.z + 0.08);
      }
      writeStringSegments([a.x, a.y, a.z], [b.x, b.y, b.z], has ? 0.35 : 0.85, FAN[i], seg);
      const attr = line.geometry.attributes.instanceStart as unknown as { data: InstancedInterleavedBuffer };
      attr.data.array.set(seg);
      attr.data.needsUpdate = true;
      const mat = line.material as LineMaterial;
      mat.color.copy(has ? built.chalk : built.ink);
      mat.linewidth = has ? 3.2 : 1.8;
      mat.opacity = has ? 0.95 : 0.55;
      mat.resolution.set(size.width, size.height);
      bead.visible = !has;
      if (!has) {
        bead.position.copy(b);
        (bead.material as MeshToonMaterial).color.copy(built.ink);
      }
    });
  });

  return <primitive object={built.group} />;
}
