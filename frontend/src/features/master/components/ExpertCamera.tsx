import { useCallback, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { PerspectiveCamera } from 'three';
import type { Side } from '../../../api';
import { isDev } from '../../apprentice/pipeline/flags';
import { prefersReducedMotion } from '../../shared/settings';
import { CAMERA_FLOOR, cameraFromPreset, cameraSnapshot, EXPERT_FOV, namedView, normaliseDeg, presetFromCamera, type CameraSnapshot, type ExpertCameraPreset, type ExpertFrame, type ViewName } from './cameraPresets';

/** What the overlay buttons can ask of the camera inside the canvas. */
export interface CameraRigHandle {
  goTo: (p: ExpertCameraPreset) => void;
  snapshot: () => CameraSnapshot | null;
}

const GLIDE_MS = 450;

interface Glide {
  from: ExpertCameraPreset;
  to: ExpertCameraPreset;
  t0: number;
}

/**
 * The camera of an expert stage, inside its canvas: orbit all the way round the hand (no azimuth limit) from straight
 * overhead down to just above the bench, zoom within limits, no pan. The orbit target is the middle of the hand (or of
 * both hands), so turning keeps it centred. It opens on the stage's default view, jumps there again when the hands set-up
 * changes, and glides to a named view when the overlay asks (a jump with reduced motion). The camera never goes under
 * the bench.
 */
export function ExpertCameraRig({ frame, sides, preset, rig }: { frame: ExpertFrame; sides: Side[]; preset: ExpertCameraPreset; rig: MutableRefObject<CameraRigHandle | null> }) {
  const camera = useThree((s) => s.camera);
  const controls = useRef<OrbitControlsImpl>(null);
  const glide = useRef<Glide | null>(null);
  const { target, mirror } = frame;

  const place = useCallback(
    (p: ExpertCameraPreset) => {
      camera.position.set(...cameraFromPreset(p, target, mirror));
      camera.lookAt(...target);
      controls.current?.target.set(...target);
      controls.current?.update();
    },
    [camera, target, mirror],
  );

  const placeKey = `${target.join(',')}|${mirror}|${preset.distance},${preset.azimuthDeg},${preset.elevationDeg}`;
  useLayoutEffect(() => {
    glide.current = null;
    place(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey]);

  rig.current = {
    goTo: (p) => {
      const now = presetFromCamera(camera.position.toArray(), target, mirror);
      if (prefersReducedMotion()) {
        glide.current = null;
        place(p);
      } else glide.current = { from: now, to: p, t0: performance.now() };
    },
    snapshot: () => {
      const t = controls.current?.target.toArray() ?? target;
      return cameraSnapshot(frame, sides, camera.position.toArray(), t, camera instanceof PerspectiveCamera ? camera.fov : EXPERT_FOV);
    },
  };

  useFrame(() => {
    const g = glide.current;
    if (g) {
      const k = Math.min(1, (performance.now() - g.t0) / GLIDE_MS);
      const e = 1 - Math.pow(1 - k, 3);
      // The short way round, however far the expert has spun the view.
      const dAz = normaliseDeg(g.to.azimuthDeg - g.from.azimuthDeg);
      place({
        distance: g.from.distance + (g.to.distance - g.from.distance) * e,
        azimuthDeg: g.from.azimuthDeg + dAz * e,
        elevationDeg: g.from.elevationDeg + (g.to.elevationDeg - g.from.elevationDeg) * e,
      });
      if (k >= 1) glide.current = null;
    }
    if (camera.position.y < CAMERA_FLOOR) {
      camera.position.y = CAMERA_FLOOR;
      camera.lookAt(...target);
    }
  });

  return (
    <OrbitControls
      ref={controls}
      target={target}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      minDistance={preset.distance * 0.5}
      maxDistance={preset.distance * 1.7}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2 + 0.04}
    />
  );
}

const ink = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** Small ink drawings for the view buttons: an eye behind a hand, an eye over the bench, an eye level with it, a turn. */
const ICONS: Record<ViewName | 'reset', JSX.Element> = {
  behind: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ink}>
      <path d="M8 13V6.5a1.3 1.3 0 0 1 2.6 0V11m0-5.5a1.3 1.3 0 0 1 2.6 0V11m0-4.2a1.3 1.3 0 0 1 2.6 0V12c0 2.6-1.8 4-4.2 4H11c-1.6 0-2.4-.7-3.3-2L6 11.3a1.2 1.2 0 0 1 2-1.2" />
      <path d="M8.5 20.5c1-1 2.2-1.5 3.5-1.5s2.5.5 3.5 1.5" />
    </svg>
  ),
  above: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ink}>
      <path d="M12 3v9M8.5 8.5 12 12l3.5-3.5" />
      <ellipse cx="12" cy="17.5" rx="8" ry="3" />
    </svg>
  ),
  side: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ink}>
      <path d="M3 12c2-3 4.5-4.5 7-4.5S15 9 17 12c-2 3-4.5 4.5-7 4.5S5 15 3 12z" />
      <circle cx="10" cy="12" r="1.8" />
      <path d="M21 5v14" />
    </svg>
  ),
  reset: (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...ink}>
      <path d="M5 12a7 7 0 1 0 2.1-5" />
      <path d="M5 4v4h4" />
    </svg>
  ),
};

const LABELS: Record<ViewName | 'reset', string> = { behind: 'Behind the hand', above: 'From above', side: 'From the side', reset: 'Reset view' };

/**
 * The view buttons over a corner of an expert stage, as small ink drawings with their names for screen readers and on
 * hover. In dev mode (?dev=1) a "Copy camera" button puts the current view on the clipboard as JSON, in the shape
 * EXPERT_STAGE_CAMERA takes, so a good angle can become the default.
 */
export function CameraControls({ rig, base }: { rig: MutableRefObject<CameraRigHandle | null>; base: ExpertCameraPreset }) {
  const [copied, setCopied] = useState(false);
  const dev = isDev();
  const go = (name: ViewName | 'reset') => rig.current?.goTo(name === 'reset' ? base : namedView(name, base));
  const copy = () => {
    const snap = rig.current?.snapshot();
    if (!snap) return;
    const json = JSON.stringify(snap, null, 2);
    console.log(`[expert camera] ${json}`);
    void navigator.clipboard?.writeText(json).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  return (
    <>
      <div className="cam-views" role="group" aria-label="Camera">
        {(['behind', 'above', 'side', 'reset'] as const).map((v) => (
          <button key={v} type="button" className="cam-views__btn" aria-label={LABELS[v]} title={LABELS[v]} onClick={() => go(v)}>
            {ICONS[v]}
          </button>
        ))}
      </div>
      {dev && (
        <div className="cam-dev">
          <button type="button" className="cam-dev__btn" onClick={copy}>
            Copy camera
          </button>
          {copied && (
            <span className="cam-dev__note" role="status">
              Copied
            </span>
          )}
        </div>
      )}
    </>
  );
}

/** A rig handle for one stage: the canvas fills it in, the overlay calls it. */
export function useCameraRig() {
  return useRef<CameraRigHandle | null>(null);
}
