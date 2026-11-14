import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import type { Finger, HandFrame, MotionSpec, Side } from '../api/types';
import { CODEX_STAGE, CastShadows, CodexSet, KeyLight, Stage, synthFrame, type CodexSetProps, type HandHandle } from '../three';
import { FINGER_ORDER } from '../three/anatomy';
import { StageColorsContext } from '../three/stageContext';
import { THEMES } from '../theme/themes';

/** True when the page was opened with ?freeze=1 (screenshots): every pose holds its design moment. */
export const FROZEN = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('freeze') === '1';

/** A getFrame driver for <Hand>: plays the motion live, or holds time `t0` when frozen. */
export function play(spec: MotionSpec, t0: number, side: Side = 'right', lag = 0): (t: number) => HandFrame {
  return (t) => synthFrame(spec, FROZEN ? t0 - lag : t + t0 - lag, side);
}

/** Projected screen points of 3D anchors, written every frame and read by the HTML leader layer. */
export class AnchorBoard {
  getters = new Map<string, (out: Vector3) => Vector3 | null>();
  points = new Map<string, { x: number; y: number }>();
  set(id: string, get: (out: Vector3) => Vector3 | null): this {
    this.getters.set(id, get);
    return this;
  }
}

export type JointRef = Finger | 'wrist' | `${Finger}:${0 | 1 | 2}`;

/** An anchor getter on a hand: a fingertip, one finger joint (0 knuckle, 1 middle, 2 last) or the back of the wrist. */
export function onHand(hand: RefObject<HandHandle>, at: JointRef): (out: Vector3) => Vector3 | null {
  return (out) => {
    const h = hand.current;
    if (!h) return null;
    if (at === 'wrist') return h.rig.root.localToWorld(out.set(0, 0.12, -0.05));
    const [name, k] = at.split(':') as [Finger, string | undefined];
    const f = h.rig.fingers[FINGER_ORDER.indexOf(name)];
    if (k === undefined) return f.tip.getWorldPosition(out);
    return f.joints[Number(k)].getWorldPosition(out);
  };
}

function Projector({ board }: { board: AnchorBoard }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new Vector3(), []);
  useFrame(() => {
    board.getters.forEach((get, id) => {
      if (!get(v)) return;
      v.project(camera);
      board.points.set(id, { x: ((v.x + 1) / 2) * size.width, y: ((1 - v.y) / 2) * size.height });
    });
  });
  return null;
}

export interface SceneProps {
  world: 'codex' | 'bench';
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
  board?: AnchorBoard;
  codex?: CodexSetProps;
  /** Bench options: construction circle radius and centre, ground height. */
  bench?: { circle?: number; circleCenter?: [number, number]; groundY?: number; showShadow?: boolean; props?: boolean };
  orbit?: boolean;
  label: string;
  className?: string;
  children?: ReactNode;
}

/**
 * One WebGL canvas for a design frame. codex: transparent canvas over the page parchment with the study sheet, warm key
 * light and hatched shadows. bench: the learner's walnut bench and plaster wall from the app Stage, plus a shadow light.
 */
export function SceneCanvas({ world, position, target, fov = 30, board, codex, bench, orbit = true, label, className, children }: SceneProps) {
  const colors = world === 'codex' ? CODEX_STAGE : THEMES.bottega.stage;
  const [epoch, setEpoch] = useState(0);
  return (
    <div className={className} role="img" aria-label={label} style={{ position: 'absolute', inset: 0 }}>
      <Canvas
        key={epoch}
        shadows
        flat
        dpr={[1, 2]}
        camera={{ position, fov, near: 0.1, far: 80 }}
        gl={{ antialias: true, stencil: true, alpha: world === 'codex', preserveDrawingBuffer: true }}
        onCreated={({ gl, camera, size }) => {
          // A tall phone stage pulls the camera back, so the hand leaves room for the notes above it.
          if (size.width / size.height < 0.9) {
            const t = new Vector3(...target);
            camera.position.sub(t).multiplyScalar(1.45).add(t);
          }
          camera.lookAt(...target);
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            window.setTimeout(() => setEpoch((n) => n + 1), 250);
          });
        }}
        style={{ touchAction: 'pan-y' }}
      >
        <StageColorsContext.Provider value={colors}>
          {world === 'codex' ? (
            <CodexSet {...codex} />
          ) : (
            <>
              <Stage
                groundY={bench?.groundY ?? -0.55}
                showCircle={(bench?.circle ?? 1) > 0}
                circleRadius={bench?.circle ?? 1.6}
                circleCenter={bench?.circleCenter ?? [0, -0.5]}
                showShadow={bench?.showShadow ?? true}
                controls="none"
                target={target}
                cameraPosition={position}
                decor
                quality={bench?.props === false ? 'low' : 'high'}
              />
              <KeyLight position={[-2.2, 6, 3.4]} intensity={0.9} color="#FFE9CC" span={5} />
              <CastShadows />
            </>
          )}
          {orbit && !FROZEN && <OrbitControls target={target} enablePan={false} enableZoom={false} minPolarAngle={0.3} maxPolarAngle={1.35} rotateSpeed={0.5} />}
          {board && <Projector board={board} />}
          <Suspense fallback={null}>{children}</Suspense>
        </StageColorsContext.Provider>
      </Canvas>
    </div>
  );
}

/** Re-renders a component at a slow rate, for countdowns in the design frames. Frozen pages never tick. */
export function useTicker(ms: number): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (FROZEN) return;
    const id = window.setInterval(() => setN((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return n;
}

/** A ref that stays the same object for the component lifetime. */
export function useBoard(): AnchorBoard {
  const r = useRef<AnchorBoard | null>(null);
  if (!r.current) r.current = new AnchorBoard();
  return r.current;
}
