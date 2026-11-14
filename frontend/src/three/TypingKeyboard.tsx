import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BoxGeometry, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshToonMaterial, PlaneGeometry, SRGBColorSpace, type Material } from 'three';
import { toonGradient } from './materials';
import { useStageColors } from './stageContext';
import { BENCH_Y, KEY_PITCH, KEYBOARD_BOUNDS, KEYTOP_Y, keyCenter, SPACE, TYPING_ROWS } from './typingLayout';

/**
 * A QWERTY computer keyboard on the bench, for touch typing. Solid (with "Add a prop"): ivory keycaps on a dark case with
 * inked letters. Otherwise sketched in chalk on the walnut, as every prop is when props are off. One key can be lit as the
 * next one to strike (a chalk wash, or a shadow on a solid key) and one washed in malachite after a right-finger strike.
 * Nothing here judges anything; the gloves never know which key a finger reached.
 */

interface TypingKeyboardProps {
  /** Draw the solid keyboard; otherwise the chalk sketch. */
  solid?: boolean;
  /** The key to strike next (a character, ' ' for the space bar). */
  target?: string | null;
  /** A key just struck with the right finger, washed in malachite. */
  good?: string | null;
  /** Read every frame instead of `target`: the key a drill is striking now. */
  getTarget?: () => string | null;
}

const CAP = KEY_PITCH * 0.88;
const PX = 520; // canvas pixels per scene unit

interface Drawn {
  key: string;
  x: number;
  z: number;
  w: number;
}

function allKeys(): Drawn[] {
  const out: Drawn[] = [];
  for (const r of TYPING_ROWS)
    for (const k of r.keys) {
      const c = keyCenter(k) as [number, number];
      out.push({ key: k, x: c[0], z: c[1], w: CAP });
    }
  out.push({ key: ' ', x: SPACE.x, z: SPACE.z, w: SPACE.width - (KEY_PITCH - CAP) });
  return out;
}

/** Draws the keys' letters (and, for the chalk sketch, their outlines) onto a canvas covering the keyboard. */
function paint(canvas: HTMLCanvasElement, keys: Drawn[], ink: string, outlines: boolean): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { x0, z0 } = KEYBOARD_BOUNDS;
  const px = (x: number) => (x - x0) * PX;
  const pz = (z: number) => (z - z0) * PX;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const half = (CAP / 2) * PX;
  for (const k of keys) {
    const cx = px(k.x);
    const cz = pz(k.z);
    const hw = (k.w / 2) * PX;
    if (outlines) {
      ctx.lineWidth = 5;
      ctx.beginPath();
      // A slightly wobbly hand-drawn box, as chalk on wood.
      const j = (n: number) => Math.sin(n * 12.9898 + cx * 0.01) * 2.2;
      ctx.moveTo(cx - hw + j(1), cz - half + j(2));
      ctx.lineTo(cx + hw + j(3), cz - half + j(4));
      ctx.lineTo(cx + hw + j(5), cz + half + j(6));
      ctx.lineTo(cx - hw + j(7), cz + half + j(8));
      ctx.closePath();
      ctx.stroke();
    }
    if (k.key !== ' ') {
      ctx.font = `600 ${Math.round(half * 1.05)}px "Alegreya Sans", "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(k.key.toUpperCase(), cx, cz + 2);
    }
    if (k.key === 'f' || k.key === 'j') {
      // The bump on F and J that the index fingers find without looking.
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(cx - half * 0.32, cz + half * 0.7);
      ctx.lineTo(cx + half * 0.32, cz + half * 0.7);
      ctx.stroke();
    }
  }
}

function useKeyTexture(keys: Drawn[], ink: string, outlines: boolean): CanvasTexture | null {
  const tex = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const { x0, x1, z0, z1 } = KEYBOARD_BOUNDS;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((x1 - x0) * PX);
    canvas.height = Math.round((z1 - z0) * PX);
    paint(canvas, keys, ink, outlines);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }, [keys, ink, outlines]);
  useEffect(() => {
    if (!tex) return;
    let live = true;
    // Repaint once the UI font has loaded, so the letters match the rest of the screen.
    void document.fonts?.ready.then(() => {
      if (!live) return;
      paint(tex.image as HTMLCanvasElement, keys, ink, outlines);
      tex.needsUpdate = true;
    });
    return () => {
      live = false;
      tex.dispose();
    };
  }, [tex, keys, ink, outlines]);
  return tex;
}

/** A flat wash over one key: the named key, or each frame the key `getKey` returns (no React renders at frame rate). */
function KeyWash({ keyName, getKey, color, opacity, y }: { keyName?: string | null; getKey?: () => string | null; color: string; opacity: number; y: number }) {
  const mesh = useRef<Mesh>(null);
  const geo = useMemo(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const mat = useMemo(() => new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), [color, opacity]);
  useEffect(() => () => geo.dispose(), [geo]);
  useEffect(() => () => mat.dispose(), [mat]);
  const place = (m: Mesh, key: string | null | undefined) => {
    const at = key ? keyCenter(key) : null;
    m.visible = Boolean(at);
    if (!at) return;
    m.position.set(at[0], y, at[1]);
    m.scale.set(key === ' ' ? SPACE.width - (KEY_PITCH - CAP) : CAP, 1, CAP);
  };
  useFrame(() => {
    if (mesh.current) place(mesh.current, getKey ? getKey() : keyName);
  });
  return <mesh ref={mesh} geometry={geo} material={mat} visible={false} renderOrder={6} userData={{ noCast: true }} />;
}

export function TypingKeyboard({ solid = false, target = null, good = null, getTarget }: TypingKeyboardProps) {
  const stage = useStageColors();
  const keys = useMemo(allKeys, []);
  const tex = useKeyTexture(keys, solid ? '#23252e' : stage.chalk, !solid);
  const { x0, x1, z0, z1 } = KEYBOARD_BOUNDS;
  const plane = useMemo(() => new PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), [x0, x1, z0, z1]);
  const letters = useMemo(() => new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: solid ? 1 : 0.9 }), [tex, solid]);
  useEffect(() => () => plane.dispose(), [plane]);
  useEffect(() => () => letters.dispose(), [letters]);

  const caps = useMemo(() => {
    if (!solid) return null;
    const g = new Group();
    const ivory = new MeshToonMaterial({ color: '#f3efe6', gradientMap: toonGradient() });
    const caseMat = new MeshToonMaterial({ color: '#2b2d36', gradientMap: toonGradient() });
    const owned: (BoxGeometry | Material)[] = [ivory, caseMat];
    const h = 0.06;
    for (const k of keys) {
      const geo = new BoxGeometry(k.w, h, CAP);
      owned.push(geo);
      const m = new Mesh(geo, ivory);
      m.position.set(k.x, KEYTOP_Y - h / 2, k.z);
      g.add(m);
    }
    const caseGeo = new BoxGeometry(x1 - x0 + 0.08, 0.05, z1 - z0 - 0.1);
    owned.push(caseGeo);
    const base = new Mesh(caseGeo, caseMat);
    base.position.set((x0 + x1) / 2, KEYTOP_Y - 0.075, (z0 + z1) / 2 - 0.02);
    g.add(base);
    return { g, owned };
  }, [solid, keys, x0, x1, z0, z1]);
  useEffect(() => () => caps?.owned.forEach((o) => o.dispose()), [caps]);

  const top = solid ? KEYTOP_Y + 0.002 : BENCH_Y + 0.006;
  const cue = useMemo(() => new Color(solid ? stage.ink : stage.chalk).getStyle(), [solid, stage.ink, stage.chalk]);
  return (
    <group>
      {caps && <primitive object={caps.g} />}
      {tex && <mesh geometry={plane} material={letters} position={[(x0 + x1) / 2, top + 0.001, (z0 + z1) / 2]} renderOrder={5} userData={{ noCast: true }} />}
      <KeyWash keyName={target} getKey={getTarget} color={cue} opacity={solid ? 0.28 : 0.4} y={top} />
      <KeyWash keyName={good} color={stage.malachite} opacity={0.6} y={top + 0.002} />
    </group>
  );
}

