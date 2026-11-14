import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { BackSide, BoxGeometry, BufferGeometry, Color, CylinderGeometry, Euler, Group, Mesh, MeshBasicMaterial, MeshToonMaterial, TorusGeometry, Vector3 } from 'three';
import type { HandHandle } from './Hand';
import { toonGradient } from './materials';
import { Optional } from './atmosphere';
import { useStageColors } from './stageContext';
import { createMarbleMaterial } from './surfaces';

/** Polished marble slab under the keyboard. Falls back to nothing if the textures cannot load. */
function MarbleBase({ y, width }: { y: number; width: number }) {
  const mat = useMemo(() => createMarbleMaterial('#e6e0d6', [width / 2, 0.8]), [width]);
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh position={[0, y - 0.08, -1.75]} material={mat}>
      <boxGeometry args={[width + 0.4, 0.07, 1.5]} />
    </mesh>
  );
}

function inflate(geo: BufferGeometry, amount: number): BufferGeometry {
  const g = geo.clone();
  g.computeVertexNormals();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * amount, p.getY(i) + n.getY(i) * amount, p.getZ(i) + n.getZ(i) * amount);
  return g;
}

const toon = (color: string) => new MeshToonMaterial({ color, gradientMap: toonGradient() });

function inked(parent: Group, geo: BufferGeometry, mat: MeshToonMaterial, line: MeshBasicMaterial, amount: number): Mesh {
  const m = new Mesh(geo, mat);
  parent.add(m);
  parent.add(new Mesh(inflate(geo, amount), line));
  return m;
}

/**
 * A table-tennis racket in hand space (handle across the palm, blade towards the thumb side). Mount it as a child
 * of <Hand> so it follows the wrist: `<Hand><Racket /></Hand>`.
 */
/**
 * Where the racket sits in hand space: the handle lies in the tunnel the curled fingers make in the grip pose,
 * diagonally across the palm from under the index knuckle to the base of the little finger, as a shakehand grip holds
 * it. Shared by <Racket /> and its chalk outline.
 */
export const RACKET_GRIP = { position: [0, -0.4, -0.92] as [number, number, number], rotation: [0, -0.45, 0.05, 'YXZ'] as [number, number, number, 'YXZ'] };
/** The blade's centre in hand space (the blade is a disc at x = -1.2 along the racket's own axis). */
export const RACKET_BLADE = new Vector3(-1.2, 0, 0).applyEuler(new Euler(...RACKET_GRIP.rotation)).add(new Vector3(...RACKET_GRIP.position));

export function Racket({ rubber = '#7a2a22' }: { rubber?: string }) {
  const stage = useStageColors();
  const group = useMemo(() => {
    const g = new Group();
    const line = new MeshBasicMaterial({ color: stage.ink, side: BackSide });
    const wood = toon('#c89b62');
    const band = toon('#8a5a2b');
    const red = toon(rubber);
    const black = toon('#23252e');

    const handle = new CylinderGeometry(0.108, 0.118, 1.0, 20);
    handle.rotateZ(Math.PI / 2);
    inked(g, handle, wood, line, 0.012);

    for (const x of [0.12, 0.26, 0.4]) {
      const ring = new TorusGeometry(0.114, 0.012, 8, 28);
      ring.rotateY(Math.PI / 2);
      ring.translate(x, 0, 0);
      g.add(new Mesh(ring, band));
    }
    const knob = new CylinderGeometry(0.15, 0.15, 0.05, 20);
    knob.rotateZ(Math.PI / 2);
    knob.translate(0.52, 0, 0);
    inked(g, knob, wood, line, 0.012);

    const neck = new CylinderGeometry(0.1, 0.108, 0.22, 16);
    neck.rotateZ(Math.PI / 2);
    neck.translate(-0.6, 0, 0);
    inked(g, neck, wood, line, 0.012);

    const core = new CylinderGeometry(0.6, 0.6, 0.05, 48);
    core.rotateX(Math.PI / 2);
    core.translate(-1.2, 0, 0);
    inked(g, core, wood, line, 0.012);
    const faceA = new CylinderGeometry(0.62, 0.62, 0.018, 48);
    faceA.rotateX(Math.PI / 2);
    faceA.translate(-1.2, 0, 0.034);
    g.add(new Mesh(faceA, red));
    const faceB = new CylinderGeometry(0.62, 0.62, 0.018, 48);
    faceB.rotateX(Math.PI / 2);
    faceB.translate(-1.2, 0, -0.034);
    g.add(new Mesh(faceB, black));

    g.position.set(...RACKET_GRIP.position);
    g.rotation.set(...RACKET_GRIP.rotation);
    return g;
  }, [stage.ink, rubber]);

  useEffect(
    () => () =>
      group.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          (o.material as MeshToonMaterial).dispose();
        }
      }),
    [group],
  );
  return <primitive object={group} />;
}

interface KeyboardProps {
  /** Number of white keys. Default 11. */
  keys?: number;
  /** Table surface height. Default -0.49. */
  y?: number;
  /** When given, the key under the lowest pressing fingertip lights in gold. */
  handRef?: RefObject<HandHandle>;
  /** Fixed highlighted key index, overrides tracking. */
  activeKey?: number | null;
}

const BLACK_AFTER = [0, 1, 3, 4, 5, 7, 8, 10, 11];

/** A paper-piano keyboard laid on the table, with optional fingertip key highlighting. */
export function Keyboard({ keys = 11, y = -0.49, handRef, activeKey = null }: KeyboardProps) {
  const stage = useStageColors();
  const w = 0.19;
  const built = useMemo(() => {
    const g = new Group();
    const line = new MeshBasicMaterial({ color: stage.ink, side: BackSide });
    const whiteBase = new Color('#f6f3ec');
    const blackMat = toon('#23252e');
    const list: { x: number; mat: MeshToonMaterial }[] = [];
    for (let i = 0; i < keys; i++) {
      const mat = toon('#f6f3ec');
      const geo = new BoxGeometry(w * 0.94, 0.1, 1.15);
      const x = (i - (keys - 1) / 2) * w;
      geo.translate(x, y, -1.75);
      inked(g, geo, mat, line, 0.008);
      list.push({ x, mat });
    }
    BLACK_AFTER.filter((i) => i < keys - 1).forEach((i) => {
      const geo = new BoxGeometry(w * 0.55, 0.12, 0.7);
      geo.translate((i - (keys - 1) / 2) * w + w / 2, y + 0.07, -1.98);
      g.add(new Mesh(geo, blackMat));
    });
    return { g, list, whiteBase };
  }, [keys, y, stage.ink]);

  const gold = useMemo(() => new Color(stage.gold), [stage.gold]);
  const tmp = useRef(new Vector3());
  const lastIdx = useRef(-2);

  useFrame(() => {
    let idx = activeKey ?? -1;
    const h = handRef?.current;
    if (activeKey === null && h) {
      let lowest = Infinity;
      for (const f of h.rig.fingers) {
        f.tip.getWorldPosition(tmp.current);
        if (tmp.current.y < y + 0.2 && tmp.current.y < lowest) {
          lowest = tmp.current.y;
          let best = -1;
          let bd = Infinity;
          built.list.forEach((k, i) => {
            const d = Math.abs(k.x - tmp.current.x);
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          idx = best;
        }
      }
    }
    if (idx === lastIdx.current) return;
    lastIdx.current = idx;
    built.list.forEach((k, i) => k.mat.color.copy(i === idx ? gold : built.whiteBase));
  });

  return (
    <>
      <primitive object={built.g} />
      <Optional>
        <Suspense fallback={null}>
          <MarbleBase y={y} width={keys * w} />
        </Suspense>
      </Optional>
    </>
  );
}
