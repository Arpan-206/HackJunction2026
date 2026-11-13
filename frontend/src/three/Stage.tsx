import { Suspense, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { CanvasTexture, Group, Vector3 } from 'three';
import { useTheme } from '../theme';
import { StageColorsContext, useStageColors } from './stageContext';

export type CameraPreset = 'single' | 'pair' | 'racket' | 'keyboard' | 'closeup';

interface PresetDef {
  groundY: number;
  position: [number, number, number];
  target: [number, number, number];
  circle: number;
  circleCenter: [number, number];
  shadow: [number, number];
}

const z = (k: number): [number, number, number] => [1.9 * k, 2.7 * k, 2.4 * k];

/** Camera and stage layout per scene type, tuned for one or two hands at about 3 m on a projector. */
export const PRESETS: Record<CameraPreset, PresetDef> = {
  single: { groundY: -0.55, position: z(1.0), target: [0, -0.12, -0.62], circle: 1.55, circleCenter: [0, -0.5], shadow: [2.4, 2.6] },
  pair: { groundY: -0.55, position: z(1.7), target: [0, -0.12, -0.62], circle: 2.6, circleCenter: [0, -0.5], shadow: [5, 2.6] },
  racket: { groundY: -0.95, position: z(1.35), target: [-0.35, -0.12, -0.62], circle: 1.9, circleCenter: [-0.3, -0.5], shadow: [3.4, 2.8] },
  keyboard: { groundY: -0.55, position: z(1.4), target: [0, -0.12, -1.25], circle: 2.1, circleCenter: [0, -1.2], shadow: [3, 3] },
  closeup: { groundY: -0.55, position: z(0.85), target: [0, -0.1, -0.6], circle: 1.2, circleCenter: [0, -0.5], shadow: [1.8, 2] },
};

export interface StageProps {
  /** Table height; the grid, circle and contact shadow sit here. Default -0.55. */
  groundY?: number;
  showGrid?: boolean;
  showCircle?: boolean;
  showShadow?: boolean;
  /** Radius of the construction circle. Defaults from the preset. */
  circleRadius?: number;
  /** Centre of the construction circle on the ground (x, z). */
  circleCenter?: [number, number];
  shadowSize?: [number, number];
  /** limited: orbit within a safe window (no pan, little zoom). none: fixed camera. */
  controls?: 'limited' | 'none';
  /** Orbit target. */
  target?: [number, number, number];
  /** Camera start position, used to centre the azimuth window. */
  cameraPosition?: [number, number, number];
}

function blobTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d') as CanvasRenderingContext2D;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(20,24,40,0.5)');
  g.addColorStop(1, 'rgba(20,24,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(c);
}

/** The 3D set: carta azzurra background, lights, drafting grid, construction circle, contact shadow and orbit controls. */
export function Stage({
  groundY = -0.55,
  showGrid = true,
  showCircle = true,
  showShadow = true,
  circleRadius = 1.55,
  circleCenter = [0, -0.5],
  shadowSize = [2.4, 2.6],
  controls = 'limited',
  target = [0, -0.12, -0.62],
  cameraPosition = [1.9, 2.7, 2.4],
}: StageProps) {
  const s = useStageColors();
  const blob = useMemo(() => blobTexture(), []);
  const az = Math.atan2(cameraPosition[0] - target[0], cameraPosition[2] - target[2]);
  const dist = new Vector3(...cameraPosition).distanceTo(new Vector3(...target));
  const circlePts = useMemo(() => {
    const pts: number[] = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      pts.push(Math.cos(a) * circleRadius, 0, Math.sin(a) * circleRadius);
    }
    return new Float32Array(pts);
  }, [circleRadius]);

  return (
    <>
      <color attach="background" args={[s.background]} />
      <hemisphereLight args={[s.skyLight, s.groundLight, 1.5]} />
      <directionalLight position={[-2, 4, 3]} intensity={1.5} />
      <directionalLight position={[3, 2, -2]} intensity={0.5} />

      {showGrid && <gridHelper args={[9, 36, s.grid, s.grid]} position={[0, groundY, 0]} material-transparent material-opacity={s.gridOpacity} material-depthWrite={false} />}
      {showCircle && (
        <lineLoop position={[circleCenter[0], groundY + 0.002, circleCenter[1]]}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[circlePts, 3]} />
          </bufferGeometry>
          <lineBasicMaterial color={s.circle} transparent opacity={0.55} />
        </lineLoop>
      )}
      {showShadow && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[circleCenter[0], groundY + 0.004, circleCenter[1] - 0.05]}>
          <planeGeometry args={shadowSize} />
          <meshBasicMaterial map={blob} transparent depthWrite={false} />
        </mesh>
      )}
      {controls === 'limited' && (
        <OrbitControls
          target={target}
          enablePan={false}
          enableDamping
          dampingFactor={0.08}
          minDistance={dist * 0.7}
          maxDistance={dist * 1.25}
          minPolarAngle={0.25}
          maxPolarAngle={1.42}
          minAzimuthAngle={az - 0.85}
          maxAzimuthAngle={az + 0.85}
          rotateSpeed={0.6}
        />
      )}
    </>
  );
}

function Sway({ amount, children }: { amount: number; children: ReactNode }) {
  const g = useRef<Group>(null);
  useFrame((st) => {
    if (g.current) g.current.rotation.y = Math.sin(st.clock.elapsedTime * 0.25) * amount;
  });
  return <group ref={g}>{children}</group>;
}

export interface HandCanvasProps {
  preset?: CameraPreset;
  /** Overrides for the stage; unspecified values come from the preset. */
  stage?: StageProps;
  /** Slow turntable sway of the contents in radians; 0 disables. Default 0. */
  sway?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible description; the canvas is otherwise hidden from assistive tech. */
  label?: string;
  children?: ReactNode;
}

/**
 * Canvas + theme bridge + Stage in one. Put <Hand>, <Racket>, <Keyboard> as children. Fills its parent, so give the
 * parent a size.
 */
export function HandCanvas({ preset = 'single', stage, sway = 0, className, style, label, children }: HandCanvasProps) {
  const { stage: colors } = useTheme();
  const p = PRESETS[preset];
  const cam = stage?.cameraPosition ?? p.position;
  const content = sway ? <Sway amount={sway}>{children}</Sway> : children;
  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <Canvas
        flat
        dpr={[1, 2]}
        camera={{ position: cam, fov: 30, near: 0.1, far: 80 }}
        gl={{ antialias: true, stencil: true, alpha: false }}
        style={{ touchAction: 'pan-y' }}
      >
        <StageColorsContext.Provider value={colors}>
          <Stage
            groundY={stage?.groundY ?? p.groundY}
            showGrid={stage?.showGrid}
            showCircle={stage?.showCircle}
            showShadow={stage?.showShadow}
            circleRadius={stage?.circleRadius ?? p.circle}
            circleCenter={stage?.circleCenter ?? p.circleCenter}
            shadowSize={stage?.shadowSize ?? p.shadow}
            controls={stage?.controls}
            target={stage?.target ?? p.target}
            cameraPosition={cam}
          />
          <Suspense fallback={null}>{content}</Suspense>
        </StageColorsContext.Provider>
      </Canvas>
    </div>
  );
}
