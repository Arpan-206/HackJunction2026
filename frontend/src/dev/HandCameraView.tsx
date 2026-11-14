import { useEffect, useMemo, useRef, useState, type ComponentRef, type MutableRefObject } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { PerspectiveCamera, type Camera } from 'three';
import { HandCanvas, Hand, synthFrame, type HandHandle } from '../three';
import type { Side } from '../api/types';
import { isDev } from '../features/apprentice/pipeline/flags';
import {
  CARD_AIM_Y,
  CARD_AZIMUTH,
  CARD_CAMERA,
  CARD_DISTANCE,
  CARD_ELEVATION,
  CARD_MOTION,
  CARD_STAGE,
  CardRing,
  CardSway,
  HandStrings,
  cardTime,
} from '../app/RoleSelect';
import './handCamera.css';

/**
 * Dev only (/dev/hand-camera): the role select card scene on one big stage with a free camera, so the card camera can be
 * found by eye and handed over as numbers. Drag to orbit (full turn), wheel or pinch to zoom, right drag or shift drag to
 * pan. "Copy camera" puts a JSON snapshot plus a block shaped like RoleSelect's CARD_* constants on the clipboard.
 */

type Vec3 = [number, number, number];
type Who = 'expert' | 'apprentice' | 'both';

export interface CameraSnapshot {
  position: Vec3;
  target: Vec3;
  fov: number;
  distance: number;
  /** Degrees around the target, -180..180, measured like CARD_AZIMUTH (0 looks along -z, from +z). */
  azimuth: number;
  /** Degrees above the target's horizontal plane, like CARD_ELEVATION. */
  elevation: number;
  hand: Side;
  aspect: number;
}

const CARD_TARGET: Vec3 = [0, CARD_AIM_Y, 0];
/**
 * The card canvases are mid-sized, so HandCanvas gives them the image light but not the still-life props (quality
 * 'low'); this stage is larger and would get the props, so pin the card's set dressing.
 */
const STAGE = { ...CARD_STAGE, decor: true, quality: 'low' as const };
/** The role cards' static hand yaw (RoleSelect passes rotation [0, 0.1, 0] to both card hands); a left hand mirrors it. */
const CARD_HAND_YAW = 0.1;
const MIN_DISTANCE = 1.2;
const MAX_DISTANCE = 18;
/** Lowest camera: level with the target, which sits 0.48 above the bench. Highest: straight overhead. */
const MAX_POLAR = Math.PI / 2;
const MIN_POLAR = 0.001;
/**
 * The role card's stage box, width over height, for the "Card frame" toggle: 2.05 in a 1920 x 960 window (a 1080p
 * screen less the browser bar). It varies with the window (1.56 at a full 1920 x 1080, 2.2 at 1280 x 720), so the
 * aspect is editable.
 */
const DEFAULT_CARD_ASPECT = 2.05;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const deg = (rad: number) => (rad * 180) / Math.PI;
const wrapDeg = (d: number) => {
  const w = ((((d + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};

/** Distance, azimuth and elevation of a camera position around a target, in RoleSelect's convention. */
function spherical(pos: Vec3, target: Vec3) {
  const dx = pos[0] - target[0];
  const dy = pos[1] - target[1];
  const dz = pos[2] - target[2];
  const distance = Math.hypot(dx, dy, dz);
  return {
    distance,
    azimuth: wrapDeg(deg(Math.atan2(dx, dz))),
    elevation: deg(Math.asin(Math.max(-1, Math.min(1, dy / (distance || 1))))),
  };
}

function fromSpherical(distance: number, azimuthDeg: number, elevationDeg: number, target: Vec3): Vec3 {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [
    target[0] + distance * Math.sin(az) * Math.cos(el),
    target[1] + distance * Math.sin(el),
    target[2] + distance * Math.cos(az) * Math.cos(el),
  ];
}

/** The block to paste over RoleSelect's camera constants. */
export function roleSelectBlock(s: CameraSnapshot): string {
  const lines = [
    `export const CARD_AIM_Y = ${r3(s.target[1])};`,
    `export const CARD_DISTANCE = ${r3(s.distance)};`,
    `export const CARD_AZIMUTH = (${r3(s.azimuth)} * Math.PI) / 180;`,
    `export const CARD_ELEVATION = (${r3(s.elevation)} * Math.PI) / 180;`,
  ];
  if (Math.abs(s.target[0]) > 0.0005 || Math.abs(s.target[2]) > 0.0005) {
    lines.push(
      `// Panned off the ring column: target x = ${r3(s.target[0])}, z = ${r3(s.target[2])}. RoleSelect aims at (0, CARD_AIM_Y, 0),`,
      `// so add these to CARD_CAMERA and AimAtHand's lookAt, or reset the pan.`,
    );
  }
  lines.push(`// fov ${r3(s.fov)}, ${s.hand} hand, read at canvas aspect ${r3(s.aspect)}`);
  return lines.join('\n');
}

/** What the clipboard gets: the JSON snapshot, a blank line, then the RoleSelect block. */
export function snapshotText(s: CameraSnapshot): string {
  return `${JSON.stringify(s, null, 2)}\n\n// RoleSelect.tsx\n${roleSelectBlock(s)}\n`;
}

/**
 * Reads a pasted snapshot: the JSON (alone or with the RoleSelect block after it), or the RoleSelect block alone
 * (target x and z then default to 0). Returns null when nothing usable is found.
 */
export function parseSnapshot(text: string): Pick<CameraSnapshot, 'position' | 'target'> & { fov?: number; hand?: Side } | null {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(text.slice(a, b + 1)) as Partial<CameraSnapshot>;
      const ok = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
      const target = ok(j.target) ? j.target : CARD_TARGET;
      let position: Vec3 | null = ok(j.position) ? j.position : null;
      if (!position && typeof j.distance === 'number' && typeof j.azimuth === 'number' && typeof j.elevation === 'number') {
        position = fromSpherical(j.distance, j.azimuth, j.elevation, target);
      }
      if (position) return { position, target, fov: typeof j.fov === 'number' ? j.fov : undefined, hand: j.hand === 'left' || j.hand === 'right' ? j.hand : undefined };
    } catch {
      /* not JSON; try the constants block */
    }
  }
  const num = (name: string, deg: boolean) => {
    const m = deg
      ? new RegExp(`${name}\\s*=\\s*\\(\\s*(-?[\\d.]+)\\s*\\*\\s*Math\\.PI\\s*\\)\\s*/\\s*180`).exec(text)
      : new RegExp(`${name}\\s*=\\s*(-?[\\d.]+)`).exec(text);
    return m ? Number(m[1]) : null;
  };
  const d = num('CARD_DISTANCE', false);
  const az = num('CARD_AZIMUTH', true);
  const el = num('CARD_ELEVATION', true);
  if (d === null || az === null || el === null) return null;
  const target: Vec3 = [0, num('CARD_AIM_Y', false) ?? CARD_AIM_Y, 0];
  return { position: fromSpherical(d, az, el, target), target };
}

interface CameraApi {
  read: () => CameraSnapshot;
  apply: (position: Vec3, target: Vec3, fov?: number) => void;
}

type Controls = ComponentRef<typeof OrbitControls>;

/** Inside the main canvas: exposes the camera to the overlay and writes the live readout without re-rendering React. */
function CameraBridge({
  api,
  controls,
  leader,
  readout,
  hand,
}: {
  api: MutableRefObject<CameraApi | null>;
  controls: MutableRefObject<Controls | null>;
  leader: MutableRefObject<Camera | null>;
  readout: MutableRefObject<HTMLDivElement | null>;
  hand: Side;
}) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const last = useRef('');
  leader.current = camera;

  useEffect(() => {
    api.current = {
      read: () => {
        const c = controls.current;
        const target: Vec3 = c ? [c.target.x, c.target.y, c.target.z] : CARD_TARGET;
        const position: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
        const sph = spherical(position, target);
        return {
          position: position.map(r3) as Vec3,
          target: target.map(r3) as Vec3,
          fov: r3((camera as PerspectiveCamera).fov),
          distance: r3(sph.distance),
          azimuth: r3(sph.azimuth),
          elevation: r3(sph.elevation),
          hand,
          aspect: r3(size.width / Math.max(1, size.height)),
        };
      },
      apply: (position, target, fov) => {
        const c = controls.current;
        if (fov && camera instanceof PerspectiveCamera && Math.abs(camera.fov - fov) > 1e-6) {
          camera.fov = fov;
          camera.updateProjectionMatrix();
        }
        camera.position.set(...position);
        if (c) {
          c.target.set(...target);
          c.update();
        } else {
          camera.lookAt(...target);
        }
        invalidate();
      },
    };
  }, [api, camera, controls, hand, invalidate, size.height, size.width]);

  useFrame(() => {
    const el = readout.current;
    const c = controls.current;
    if (!el || !c) return;
    const sph = spherical([camera.position.x, camera.position.y, camera.position.z], [c.target.x, c.target.y, c.target.z]);
    const text = `distance ${sph.distance.toFixed(2)}   azimuth ${sph.azimuth.toFixed(1)}°   elevation ${sph.elevation.toFixed(1)}°`;
    if (text !== last.current) {
      last.current = text;
      el.textContent = text;
    }
  });
  return null;
}

/** In the second canvas of "Both": copies the main canvas camera every frame, so the two hands share one view. */
function FollowCamera({ leader }: { leader: MutableRefObject<Camera | null> }) {
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const l = leader.current;
    if (!l) return;
    camera.position.copy(l.position);
    camera.quaternion.copy(l.quaternion);
    if (l instanceof PerspectiveCamera && camera instanceof PerspectiveCamera && camera.fov !== l.fov) {
      camera.fov = l.fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

/** One card hand: the same props as the role select cards, with a pausable clock and a choice of side. */
function CardHand({ who, side, time }: { who: 'expert' | 'apprentice'; side: Side; time: () => number }) {
  const ref = useRef<HandHandle>(null);
  const getFrame = useMemo(() => () => synthFrame(CARD_MOTION, time(), side), [time, side]);
  const yaw = side === 'left' ? -CARD_HAND_YAW : CARD_HAND_YAW;
  return (
    <>
      <CardRing />
      <CardSway time={time}>
        <Hand key={side} ref={ref} side={side} style={who === 'expert' ? 'chalk' : 'wood'} getFrame={getFrame} smoothing={false} rotation={[0, yaw, 0]} />
      </CardSway>
      {who === 'apprentice' && <HandStrings hand={ref} />}
    </>
  );
}

export default function HandCameraView() {
  if (!isDev()) return <Navigate replace to="/" />;
  return <HandCameraStage />;
}

function HandCameraStage() {
  const [who, setWho] = useState<Who>('apprentice');
  const [side, setSide] = useState<Side>('right');
  const [paused, setPaused] = useState(false);
  const [cardFrame, setCardFrame] = useState(false);
  const [cardAspect, setCardAspect] = useState(DEFAULT_CARD_ASPECT);
  const [note, setNote] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const api = useRef<CameraApi | null>(null);
  const controls = useRef<Controls | null>(null);
  const leader = useRef<Camera | null>(null);
  const readout = useRef<HTMLDivElement | null>(null);
  const noteTimer = useRef<number | undefined>(undefined);

  // The card clock, pausable: paused, it holds the moment it was paused at; resumed, it carries on from there.
  const clock = useRef({ paused: false, frozen: 0, offset: 0 });
  const time = useMemo(() => () => (clock.current.paused ? clock.current.frozen : cardTime() - clock.current.offset), []);
  const togglePause = () => {
    const c = clock.current;
    if (c.paused) {
      c.offset = cardTime() - c.frozen;
      c.paused = false;
    } else {
      c.frozen = cardTime() - c.offset;
      c.paused = true;
    }
    setPaused(c.paused);
  };

  useEffect(() => () => window.clearTimeout(noteTimer.current), []);
  const flash = (msg: string) => {
    setNote(msg);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 2500);
  };

  const copy = async () => {
    const snap = api.current?.read();
    if (!snap) return;
    const text = snapshotText(snap);
    console.log('[hand-camera]', JSON.stringify(snap));
    console.log(`[hand-camera] RoleSelect block:\n${roleSelectBlock(snap)}`);
    try {
      await navigator.clipboard.writeText(text);
      flash('Copied');
    } catch {
      setPaste(text);
      flash('Clipboard blocked: the snapshot is in the box below and the console');
    }
  };

  const reset = () => {
    api.current?.apply(CARD_CAMERA, CARD_TARGET, 30);
    flash('Back to the current card camera');
  };

  const applyPaste = () => {
    const s = parseSnapshot(paste);
    if (!s) {
      flash('No camera found in that text');
      return;
    }
    if (s.hand) setSide(s.hand);
    api.current?.apply(s.position, s.target, s.fov);
    flash('Applied');
  };

  const stageStyle = cardFrame ? { aspectRatio: String(cardAspect) } : undefined;
  const hands: ('expert' | 'apprentice')[] = who === 'both' ? ['expert', 'apprentice'] : [who];

  return (
    <div className="handcam">
      <div className={`handcam__stages${cardFrame ? ' handcam__stages--card' : ''}`}>
        {hands.map((h, i) => (
          <div key={i} className="handcam__stage" style={stageStyle} data-testid={i === 0 ? 'handcam-stage' : undefined}>
            <HandCanvas preset="closeup" stage={STAGE} label={i === 0 ? 'Hand camera stage: drag to orbit, wheel to zoom, right drag to pan' : undefined}>
              {i === 0 ? (
                <>
                  <OrbitControls
                    ref={controls}
                    target={CARD_TARGET}
                    enableDamping
                    dampingFactor={0.12}
                    minDistance={MIN_DISTANCE}
                    maxDistance={MAX_DISTANCE}
                    minPolarAngle={MIN_POLAR}
                    maxPolarAngle={MAX_POLAR}
                    rotateSpeed={0.8}
                  />
                  <CameraBridge api={api} controls={controls} leader={leader} readout={readout} hand={side} />
                </>
              ) : (
                <FollowCamera leader={leader} />
              )}
              <CardHand who={h} side={side} time={time} />
            </HandCanvas>
          </div>
        ))}
      </div>

      <section className="handcam__panel" aria-label="Hand camera controls">
        <h1 className="handcam__title">Hand camera view</h1>
        <div className="handcam__group" role="group" aria-label="Hand">
          {(['expert', 'apprentice', 'both'] as const).map((w) => (
            <button key={w} type="button" className="handcam__btn" aria-pressed={who === w} onClick={() => setWho(w)}>
              {w === 'expert' ? 'Expert hand' : w === 'apprentice' ? 'Apprentice hand' : 'Both'}
            </button>
          ))}
        </div>
        <div className="handcam__group" role="group" aria-label="Side">
          {(['right', 'left'] as const).map((s) => (
            <button key={s} type="button" className="handcam__btn" aria-pressed={side === s} onClick={() => setSide(s)}>
              {s === 'right' ? 'Right' : 'Left'}
            </button>
          ))}
        </div>
        <div className="handcam__group">
          <button type="button" className="handcam__btn" onClick={togglePause}>
            {paused ? 'Play motion' : 'Pause motion'}
          </button>
          <button type="button" className="handcam__btn" onClick={reset}>
            Reset to current default
          </button>
        </div>
        <div className="handcam__group">
          <button type="button" className="handcam__btn" aria-pressed={cardFrame} onClick={() => setCardFrame((v) => !v)}>
            Card frame
          </button>
          <label className="handcam__aspect">
            aspect
            <input type="number" min="0.5" max="4" step="0.05" value={cardAspect} onChange={(e) => setCardAspect(Math.max(0.5, Math.min(4, Number(e.target.value) || DEFAULT_CARD_ASPECT)))} />
          </label>
        </div>
        <div className="handcam__group">
          <button type="button" className="handcam__btn handcam__btn--main" onClick={copy}>
            Copy camera
          </button>
          {note && (
            <span className="handcam__note" role="status">
              {note}
            </span>
          )}
        </div>
        <label className="handcam__paste">
          Paste camera
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} spellCheck={false} placeholder="Paste a snapshot or the CARD_* block" />
        </label>
        <div className="handcam__group">
          <button type="button" className="handcam__btn" onClick={applyPaste} disabled={!paste.trim()}>
            Apply pasted camera
          </button>
          <Link to="/" className="handcam__btn">
            Role select
          </Link>
        </div>
        <p className="handcam__help">Drag to orbit, wheel or pinch to zoom, right drag or shift drag to pan.</p>
      </section>

      <div ref={readout} className="handcam__readout" data-testid="handcam-readout" aria-live="off">
        distance {CARD_DISTANCE.toFixed(2)}   azimuth {deg(CARD_AZIMUTH).toFixed(1)}&deg;   elevation {deg(CARD_ELEVATION).toFixed(1)}&deg;
      </div>
    </div>
  );
}
