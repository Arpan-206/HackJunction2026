import type { Side } from '../../../api';
import { PAIR_LIFT, type StageProps } from '../../../three';

/**
 * The cameras of the expert's stages (the scratch Record and Replay screens). Every view is a point on a sphere round the
 * hand: how far, how far round from straight behind the wrist (azimuth, in the hand's own frame, so a left hand gets the
 * mirror image), and how high (elevation). The training, test and lab stages keep their own cameras; nothing here
 * touches them.
 */
export interface ExpertCameraPreset {
  distance: number;
  /** Degrees round from straight behind the wrist; positive towards the little finger of a right hand. -180..180. */
  azimuthDeg: number;
  /** Degrees above the hand's level; 90 is straight overhead. */
  elevationDeg: number;
}

/**
 * The default view of each expert stage: the role select cards' first-person view (src/app/RoleSelect.tsx, CARD_*),
 * from behind and above the wrist. Change a default here, in one line (a pasted "Copy camera" `preset` fits as is).
 */
export const EXPERT_STAGE_CAMERA = {
  record: { distance: 5.8, azimuthDeg: 20, elevationDeg: 55 },
  recordBoth: { distance: 9.6, azimuthDeg: 0, elevationDeg: 55 },
  replayGhost: { distance: 5.8, azimuthDeg: 20, elevationDeg: 55 },
  replayStrings: { distance: 8.4, azimuthDeg: 20, elevationDeg: 42 },
} satisfies Record<string, ExpertCameraPreset>;

export type ExpertStageKey = keyof typeof EXPERT_STAGE_CAMERA;

/** The camera's field of view on these stages (HandCanvas). */
export const EXPERT_FOV = 30;

/**
 * The bench top under the hand: just below the curled fingertips (the side view shows them clear of it), higher than
 * Stage's -0.55 default so the hand rests close over its ring and reads as centred in it from the oblique first-person view.
 */
export const EXPERT_GROUND_Y = -0.42;
/** Aim a little below the palm, between hand and bench, so the hand and its ring share the middle of the frame. */
const AIM_Y = -0.2;
/** In the Strings view the expert's hand hangs above the wooden one (MASTER_LIFT): aim between them. */
const STRINGS_AIM_Y = 0.6;
/** Two hands on the Record stage: each hand's anchor this far either side of the centre (wide enough that they never meet). */
export const PAIR_HALF_GAP = 1.8;

/** Where a stage looks and what it draws on the bench, for a hands set-up. */
export interface ExpertFrame {
  key: ExpertStageKey;
  /** The orbit target: the middle of the hand, or between both hands. */
  target: [number, number, number];
  circleCenter: [number, number];
  circleRadius: number;
  shadowSize: [number, number];
  /** -1 for a left hand: azimuths are mirrored so "behind the wrist" is behind that hand. */
  mirror: 1 | -1;
}

/**
 * The frame of the Record stage (one hand on the stage anchor, or two at +-PAIR_HALF_GAP) or a Replay view (one hand on
 * the anchor). The orbit target is the anchor itself, which the shared hand layer makes the middle of the palm, so turning
 * the camera any way keeps the hand centred; two hands orbit round the point between them.
 */
export function expertFrame(stage: 'record' | 'replayGhost' | 'replayStrings', sides: Side[]): ExpertFrame {
  if (stage === 'record' && sides.length === 2) {
    return { key: 'recordBoth', target: [0, AIM_Y + PAIR_LIFT, 0], circleCenter: [0, 0], circleRadius: PAIR_HALF_GAP + 1.15, shadowSize: [2 * PAIR_HALF_GAP + 2.3, 2.8], mirror: 1 };
  }
  const mirror = sides[0] === 'left' ? -1 : 1;
  const y = stage === 'replayStrings' ? STRINGS_AIM_Y : AIM_Y;
  return { key: stage, target: [0, y, 0], circleCenter: [0, 0], circleRadius: 1.25, shadowSize: [2.4, 2.6], mirror };
}

const RAD = Math.PI / 180;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** -180..180, so a camera spun round any number of times still reads as one angle. */
export function normaliseDeg(deg: number): number {
  const d = (((deg + 180) % 360) + 360) % 360 - 180;
  return d === -180 ? 180 : d;
}

/** The camera position of a preset round a target, mirrored for a left hand. */
export function cameraFromPreset(p: ExpertCameraPreset, target: readonly [number, number, number], mirror: 1 | -1 = 1): [number, number, number] {
  const az = mirror * p.azimuthDeg * RAD;
  const el = p.elevationDeg * RAD;
  return [target[0] + p.distance * Math.sin(az) * Math.cos(el), target[1] + p.distance * Math.sin(el), target[2] + p.distance * Math.cos(az) * Math.cos(el)];
}

/** The preset that puts the camera where it is now, rounded to 3 decimals. */
export function presetFromCamera(position: readonly [number, number, number], target: readonly [number, number, number], mirror: 1 | -1 = 1): ExpertCameraPreset {
  const v = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
  const distance = Math.hypot(v[0], v[1], v[2]) || 1e-6;
  const elevationDeg = Math.asin(Math.max(-1, Math.min(1, v[1] / distance))) / RAD;
  const azimuthDeg = normaliseDeg((mirror * Math.atan2(v[0], v[2])) / RAD);
  return { distance: round3(distance), azimuthDeg: round3(azimuthDeg), elevationDeg: round3(elevationDeg) };
}

/** The three named views the stage offers beside the default, at the current default distance. */
export type ViewName = 'behind' | 'above' | 'side';

export function namedView(name: ViewName, base: ExpertCameraPreset): ExpertCameraPreset {
  if (name === 'above') return { distance: base.distance, azimuthDeg: 0, elevationDeg: 89 };
  // From the thumb side, a little above the bench.
  if (name === 'side') return { distance: base.distance, azimuthDeg: -90, elevationDeg: 14 };
  return base;
}

/** What "Copy camera" puts on the clipboard: `preset` is exactly an EXPERT_STAGE_CAMERA entry, `key` says which. */
export interface CameraSnapshot {
  stage: 'record' | 'replay';
  hand: 'right' | 'left' | 'both';
  key: ExpertStageKey;
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  distance: number;
  azimuthDeg: number;
  elevationDeg: number;
  preset: ExpertCameraPreset;
}

export function cameraSnapshot(frame: ExpertFrame, sides: Side[], position: readonly [number, number, number], target: readonly [number, number, number], fov: number): CameraSnapshot {
  const preset = presetFromCamera(position, target, frame.mirror);
  return {
    stage: frame.key.startsWith('record') ? 'record' : 'replay',
    hand: sides.length === 2 ? 'both' : sides[0] === 'left' ? 'left' : 'right',
    key: frame.key,
    position: [round3(position[0]), round3(position[1]), round3(position[2])],
    target: [round3(target[0]), round3(target[1]), round3(target[2])],
    fov: round3(fov),
    ...preset,
    preset,
  };
}

/** Lowest the camera may go: a little above the bench, never under it. */
export const CAMERA_FLOOR = EXPERT_GROUND_Y + 0.12;

/** The stage of an expert view: the bench under the hand, the circle round it and the camera at its default. */
export function expertStage(frame: ExpertFrame): StageProps {
  const preset = EXPERT_STAGE_CAMERA[frame.key];
  return {
    controls: 'none',
    groundY: EXPERT_GROUND_Y,
    circleCenter: frame.circleCenter,
    circleRadius: frame.circleRadius,
    shadowSize: frame.shadowSize,
    target: frame.target,
    cameraPosition: cameraFromPreset(preset, frame.target, frame.mirror),
  };
}
