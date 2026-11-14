import { useEffect, useMemo, useRef, type MutableRefObject, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Group, Mesh, MeshToonMaterial, SphereGeometry, CylinderGeometry, TorusGeometry, Vector3, type InstancedInterleavedBuffer } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { FINGERS } from '../../../../api/types';
import { useStageColors, type HandHandle } from '../../../../three';
import { toonGradient } from '../../../../three/materials';
import type { Coach } from '../coach/useCoach';
import type { AttemptPolicy } from '../coach/fade';
import { frayLevels } from '../../pipeline/stages';
import { STRING_POINTS, writeStringSegments } from './stringMath';

const FAN = [-1.1, -0.55, 0, 0.55, 1.1];
const SEGMENTS = STRING_POINTS - 1;
/** Seconds a snapped string takes to recoil and vanish, and the stagger between neighbouring strings. */
const SNAP_S = 0.65;
const SNAP_STAGGER_S = 0.07;

function makeLine(width: number, color: Color): Line2 {
  const geo = new LineGeometry();
  geo.setPositions(new Float32Array(STRING_POINTS * 3));
  const mat = new LineMaterial({ color: color.getHex(), linewidth: width, worldUnits: false });
  const line = new Line2(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 5;
  return line;
}

interface StringsProps {
  master: RefObject<HandHandle>;
  learner: RefObject<HandHandle>;
  coach: Coach;
  policy: AttemptPolicy;
  /** Clean-rep combo: strings thin as `count` approaches `need`, and snap whenever `snapKey` changes. */
  combo?: { count: number; need: number; snapKey: number; played: MutableRefObject<number> };
}

/**
 * The marionette's strings: one thread from each master fingertip to the matching learner fingertip. A finger inside its
 * tolerance hangs slack; as the error grows the thread pulls straight and turns vermilion. Geometry is rewritten in place
 * every frame, so React never re-renders.
 */
export function Strings({ master, learner, coach, policy, combo }: StringsProps) {
  const stage = useStageColors();
  const size = useThree((s) => s.size);
  const colours = useMemo(() => ({ slack: new Color(stage.chalk), taut: new Color(stage.vermilion), mix: new Color() }), [stage.chalk, stage.vermilion]);
  const strings = useMemo(() => {
    const group = new Group();
    const lines = FINGERS.map(() => {
      const l = makeLine(4.2, colours.slack);
      (l.material as LineMaterial).transparent = true;
      group.add(l);
      return l;
    });
    const eyeGeo = new SphereGeometry(0.05, 14, 10);
    const beads = FINGERS.map(() => {
      const m = new Mesh(eyeGeo, new MeshToonMaterial({ color: stage.chalk, gradientMap: toonGradient() }));
      group.add(m);
      return m;
    });
    return { group, lines, beads, eyeGeo };
  }, [colours.slack, stage.chalk]);

  useEffect(
    () => () => {
      strings.lines.forEach((l) => {
        l.geometry.dispose();
        (l.material as LineMaterial).dispose();
      });
      strings.beads.forEach((b) => (b.material as MeshToonMaterial).dispose());
      strings.eyeGeo.dispose();
    },
    [strings],
  );

  const scratch = useRef({ a: new Vector3(), b: new Vector3(), seg: new Float32Array(SEGMENTS * 6), snapAt: -1e9 });
  const comboRef = useRef(combo);
  comboRef.current = combo;

  useFrame(() => {
    const m = master.current;
    const l = learner.current;
    const live = coach.live.current;
    const sc = scratch.current;
    const { a, b, seg } = sc;
    const now = performance.now() / 1000;
    const c = comboRef.current;
    if (c && c.snapKey !== c.played.current && m && l) {
      // Plays once per snap, on the first frame the strings are on screen, even if the canvas was rebuilt meanwhile.
      c.played.current = c.snapKey;
      sc.snapAt = now;
    }
    const snapping = now - sc.snapAt < SNAP_S + SNAP_STAGGER_S * FINGERS.length;
    strings.group.visible = Boolean(m && l && policy.showMaster && (policy.strings !== 'none' || snapping));
    if (!strings.group.visible || !m || !l) return;
    const fray = c ? frayLevels(c.count, c.need) : null;
    FINGERS.forEach((f, i) => {
      const line = strings.lines[i];
      const bead = strings.beads[i];
      const off = live.status[f] === 'off' && (!policy.focus || policy.focus.includes(f));
      const e = snapping ? Math.max(0, Math.min(1, (now - sc.snapAt - i * SNAP_STAGGER_S) / SNAP_S)) : 0;
      const gone = snapping && e >= 1;
      const show = !gone && (policy.strings === 'all' || off || snapping);
      line.visible = show;
      bead.visible = show;
      if (!show) return;
      m.getTipWorld(f, a);
      l.getTipWorld(f, b);
      const snapped = snapping;
      if (snapped) {
        // The cut string recoils up towards the master's fingertip, sagging and thinning as it goes.
        const k = e * e;
        b.lerp(a, k);
      }
      const t = snapped ? 0 : live.hasLearner ? live.tension[f] : 0;
      writeStringSegments([a.x, a.y, a.z], [b.x, b.y, b.z], snapped ? Math.min(1, 0.3 + e) : 1 - t, FAN[i], seg);
      const attr = line.geometry.attributes.instanceStart as unknown as { data: InstancedInterleavedBuffer };
      attr.data.array.set(seg);
      attr.data.needsUpdate = true;
      // A rehearsal (between reps) still pulls the strings, but never colours them: only a running rep is judged.
      colours.mix.lerpColors(colours.slack, colours.taut, policy.rehearsal ? 0 : Math.pow(t, 0.7));
      const mat = line.material as LineMaterial;
      mat.color.copy(colours.mix);
      const level = snapped ? 0 : (fray?.[i] ?? 0);
      mat.linewidth = Math.max(0.6, (4 + t * 1.5) * (1 - 0.65 * level) * (snapped ? 1 - e : 1));
      mat.opacity = snapped ? 1 - e * 0.9 : 1 - 0.35 * level;
      mat.resolution.set(size.width, size.height);
      (bead.material as MeshToonMaterial).color.copy(colours.mix);
      bead.position.copy(a);
    });
  });

  return <primitive object={strings.group} />;
}

interface CrossbarProps {
  master: RefObject<HandHandle>;
  /** Height of the bar above the master's wrist. */
  height: number;
}

/**
 * The marionette's wooden cross, hung above the master hand with a thread to each knuckle. It turns with the master's
 * wrist so a swing visibly twirls the controller.
 */
export function Crossbar({ master, height }: CrossbarProps) {
  const stage = useStageColors();
  const size = useThree((s) => s.size);
  const built = useMemo(() => {
    const group = new Group();
    const wood = new MeshToonMaterial({ color: '#a8743f', gradientMap: toonGradient() });
    const dark = new MeshToonMaterial({ color: '#6d4421', gradientMap: toonGradient() });
    const barGeo = new CylinderGeometry(0.05, 0.05, 1.9, 14);
    barGeo.rotateZ(Math.PI / 2);
    const crossGeo = new CylinderGeometry(0.05, 0.05, 1.1, 14);
    crossGeo.rotateX(Math.PI / 2);
    const capGeo = new SphereGeometry(0.075, 12, 10);
    const ringGeo = new TorusGeometry(0.16, 0.026, 8, 24);
    const bar = new Mesh(barGeo, wood);
    const cross = new Mesh(crossGeo, wood);
    group.add(bar, cross);
    for (const [x, z] of [[-0.95, 0], [0.95, 0], [0, -0.55], [0, 0.55]] as const) {
      const cap = new Mesh(capGeo, dark);
      cap.position.set(x, 0, z);
      group.add(cap);
    }
    const ring = new Mesh(ringGeo, dark);
    ring.position.y = 0.26;
    group.add(ring);
    const lines = FINGERS.map(() => {
      const l = makeLine(1.8, new Color(stage.ink));
      return l;
    });
    return { group, lines, geos: [barGeo, crossGeo, capGeo, ringGeo], mats: [wood, dark] };
  }, [stage.ink]);

  useEffect(
    () => () => {
      built.geos.forEach((g) => g.dispose());
      built.mats.forEach((m) => m.dispose());
      built.lines.forEach((l) => {
        l.geometry.dispose();
        (l.material as LineMaterial).dispose();
      });
    },
    [built],
  );

  const scratch = useRef({ a: new Vector3(), b: new Vector3(), centre: new Vector3(), seg: new Float32Array(SEGMENTS * 6) });
  const lineGroup = useRef<Group>(null);

  useFrame(() => {
    const m = master.current;
    if (!m) return;
    const { a, b, centre, seg } = scratch.current;
    m.group.getWorldPosition(centre);
    built.group.position.set(centre.x, centre.y + height, centre.z - 0.7);
    const inner = m.rig.root.parent;
    if (inner) built.group.rotation.set(0, Math.atan2(2 * (inner.quaternion.w * inner.quaternion.y + inner.quaternion.x * inner.quaternion.z), 1 - 2 * (inner.quaternion.y ** 2 + inner.quaternion.z ** 2)) * 0.8, 0);
    built.group.updateMatrixWorld(true);
    FINGERS.forEach((_, i) => {
      const line = built.lines[i];
      m.rig.fingers[i].base.getWorldPosition(b);
      a.set(-0.8 + i * 0.4, 0, 0);
      built.group.localToWorld(a);
      writeStringSegments([a.x, a.y, a.z], [b.x, b.y, b.z], 0, 0, seg);
      const attr = line.geometry.attributes.instanceStart as unknown as { data: InstancedInterleavedBuffer };
      attr.data.array.set(seg);
      attr.data.needsUpdate = true;
      (line.material as LineMaterial).resolution.set(size.width, size.height);
    });
  });

  return (
    <>
      <primitive object={built.group} />
      <group ref={lineGroup}>
        {built.lines.map((l, i) => (
          <primitive key={FINGERS[i]} object={l} />
        ))}
      </group>
    </>
  );
}
