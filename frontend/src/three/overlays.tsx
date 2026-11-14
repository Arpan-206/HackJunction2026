import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Group, InstancedMesh, Mesh, MeshBasicMaterial, Object3D, Quaternion, SphereGeometry, TorusGeometry, Vector3 } from 'three';
import type { Finger } from '../api/types';
import { FINGER_ORDER } from './anatomy';
import type { HandHandle } from './Hand';
import type { HandRig } from './handRig';
import { useStageColors } from './stageContext';

const ringGeo = new TorusGeometry(0.115, 0.0065, 6, 44);

interface JointRingsProps {
  /** Ref to a <Hand>. Rings follow the joints and always face the camera. */
  handRef: RefObject<HandHandle>;
  color?: string;
  opacity?: number;
  /** Uniform scale of the rings. */
  size?: number;
}

/** Leonardo-style construction rings drawn on every joint of a Hand, billboarded to the camera. */
export function JointRings({ handRef, color, opacity = 0.55, size = 1 }: JointRingsProps) {
  const stage = useStageColors();
  const mat = useMemo(() => new MeshBasicMaterial({ color: color ?? stage.ink, transparent: true, opacity }), [color, stage.ink, opacity]);
  const attached = useRef<{ rig: HandRig | null; rings: Mesh[] }>({ rig: null, rings: [] });
  const q = useRef(new Quaternion());

  const detach = () => {
    attached.current.rings.forEach((r) => r.parent?.remove(r));
    attached.current = { rig: null, rings: [] };
  };

  useEffect(() => detach, []);
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(({ camera }) => {
    const h = handRef.current;
    const st = attached.current;
    if (h?.rig !== st.rig || st.rings.some((r) => r.material !== mat)) {
      detach();
      if (h) {
        const rings: Mesh[] = [];
        h.rig.fingers.forEach((f) =>
          f.joints.forEach((j) => {
            const ring = new Mesh(ringGeo, mat);
            ring.scale.setScalar(size);
            j.add(ring);
            rings.push(ring);
          }),
        );
        attached.current = { rig: h.rig, rings };
      }
    }
    for (const r of attached.current.rings) {
      const parent = r.parent;
      if (!parent) continue;
      parent.getWorldQuaternion(q.current).invert();
      r.quaternion.copy(q.current).multiply(camera.quaternion);
    }
  });
  return null;
}

interface TrailsProps {
  handRef: RefObject<HandHandle>;
  /** Finger drawn in gold (the focus). Others use `color`. */
  focus?: Finger | null;
  color?: string;
  /** Number of dots per trail. */
  length?: number;
  /** Frames between samples; higher gives longer trails. */
  every?: number;
}

/** Chalk-dust fingertip trails: fading dots that follow each fingertip. Lives in the parent's space. */
export function FingertipTrails({ handRef, focus = null, color, length = 26, every = 2 }: TrailsProps) {
  const stage = useStageColors();
  const group = useRef<Group>(null);
  const mesh = useRef<InstancedMesh>(null);
  const hist = useMemo(() => new Float32Array(5 * length * 3), [length]);
  const filled = useRef(0);
  const tick = useRef(0);
  const tmp = useMemo(() => new Vector3(), []);
  const dummy = useMemo(() => new Object3D(), []);
  const col = useMemo(() => new Color(), []);
  const bg = useMemo(() => new Color(stage.background), [stage.background]);
  const tint = useMemo(() => new Color(color ?? stage.chalk), [color, stage.chalk]);
  const gold = useMemo(() => new Color(stage.gold), [stage.gold]);
  const geo = useMemo(() => new SphereGeometry(0.026, 8, 6), []);
  const mat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff' }), []);

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
    },
    [geo, mat],
  );

  useFrame(() => {
    const h = handRef.current;
    const g = group.current;
    const im = mesh.current;
    if (!h || !g || !im) return;
    tick.current += 1;
    if (tick.current % every === 0) {
      for (let f = 0; f < 5; f++) {
        const base = f * length * 3;
        hist.copyWithin(base + 3, base, base + (length - 1) * 3);
        h.rig.fingers[f].tip.getWorldPosition(tmp);
        g.worldToLocal(tmp);
        hist[base] = tmp.x;
        hist[base + 1] = tmp.y;
        hist[base + 2] = tmp.z;
      }
      filled.current = Math.min(length, filled.current + 1);
    }
    let n = 0;
    for (let f = 0; f < 5; f++) {
      const isFocus = focus !== null && FINGER_ORDER[f] === focus;
      for (let k = 0; k < filled.current; k++) {
        const a = 1 - k / length;
        const i3 = (f * length + k) * 3;
        dummy.position.set(hist[i3], hist[i3 + 1], hist[i3 + 2]);
        dummy.scale.setScalar(0.35 + 0.65 * a);
        dummy.updateMatrix();
        im.setMatrixAt(n, dummy.matrix);
        col.copy(bg).lerp(isFocus ? gold : tint, a * a);
        im.setColorAt(n, col);
        n += 1;
      }
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geo, mat, 5 * length]} frustumCulled={false} />
    </group>
  );
}
