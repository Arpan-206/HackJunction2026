import type {
  CalibrationQuality,
  DriftCheckResult,
  DriftHand,
  Finger,
  GloveDeviceStatus,
  GloveIssue,
  GloveRigStatus,
  GloveSensorName,
  GloveSource,
  JointTriple,
  NeutralHand,
  Side,
  WearerCalibration,
} from '../api/types';
import { getHub } from './glove';

/**
 * Mock mode's stand-in for the real-glove routes (backend/app/services/rig). The status is simulated: both gloves over
 * USB at the driver's 83 frames a second, unless a scenario asks for a problem, so every fix step can be seen without
 * hardware. Pick one with `?mockGloves=<scenario>` (remembered for the tab; `?mockGloves=ready` goes back).
 * The fix-step rules and wording are a port of backend/app/services/rig/diagnosis.py; keep them in step.
 * Neutral captures and the drift check read the mock glove stream, exactly as the backend reads the live one.
 */

export const MOCK_GLOVE_SCENARIOS = ['ready', 'no_driver', 'studio', 'busy', 'no_usb', 'one_glove', 'low_fps', 'saturated', 'not_streaming', 'no_frames', 'drift'] as const;
export type MockGloveScenario = (typeof MOCK_GLOVE_SCENARIOS)[number];

const SCENARIO_KEY = 'apprentice.mockGloves';
const FINGERS: Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];
const SENSORS: GloveSensorName[] = ['thumb', 'index', 'middle', 'ring', 'little', 'arm', 'hub'];
const DEVICE_IDS: Record<Side, number> = { left: 1572077328, right: 2811174587 };

/* Mirrors of backend/app/constants.py. */
export const DRIFT_MAX_FLEX_DEG = 8;
export const DRIFT_MAX_YAW_DEG = 15;
const GLOVE_MIN_DRIVER_FPS = 75;
const GLOVE_MIN_STREAM_FPS = 40;
const GLOVE_STALE_FRAME_MS = 250;
const QUALITY = { noiseGood: 1, noiseFair: 3, biasGood: 22, biasFair: 32 };
const NEUTRAL_MIN_FRAMES = 10;
const DEG = 180 / Math.PI;

/** The scenario for this tab: the URL wins and is remembered, then the remembered one, then 'ready'. */
export function mockGloveScenario(): MockGloveScenario {
  const isScenario = (v: string | null): v is MockGloveScenario => !!v && (MOCK_GLOVE_SCENARIOS as readonly string[]).includes(v);
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('mockGloves');
    if (isScenario(fromUrl)) {
      window.sessionStorage.setItem(SCENARIO_KEY, fromUrl);
      return fromUrl;
    }
    const saved = window.sessionStorage.getItem(SCENARIO_KEY);
    if (isScenario(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return 'ready';
}

let driverStarted = false;

/** POST /gloves/driver in mock mode: starting fixes the 'no_driver' scenario, stopping brings it back. */
export function mockDriverAction(action: 'start' | 'stop'): void {
  driverStarted = action === 'start';
}

function sensors(saturated: Partial<Record<GloveSensorName, string[]>> = {}): GloveDeviceStatus['sensors'] {
  return SENSORS.map((name) => ({ name, saturated: saturated[name] ?? [] }));
}

function glove(side: Side, over: Partial<GloveDeviceStatus> = {}): GloveDeviceStatus {
  return {
    side,
    connected: true,
    device_id: DEVICE_IDS[side],
    connection: 'usb',
    fps: 60,
    driver_fps: 83.3,
    streaming: true,
    last_frame_age_ms: 9 + Math.round(Math.random() * 8),
    battery_pct: null,
    heading_reliable: true,
    sensors: sensors(),
    ...over,
  };
}

const offline = (side: Side): GloveDeviceStatus => glove(side, { connected: false, device_id: null, connection: null, fps: null, driver_fps: null, streaming: null, last_frame_age_ms: null, heading_reliable: null });

interface Snapshot {
  source: GloveSource;
  studio: boolean;
  driverUp: boolean;
  solverUp: boolean;
  rcsp: boolean;
  canStart: boolean;
  gloves: GloveDeviceStatus[];
  lines: string[];
}

const other = (s: Side): Side => (s === 'left' ? 'right' : 'left');

/** Port of diagnosis.diagnose(): the fix steps, most important first. */
export function diagnoseRig(s: Snapshot): GloveIssue[] {
  const issues: GloveIssue[] = [];
  const start = s.canStart ? 'Press Start the gloves, or run' : 'Run';
  const has = (patterns: string[]) => s.lines.some((l) => patterns.some((p) => l.toLowerCase().includes(p)));
  if (s.studio) issues.push({ code: 'studio_running', side: null, blocking: true, title: 'Rokoko Studio is open', fix: "Close Rokoko Studio. It holds the gloves' USB connection, so the glove driver cannot open them. Then press Check again." });
  if (has(['access is denied', 'device busy', 'resource busy', 'being used by another process']))
    issues.push({ code: 'device_busy', side: null, blocking: true, title: 'The driver cannot open the gloves (Access is denied)', fix: 'Another program holds the USB devices, usually Rokoko Studio. Close Studio, unplug and replug both gloves, then start the gloves again.' });
  if (!s.driverUp) {
    issues.push({ code: 'driver_not_running', side: null, blocking: true, title: 'The glove driver is not running', fix: `${start} \`rokoko-sdk --auto-stream-usb\` in a terminal.` });
    return issues;
  }
  if (!s.solverUp) issues.push({ code: 'solver_not_running', side: null, blocking: true, title: 'The hand solver is not running', fix: `${start} \`rkk-hand-solver --no-driver --emit both --emit-openxr --listen 127.0.0.1:12277\` in a terminal. Nothing serves port 12277 until it runs.` });
  const connected = s.gloves.filter((g) => g.connected);
  if (!connected.length && (s.rcsp || has(['no serial devices', 'no usb devices', 'no devices found']))) {
    issues.push({ code: 'no_usb_devices', side: null, blocking: true, title: 'No gloves found', fix: 'Reconnect both USB cables. If a glove still does not show, try another cable or another USB port.' });
  } else if (connected.length === 1) {
    const missing = other(connected[0].side);
    issues.push({ code: 'glove_missing', side: missing, blocking: false, title: `The ${missing} glove is missing`, fix: `Connect the ${missing} glove: plug in its USB cable, or switch it on and wait a few seconds.` });
  }
  const idle = connected.filter((g) => g.streaming === false);
  if (idle.length)
    issues.push({
      code: 'not_streaming',
      side: idle.length === 1 ? idle[0].side : null,
      blocking: true,
      title: 'The gloves are connected, but no program has asked the driver for their data',
      fix: 'This is not a glove fault: the driver streams a glove only while a program subscribes to it. Start the core, which subscribes: `python -m core --solver 127.0.0.1:12277 --rcsp 127.0.0.1:45451`.',
    });
  for (const g of connected) {
    if (g.streaming === false) continue;
    if (g.fps === null || g.last_frame_age_ms === null || g.last_frame_age_ms > GLOVE_STALE_FRAME_MS) {
      issues.push({
        code: 'no_frames',
        side: g.side,
        blocking: true,
        title: `No ${g.side} hand frames reach the app`,
        fix:
          s.source !== 'simulator'
            ? 'Start the core and the bridge: `python -m core --solver 127.0.0.1:12277 --rcsp 127.0.0.1:45451`, then `python -m tools.ingest_bridge`. The bridge switches the app to the gloves.'
            : 'The app is showing the simulator. Start the core and `python -m tools.ingest_bridge`; the bridge switches the app to the gloves.',
      });
      continue;
    }
    const rate = g.driver_fps ?? g.fps;
    const floor = g.driver_fps !== null ? GLOVE_MIN_DRIVER_FPS : GLOVE_MIN_STREAM_FPS;
    if (rate < floor) {
      const how = g.connection === 'usb' ? 'check its battery and its USB cable' : 'charge its battery or plug in its USB cable';
      issues.push({ code: 'low_frame_rate', side: g.side, blocking: false, title: `The ${g.side} glove sends ${Math.round(rate)} frames a second`, fix: `For the ${g.side} glove, ${how}. On Wi-Fi, move closer to the router and away from other networks.` });
    }
  }
  return issues;
}

/** GET /gloves/status in mock mode. */
export function mockGloveStatus(source: GloveSource, scenario: MockGloveScenario = mockGloveScenario()): GloveRigStatus {
  const snap: Snapshot = { source, studio: false, driverUp: true, solverUp: true, rcsp: true, canStart: true, gloves: [glove('left'), glove('right')], lines: [] };
  switch (scenario) {
    case 'no_driver':
      if (!driverStarted) Object.assign(snap, { driverUp: false, solverUp: false, rcsp: false, gloves: [offline('left'), offline('right')] });
      break;
    case 'studio':
      Object.assign(snap, { studio: true, driverUp: false, solverUp: false, rcsp: false, canStart: false, gloves: [offline('left'), offline('right')] });
      break;
    case 'busy':
      Object.assign(snap, { gloves: [offline('left'), offline('right')], lines: ['Error: open: Access is denied. (os error 5)'] });
      break;
    case 'no_usb':
      snap.gloves = [offline('left'), offline('right')];
      break;
    case 'one_glove':
      snap.gloves = [offline('left'), glove('right')];
      break;
    case 'low_fps':
      snap.gloves = [glove('left', { driver_fps: 31.4, fps: 30.2, connection: 'wifi' }), glove('right')];
      break;
    case 'saturated':
      snap.gloves = [glove('left'), glove('right', { sensors: sensors({ index: ['gyroscope'], hub: ['magnetometer'] }), heading_reliable: false })];
      break;
    case 'not_streaming':
      snap.gloves = (['left', 'right'] as const).map((s) => glove(s, { streaming: false, driver_fps: null, fps: null, last_frame_age_ms: null, heading_reliable: null }));
      break;
    case 'no_frames':
      snap.gloves = [glove('left', { fps: null, last_frame_age_ms: null }), glove('right', { fps: null, last_frame_age_ms: null })];
      break;
    default:
      break;
  }
  const issues = diagnoseRig(snap);
  return {
    checked_at: new Date().toISOString(),
    source,
    ready: snap.gloves.some((g) => g.connected) && !issues.some((i) => i.blocking),
    driver: {
      driver_running: snap.driverUp,
      driver_port_open: snap.driverUp,
      solver_running: snap.solverUp,
      solver_port_open: snap.solverUp,
      rcsp_connected: snap.rcsp,
      studio_running: snap.studio,
      managed: driverStarted,
      autostart: false,
      sdk_found: true,
      last_error: null,
    },
    gloves: snap.gloves,
    issues,
  };
}

/* ---- calibration maths, ported from backend/app/services/rig/calibration.py ---- */

/** Heading in degrees: rotation about +y of the fingers' direction (-z at rest), from an x y z w quaternion. */
export function wristYawDeg([x, y, z, w]: [number, number, number, number]): number {
  const fx = -(2 * (x * z + w * y));
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz) * DEG;
}

export function circularMeanDeg(angles: number[]): number {
  const s = angles.reduce((a, v) => a + Math.sin(v / DEG), 0);
  const c = angles.reduce((a, v) => a + Math.cos(v / DEG), 0);
  return Math.atan2(s, c) * DEG;
}

export const angleDiffDeg = (a: number, b: number): number => Math.abs((((a - b + 180) % 360) + 360) % 360 - 180);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

interface Capture {
  flex: Partial<Record<Side, number[][]>>;
  yaws: Partial<Record<Side, number[]>>;
}

/** Joint flexion (15 per frame) and wrist yaw per hand from the mock stream over durationS. */
async function capture(durationS: number): Promise<Capture> {
  const out: Capture = { flex: {}, yaws: {} };
  await new Promise<void>((resolve) => {
    const stop = getHub().subscribe((frame) => {
      for (const h of frame.hands) {
        (out.flex[h.side] ??= []).push(FINGERS.flatMap((f) => h.flexion[f]));
        (out.yaws[h.side] ??= []).push(wristYawDeg(h.wrist_quat));
      }
    });
    window.setTimeout(() => {
      stop();
      resolve();
    }, durationS * 1000);
  });
  return out;
}

export function summariseHand(side: Side, flex: number[][], yaws: number[]): NeutralHand {
  const n = flex.length;
  const mean = flex[0].map((_, j) => flex.reduce((a, row) => a + row[j], 0) / n);
  const std = mean.map((m, j) => Math.sqrt(flex.reduce((a, row) => a + (row[j] - m) ** 2, 0) / n) * DEG);
  const zero = circularMeanDeg(yaws);
  const spread = Math.sqrt(yaws.reduce((a, y) => a + angleDiffDeg(y, zero) ** 2, 0) / Math.max(1, yaws.length));
  const offsets = Object.fromEntries(FINGERS.map((f, i) => [f, mean.slice(i * 3, i * 3 + 3).map((v) => round(v, 4)) as JointTriple])) as Record<Finger, JointTriple>;
  return { side, offsets, yaw_zero_deg: round(zero), noise_deg: round(std.reduce((a, v) => a + v, 0) / std.length), yaw_spread_deg: round(spread), frames: n };
}

export function qualityOf(hands: NeutralHand[], headingShare: number | null): CalibrationQuality {
  const grade = (v: number | null, good: number, fair: number, higher = false) => (v === null ? 0 : higher ? (v >= good ? 0 : v >= fair ? 1 : 2) : v <= good ? 0 : v <= fair ? 1 : 2);
  const noise = hands.length ? round(Math.max(...hands.map((h) => h.noise_deg))) : null;
  const bias = hands.length ? round(Math.max(...hands.map((h) => (Object.values(h.offsets).flat().reduce((a, v) => a + Math.abs(v), 0) / 15) * DEG))) : null;
  const g = [grade(noise, QUALITY.noiseGood, QUALITY.noiseFair), grade(bias, QUALITY.biasGood, QUALITY.biasFair)];
  const notes: string[] = [];
  if (g[0]) notes.push('The hands moved during the capture. Rest them on the table and hold still.');
  if (g[1]) notes.push('The flat hands read as bent. Lay the fingers flat and straight, then capture again.');
  return { noise_deg: noise, bias_deg: bias, heading_reliable: headingShare, grade: (['good', 'fair', 'poor'] as const)[Math.max(...g)], notes };
}

/** POST /gloves/calibrations/neutral in mock mode (the stored record is returned; the router saves it). */
export async function mockCaptureNeutral(wearer: string, durationS: number, reinit: boolean, id: string, now: string): Promise<WearerCalibration> {
  const cap = await capture(durationS);
  const hands = (['left', 'right'] as const).filter((s) => (cap.flex[s]?.length ?? 0) >= NEUTRAL_MIN_FRAMES).map((s) => summariseHand(s, cap.flex[s]!, cap.yaws[s]!));
  if (!hands.length) throw new Error('No glove frames arrived while capturing. Check the gloves screen, then try again.');
  return { id, wearer, created_at: now, neutral: hands, range_calibration_ids: {}, quality: qualityOf(hands, 1), reinit, verified: false };
}

/** POST /gloves/drift_check in mock mode. The 'drift' scenario bends the live hands by 15 degrees. */
export async function mockDriftCheck(saved: WearerCalibration, durationS: number, scenario: MockGloveScenario = mockGloveScenario()): Promise<DriftCheckResult> {
  const cap = await capture(durationS);
  const extra = scenario === 'drift' ? 15 / DEG : 0;
  const hands: DriftHand[] = [];
  for (const n of saved.neutral) {
    const live = cap.flex[n.side];
    if (!live?.length) continue;
    const ref = FINGERS.flatMap((f) => n.offsets[f]);
    const mean = ref.map((_, j) => live.reduce((a, row) => a + row[j], 0) / live.length + extra);
    const flex = (mean.reduce((a, v, j) => a + Math.abs(v - ref[j]), 0) / ref.length) * DEG;
    const yaw = angleDiffDeg(circularMeanDeg(cap.yaws[n.side]!), n.yaw_zero_deg);
    hands.push({ side: n.side, flex_drift_deg: round(flex), yaw_drift_deg: round(yaw) });
  }
  if (!hands.length) throw new Error('The saved calibration has no hand that is streaming now. Calibrate again.');
  const ok = hands.every((h) => h.flex_drift_deg <= DRIFT_MAX_FLEX_DEG && h.yaw_drift_deg <= DRIFT_MAX_YAW_DEG);
  const worst = hands.reduce((a, h) => (Math.max(h.flex_drift_deg / DRIFT_MAX_FLEX_DEG, h.yaw_drift_deg / DRIFT_MAX_YAW_DEG) > Math.max(a.flex_drift_deg / DRIFT_MAX_FLEX_DEG, a.yaw_drift_deg / DRIFT_MAX_YAW_DEG) ? h : a));
  const message = ok
    ? 'The gloves still match the saved calibration.'
    : worst.flex_drift_deg > DRIFT_MAX_FLEX_DEG
      ? `The ${worst.side} hand reads ${Math.round(worst.flex_drift_deg)} degrees away from the saved flat pose. Recalibrate.`
      : `The ${worst.side} hand's heading moved ${Math.round(worst.yaw_drift_deg)} degrees since calibration. Recalibrate.`;
  return { ok, calibration_id: saved.id, hands, max_flex_deg: DRIFT_MAX_FLEX_DEG, max_yaw_deg: DRIFT_MAX_YAW_DEG, message };
}
