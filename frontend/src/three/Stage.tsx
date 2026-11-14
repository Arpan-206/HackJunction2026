import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Group, Vector3 } from 'three';
import { useTheme } from '../theme';
import { BackdropProps, WorkshopLight, type StageQuality } from './atmosphere';
import { Sketchbook, type SheetRect } from './sketchbook';
import { StageAnchorContext, StageColorsContext, useStageColors } from './stageContext';

export type CameraPreset = 'single' | 'pair' | 'racket' | 'keyboard' | 'closeup';

interface PresetDef {
  groundY: number;
  position: [number, number, number];
  target: [number, number, number];
  circle: number;
  circleCenter: [number, number];
  shadow: [number, number];
  /** Hands are centred on the ring (see Hand). False where hands are registered to a prop by the wrist (racket, keys). */
  centreHands: boolean;
}

const z = (k: number): [number, number, number] => [1.9 * k, 2.7 * k, 2.4 * k];

/** Camera and stage layout per scene type, tuned for one or two hands at about 3 m on a projector. */
export const PRESETS: Record<CameraPreset, PresetDef> = {
  single: { groundY: -0.55, position: z(1.0), target: [0, -0.12, -0.62], circle: 1.55, circleCenter: [0, -0.5], shadow: [2.4, 2.6], centreHands: true },
  pair: { groundY: -0.55, position: z(1.7), target: [0, -0.12, -0.62], circle: 2.6, circleCenter: [0, -0.5], shadow: [5, 2.6], centreHands: true },
  racket: { groundY: -0.95, position: z(1.35), target: [-0.35, -0.12, -0.62], circle: 1.9, circleCenter: [-0.3, -0.5], shadow: [3.4, 2.8], centreHands: false },
  keyboard: { groundY: -0.55, position: z(1.4), target: [0, -0.12, -1.25], circle: 2.1, circleCenter: [0, -1.2], shadow: [3, 3], centreHands: false },
  closeup: { groundY: -0.55, position: z(0.85), target: [0, -0.1, -0.6], circle: 1.2, circleCenter: [0, -0.5], shadow: [1.8, 2], centreHands: true },
};

export interface StageProps {
  /** Height of the paper; the grid, circle and hatched shadow sit here. Default -0.55. */
  groundY?: number;
  showGrid?: boolean;
  showCircle?: boolean;
  showShadow?: boolean;
  /** Radius of the construction circle. Defaults from the preset. */
  circleRadius?: number;
  /** Centre of the construction circle on the ground (x, z). */
  circleCenter?: readonly [number, number];
  shadowSize?: readonly [number, number];
  /** limited: orbit within a safe window (no pan, little zoom). none: fixed camera. */
  controls?: 'limited' | 'none';
  /** Orbit target. */
  target?: [number, number, number];
  /** Camera start position, used to centre the azimuth window. */
  cameraPosition?: [number, number, number];
  /**
   * Set dressing: the workshop image light (it gives the wooden hand its sheen) and, at 'high' quality, the still-life
   * props at the back of the sheet. The sketchbook paper, grid and hatched shadow are drawn either way. Default true;
   * small previews pass false to stay light.
   */
  decor?: boolean;
  /** 'high' (default) adds the still-life props; 'low' keeps the paper and light only. */
  quality?: StageQuality;
}

/**
 * The 3D set: a sketchbook page with a parchment study sheet (fine ink grid, double ruled border), the construction
 * circle in ink, the hands' shadows hatched in iron-gall ink, lights and orbit controls.
 */
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
  decor = true,
  quality = 'high',
}: StageProps) {
  const s = useStageColors();
  const az = Math.atan2(cameraPosition[0] - target[0], cameraPosition[2] - target[2]);
  const dist = new Vector3(...cameraPosition).distanceTo(new Vector3(...target));
  const [ccx, ccz] = circleCenter;
  const circleGeo = useMemo(() => {
    const loop: number[] = [];
    for (let i = 0; i <= 160; i++) {
      // A hand-drawn circle: the radius breathes a little, as a compass on soft paper does.
      const a = (i / 160) * Math.PI * 2;
      const r = circleRadius * (1 + 0.006 * Math.sin(a * 3 + 0.4));
      loop.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    }
    // Construction ticks across the circle at its four quarters, like the marks of a compass setting out.
    const ticks: number[] = [];
    const t = Math.min(0.12, circleRadius * 0.08);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const c = Math.cos(a);
      const n = Math.sin(a);
      ticks.push(c * (circleRadius - t), 0, n * (circleRadius - t), c * (circleRadius + t), 0, n * (circleRadius + t));
    }
    return { loop: new Float32Array(loop), ticks: new Float32Array(ticks) };
  }, [circleRadius]);
  // The study sheet: wide enough to frame the circle with a margin, deeper towards the back where the props stand.
  const sheet = useMemo<SheetRect>(() => {
    const w = Math.max(5.2, circleRadius * 2 + 2.6);
    const d = Math.max(3.9, circleRadius * 2 + 1.5);
    return { cx: ccx, cz: ccz - 0.35, w, d };
  }, [circleRadius, ccx, ccz]);

  return (
    <>
      <hemisphereLight args={[s.skyLight, s.groundLight, 1.5]} />
      <directionalLight position={[3, 2, -2]} intensity={0.5} color={s.keyLight} />
      {decor && <WorkshopLight stage={s} />}
      <Sketchbook stage={s} groundY={groundY} sheet={sheet} grid={showGrid} shadow={showShadow} blobCenter={circleCenter} blobSize={shadowSize} />
      {decor && quality === 'high' && <BackdropProps y={groundY} cx={ccx} backZ={sheet.cz - sheet.d / 2 + 0.25} halfWidth={sheet.w / 2 - 0.8} />}
      {showCircle && (
        <group position={[ccx, groundY + 0.002, ccz]} userData={{ noCast: true }}>
          <lineLoop>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[circleGeo.loop, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={s.circle} transparent opacity={0.45} />
          </lineLoop>
          <lineSegments>
            <bufferGeometry>
              <bufferAttribute attach="attributes-position" args={[circleGeo.ticks, 3]} />
            </bufferGeometry>
            <lineBasicMaterial color={s.circle} transparent opacity={0.3} />
          </lineSegments>
        </group>
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
  /** 'demand' renders only when something invalidates, for static or rarely changing scenes. Default 'always'. */
  frameloop?: 'always' | 'demand';
  /** Skip the sketchbook stage (lights, paper, orbit): the children bring their own set, as the shadow theatre does. */
  bare?: boolean;
  /**
   * Turn on the renderer's shadow maps (PCF) for a bare canvas whose set has a shadow-casting light. A canvas with the
   * sketchbook stage always has them, for the hatched hand shadows.
   */
  shadows?: boolean;
  children?: ReactNode;
}

/**
 * Canvas + theme bridge + Stage in one. Put <Hand>, <Racket>, <Keyboard> as children. Fills its parent, so give the
 * parent a size.
 */
export function HandCanvas({ preset = 'single', stage, sway = 0, className, style, label, frameloop = 'always', bare = false, shadows = false, children }: HandCanvasProps) {
  const { stage: colors } = useTheme();
  const [epoch, setEpoch] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setSize([Math.round(e.contentRect.width), Math.round(e.contentRect.height)]));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A canvas scrolled out of view is never presented, so nothing paces its render loop: the browser runs it as fast as
  // the script allows and the GPU queue grows without bound (on a software GPU a few seconds of it take half a minute
  // to drain, and the drain blocks the page when the canvas unmounts and loses its context). Pause the loop while the
  // canvas is out of view; it keeps its last frame and resumes when it scrolls back.
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin: '64px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  // Small canvases skip the set dressing; mid-sized ones get the image light but not the model props.
  const sizeKnown = size !== null;
  const autoDecor = !sizeKnown || size[0] >= 300;
  const autoQuality: StageQuality = !sizeKnown || (size[0] >= 760 && size[1] >= 540) ? 'high' : 'low';
  const p = PRESETS[preset];
  const cam = stage?.cameraPosition ?? p.position;
  const circleAt = stage?.circleCenter ?? p.circleCenter;
  const content = sway ? <Sway amount={sway}>{children}</Sway> : children;
  return (
    <div ref={box} className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <Canvas
        key={epoch}
        frameloop={inView ? frameloop : 'never'}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            window.setTimeout(() => setEpoch((n) => n + 1), 250);
          });
        }}
        flat
        shadows={shadows || !bare ? 'percentage' : false}
        dpr={[1, 2]}
        camera={{ position: cam, fov: 30, near: 0.1, far: 80 }}
        gl={{ antialias: true, stencil: true, alpha: false }}
        style={{ touchAction: 'pan-y' }}
      >
        <StageColorsContext.Provider value={colors}>
          <StageAnchorContext.Provider value={!bare && p.centreHands ? circleAt : null}>
          {!bare && <Stage
            groundY={stage?.groundY ?? p.groundY}
            showGrid={stage?.showGrid}
            showCircle={stage?.showCircle}
            showShadow={stage?.showShadow}
            circleRadius={stage?.circleRadius ?? p.circle}
            circleCenter={circleAt}
            shadowSize={stage?.shadowSize ?? p.shadow}
            controls={stage?.controls}
            target={stage?.target ?? p.target}
            cameraPosition={cam}
            decor={stage?.decor ?? autoDecor}
            quality={stage?.quality ?? autoQuality}
          />}
          <Suspense fallback={null}>{content}</Suspense>
          </StageAnchorContext.Provider>
        </StageColorsContext.Provider>
      </Canvas>
    </div>
  );
}
