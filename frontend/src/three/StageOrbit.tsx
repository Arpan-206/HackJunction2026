import { createContext, useContext, useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { Spherical, Vector3 } from 'three';
import { prefersReducedMotion } from '../features/shared/settings';
import './stageOrbit.css';

type Vec3 = [number, number, number];

/** A camera view: where the camera stands and the point it turns round (and looks at). */
export interface OrbitView {
  position: Vec3;
  target: Vec3;
}

/** What the page (the Reset view button) and the scene (a framing camera) can ask of a stage's orbit. */
export interface OrbitRig {
  /** Back to the stage's default view: a short glide, or a jump with reduced motion. */
  reset: () => void;
  /** Put the camera on a view now. `asDefault` also re-centres the zoom and height limits on it. */
  place: (view: OrbitView, asDefault?: boolean) => void;
}

/**
 * The link between a canvas's orbit (inside the canvas) and what stands outside it (the Reset view button) or beside it
 * (a framing camera in the scene). `framing`, when a scene sets it, replaces the stage's fixed default view, for a
 * camera whose default moves (the practice stage's change from watching to trying).
 */
export interface OrbitLink {
  rig: OrbitRig | null;
  framing: (() => OrbitView) | null;
}

export const StageOrbitContext = createContext<OrbitLink | null>(null);

/** The orbit link of the canvas this component is in, or null outside one with an orbit. */
export function useStageOrbit(): OrbitLink | null {
  return useContext(StageOrbitContext);
}

const GLIDE_MS = 450;
/** The lowest the camera may go: this far above the bench, never under it. */
export const ORBIT_FLOOR_GAP = 0.12;
/** Zoom range, as a share of the default distance. */
const ZOOM_IN = 0.5;
const ZOOM_OUT = 1.7;

interface Glide {
  from: { s: Spherical; t: Vector3 };
  to: { s: Spherical; t: Vector3 };
  t0: number;
}

const sphericalOf = (position: Vector3, target: Vector3) => new Spherical().setFromVector3(position.clone().sub(target));

/** The short way round between two azimuths, however many turns the view has made. */
function shortTheta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

interface StageOrbitProps {
  /** The default view (a framing camera in the scene may replace it through the link). */
  position: Vec3;
  target: Vec3;
  /** The bench top: the camera stays ORBIT_FLOOR_GAP above it. */
  groundY: number;
  link?: OrbitLink;
  /** Whenever this changes (after the first render) the camera snaps back to the default view, as on a game's round start. */
  resetKey?: unknown;
}

/**
 * The orbit of every interactive stage: drag to turn all the way round (no azimuth limit), from straight overhead down
 * to just above the bench, wheel or pinch to zoom within limits, no pan. Opens on the stage's default view and returns
 * there on reset. A finger dragging across the stage turns it; a finger swiping up or down still scrolls the page
 * (touch-action pan-y), and once a sideways drag has started it can tilt the view too.
 */
export function StageOrbit({ position, target, groundY, link: given, resetKey }: StageOrbitProps) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const controls = useRef<OrbitControlsImpl>(null);
  const glide = useRef<Glide | null>(null);
  const own = useRef<OrbitLink>({ rig: null, framing: null });
  const link = given ?? own.current;
  const floorY = groundY + ORBIT_FLOOR_GAP;
  const reduced = prefersReducedMotion();

  const defaultView = (): OrbitView => link.framing?.() ?? { position, target };

  const place = (view: OrbitView, asDefault = true) => {
    const c = controls.current;
    camera.position.set(...view.position);
    camera.lookAt(...view.target);
    if (!c) return;
    c.target.set(...view.target);
    if (asDefault) {
      const d = Math.hypot(view.position[0] - view.target[0], view.position[1] - view.target[1], view.position[2] - view.target[2]) || 1;
      c.minDistance = d * ZOOM_IN;
      c.maxDistance = d * ZOOM_OUT;
      // Down to the bench at the default distance; a closer camera is held up by the floor below.
      const k = Math.max(-1, Math.min(1, (floorY - view.target[1]) / (d * ZOOM_IN)));
      c.maxPolarAngle = Math.max(0.3, Math.min(Math.PI - 0.1, Math.acos(k)));
    }
    c.update();
    invalidate();
  };

  link.rig = {
    place: (view, asDefault = true) => {
      glide.current = null;
      place(view, asDefault);
    },
    reset: () => {
      const to = defaultView();
      const c = controls.current;
      if (prefersReducedMotion() || !c) {
        glide.current = null;
        place(to);
        return;
      }
      const toT = new Vector3(...to.target);
      glide.current = {
        from: { s: sphericalOf(camera.position, c.target), t: c.target.clone() },
        to: { s: sphericalOf(new Vector3(...to.position), toT), t: toT },
        t0: performance.now(),
      };
      invalidate();
    },
  };

  // Open on the default view, and go back to it when the stage's default changes (another preset, a new framing).
  const viewKey = `${position.join(',')}|${target.join(',')}|${groundY}`;
  useLayoutEffect(() => {
    glide.current = null;
    place(defaultView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey, camera]);

  // A round starts: snap back to the default view.
  const firstReset = useRef(true);
  useLayoutEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    glide.current = null;
    place(defaultView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // OrbitControls claims every touch (touch-action none) when it connects: give vertical swipes back to the page.
  useEffect(() => {
    const el = controls.current?.domElement;
    if (el && el.style.touchAction !== 'pan-y') el.style.touchAction = 'pan-y';
  });

  useFrame(() => {
    const g = glide.current;
    const c = controls.current;
    if (g && c) {
      const k = Math.min(1, (performance.now() - g.t0) / GLIDE_MS);
      const e = 1 - Math.pow(1 - k, 3);
      const t = g.from.t.clone().lerp(g.to.t, e);
      const s = new Spherical(
        g.from.s.radius + (g.to.s.radius - g.from.s.radius) * e,
        g.from.s.phi + (g.to.s.phi - g.from.s.phi) * e,
        g.from.s.theta + shortTheta(g.from.s.theta, g.to.s.theta) * e,
      );
      const p = new Vector3().setFromSpherical(s).add(t);
      place({ position: [p.x, p.y, p.z], target: [t.x, t.y, t.z] }, k >= 1);
      if (k >= 1) glide.current = null;
      else invalidate();
    }
    if (camera.position.y < floorY && c) {
      camera.position.y = floorY;
      camera.lookAt(c.target);
    }
  });

  return <OrbitControls ref={controls} enablePan={false} enableDamping={!reduced} dampingFactor={0.08} rotateSpeed={0.6} minPolarAngle={0} />;
}

const ink = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** The small ink "Reset view" button in a corner of a stage: a turning arrow, named for screen readers and on hover. */
export function ResetViewButton({ onReset, corner = 'top-right' }: { onReset: () => void; corner?: ResetCorner }) {
  return (
    <button type="button" className={`stage-reset stage-reset--${corner}`} aria-label="Reset view" title="Reset view" onClick={onReset}>
      <svg viewBox="0 0 24 24" aria-hidden="true" {...ink}>
        <path d="M5 12a7 7 0 1 0 2.1-5" />
        <path d="M5 4v4h4" />
      </svg>
    </button>
  );
}

export type ResetCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
