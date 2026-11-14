import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferGeometry, CatmullRomCurve3, Group, Mesh, MeshBasicMaterial, PlaneGeometry, TorusGeometry, TubeGeometry, Vector3 } from 'three';
import { FINGERS, type Prop } from '../api/types';
import type { HandHandle } from './Hand';
import { useStageColors } from './stageContext';
import { RACKET_GRIP } from './props';

/**
 * Chalk sketches that stand in for a prop when props are off: the racket's outline in the hand, the keys drawn on the bench
 * and a ring for the ball. They show where the real thing would be without a solid model for the fingers to clip through,
 * so every skill is learnt and played the same with or without "Add a prop". Nothing here affects scoring.
 */

const LINE = 0.014;

/** A hand-drawn closed loop: the radius wobbles a little and the stroke overshoots its start, as chalk does. */
function wobblyLoop(radius: number, seed: number, cx = 0, cy = 0): CatmullRomCurve3 {
  const pts: Vector3[] = [];
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2 * 1.06 + seed;
    const r = radius * (1 + 0.025 * Math.sin(3 * a + seed) + 0.015 * Math.sin(5 * a));
    pts.push(new Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0));
  }
  return new CatmullRomCurve3(pts, false, 'catmullrom', 0.5);
}

function stroke(a: [number, number, number], b: [number, number, number], wobble = 0.01): CatmullRomCurve3 {
  const mid = new Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + wobble, (a[2] + b[2]) / 2);
  return new CatmullRomCurve3([new Vector3(...a), mid, new Vector3(...b)]);
}

function useChalk(opacity = 0.9): MeshBasicMaterial {
  const stage = useStageColors();
  const mat = useMemo(() => new MeshBasicMaterial({ color: stage.chalk, transparent: true, opacity, depthWrite: false }), [stage.chalk, opacity]);
  useEffect(() => () => mat.dispose(), [mat]);
  return mat;
}

function useDisposeAll(geos: BufferGeometry[]) {
  useEffect(() => () => geos.forEach((g) => g.dispose()), [geos]);
}

/**
 * The racket as a chalk outline in hand space, matching <Racket />: the blade's rim, the handle's two rails and its butt.
 * Mount it as a child of <Hand> so it follows the wrist. `weight` thickens the stroke for a hand drawn small.
 */
export function RacketSketch({ weight = 1 }: { weight?: number }) {
  const mat = useChalk();
  const geos = useMemo(() => {
    const w = LINE * weight;
    const out: BufferGeometry[] = [new TubeGeometry(wobblyLoop(0.62, 0.7, -1.2, 0), 120, w, 5, false)];
    for (const y of [-0.115, 0.115]) out.push(new TubeGeometry(stroke([-0.62, y, 0], [0.5, y, 0], 0.006), 12, w * 0.85, 5, false));
    out.push(new TubeGeometry(stroke([0.5, -0.15, 0], [0.5, 0.15, 0], 0.004), 8, w * 0.85, 5, false));
    return out;
  }, [weight]);
  useDisposeAll(geos);
  return (
    <group position={RACKET_GRIP.position} rotation={RACKET_GRIP.rotation}>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g} material={mat} renderOrder={5} userData={{ noCast: true }} />
      ))}
    </group>
  );
}

interface KeysSketchProps {
  /** Number of white keys. Default 11. */
  keys?: number;
  /** Bench height. Default -0.49. */
  y?: number;
  /** When given, the key under the lowest pressing fingertip is filled in chalk. */
  handRef?: RefObject<HandHandle>;
}

const KEY_W = 0.19;
const KEY_Z = -1.75;
const KEY_D = 1.15;
const BLACK_AFTER = [0, 1, 3, 4, 5, 7, 8, 10, 11];

/** The keyboard drawn in chalk on the bench where <Keyboard /> would lie; a pressed key fills in. */
export function KeysSketch({ keys = 11, y = -0.49, handRef }: KeysSketchProps) {
  const mat = useChalk(0.85);
  const fillMat = useChalk(0.38);
  const built = useMemo(() => {
    const geos: BufferGeometry[] = [];
    const lines: Mesh[] = [];
    const top = y + 0.052;
    const half = ((keys - 1) / 2) * KEY_W;
    const x0 = -half - KEY_W / 2;
    const x1 = half + KEY_W / 2;
    const z0 = KEY_Z - KEY_D / 2;
    const z1 = KEY_Z + KEY_D / 2;
    const line = (a: [number, number, number], b: [number, number, number], r = LINE) => {
      const g = new TubeGeometry(stroke(a, b, 0.002), 6, r, 4, false);
      geos.push(g);
      lines.push(new Mesh(g, mat));
    };
    line([x0, top, z0], [x1, top, z0]);
    line([x0, top, z1], [x1, top, z1]);
    for (let i = 0; i <= keys; i++) {
      const x = x0 + i * KEY_W;
      line([x, top, z0], [x, top, z1], LINE * 0.8);
    }
    // Black keys as short outlined blocks at the back edge.
    BLACK_AFTER.filter((i) => i < keys - 1).forEach((i) => {
      const cx = (i - (keys - 1) / 2) * KEY_W + KEY_W / 2;
      const w = KEY_W * 0.28;
      const zb = KEY_Z - KEY_D / 2 + 0.7;
      line([cx - w, top + 0.002, z0], [cx - w, top + 0.002, zb], LINE * 0.7);
      line([cx + w, top + 0.002, z0], [cx + w, top + 0.002, zb], LINE * 0.7);
      line([cx - w, top + 0.002, zb], [cx + w, top + 0.002, zb], LINE * 0.7);
    });
    const fillGeo = new PlaneGeometry(KEY_W * 0.9, KEY_D * 0.96);
    fillGeo.rotateX(-Math.PI / 2);
    geos.push(fillGeo);
    const fill = new Mesh(fillGeo, fillMat);
    fill.visible = false;
    const xs = Array.from({ length: keys }, (_, i) => (i - (keys - 1) / 2) * KEY_W);
    const g = new Group();
    lines.forEach((m) => g.add(m));
    g.add(fill);
    g.traverse((o) => (o.userData.noCast = true));
    return { g, geos, fill, xs, top };
  }, [keys, y, mat, fillMat]);
  useDisposeAll(built.geos);

  const tmp = useRef(new Vector3());
  useFrame(() => {
    const h = handRef?.current;
    let idx = -1;
    if (h) {
      let lowest = Infinity;
      for (const f of FINGERS) {
        h.getTipWorld(f, tmp.current);
        if (tmp.current.y < y + 0.2 && tmp.current.y < lowest) {
          lowest = tmp.current.y;
          let best = -1;
          let bd = Infinity;
          built.xs.forEach((x, i) => {
            const d = Math.abs(x - tmp.current.x);
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          idx = best;
        }
      }
    }
    built.fill.visible = idx >= 0;
    if (idx >= 0) built.fill.position.set(built.xs[idx], built.top + 0.004, KEY_Z);
  });
  return <primitive object={built.g} />;
}

/** The ball as a chalk ring held between the thumb and index fingertips, turned to face the camera. */
export function BallSketch({ handRef }: { handRef: RefObject<HandHandle> }) {
  const mat = useChalk();
  const geo = useMemo(() => new TorusGeometry(0.11, LINE, 6, 40), []);
  useDisposeAll(useMemo(() => [geo], [geo]));
  const ring = useRef<Mesh>(null);
  const a = useMemo(() => new Vector3(), []);
  const b = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    const h = handRef.current;
    const m = ring.current;
    if (!m) return;
    m.visible = Boolean(h);
    if (!h) return;
    h.getTipWorld('thumb', a);
    h.getTipWorld('index', b);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.copy(camera.quaternion);
  });
  return <mesh ref={ring} geometry={geo} material={mat} renderOrder={5} userData={{ noCast: true }} />;
}

/**
 * The world-space chalk cue for a prop that is switched off: keys on the bench for the keyboard, a ring for the ball. The
 * racket's cue lives in hand space instead (<RacketSketch /> inside <Hand>). Renders nothing for 'none' and 'racket'.
 */
export function PropCue({ prop, hand, keys, y }: { prop: Prop; hand: RefObject<HandHandle>; keys?: number; y?: number }) {
  if (prop === 'keyboard') return <KeysSketch handRef={hand} keys={keys} y={y} />;
  if (prop === 'ball') return <BallSketch handRef={hand} />;
  return null;
}
