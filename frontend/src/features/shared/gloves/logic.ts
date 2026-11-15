import type { CalibrationQuality, DriftCheckResult, Finger, GloveDeviceStatus, GloveIssue, GloveRigStatus, HandFrame, Side, WearerCalibration } from '../../../api/types';
import { FINGERS } from '../../../api/types';

/** Pure helpers for the gloves screen, the calibration area and the rail line. Unit-tested in tests/gloves.test.ts. */

export type GloveTone = 'ok' | 'warn' | 'off' | 'sim';

/** The rail's one-line glove state. Mock mode and the simulator say so, so fake hands are never taken for gloves. */
export function gloveLine(status: GloveRigStatus | null, mock: boolean, stream: 'open' | 'connecting' | 'closed'): { text: string; tone: GloveTone } {
  if (mock) return { text: 'Gloves simulated', tone: 'sim' };
  if (!status) return { text: stream === 'open' ? 'Gloves live' : stream === 'connecting' ? 'Gloves linking' : 'Gloves off', tone: stream === 'open' ? 'ok' : 'off' };
  const connected = status.gloves.filter((g) => g.connected);
  if (status.issues.some((i) => i.blocking)) return { text: connected.length ? 'Gloves need a fix' : 'Gloves off', tone: 'off' };
  if (!connected.length) return { text: status.source === 'simulator' ? 'Gloves simulated' : 'Gloves off', tone: status.source === 'simulator' ? 'sim' : 'off' };
  const warn = status.issues.length > 0;
  if (connected.length === 1) return { text: `Gloves: ${connected[0].side} only`, tone: 'warn' };
  return { text: warn ? 'Gloves ready, with a note' : 'Gloves ready', tone: warn ? 'warn' : 'ok' };
}

/** The plain lines the status screen shows for one glove. */
export function gloveFacts(g: GloveDeviceStatus): { connection: string; rate: string; age: string; battery: string } {
  const via = g.connection === 'usb' ? 'over USB' : g.connection === 'wifi' ? 'over Wi-Fi' : g.connection === 'emulated' ? '(emulated)' : '';
  const rate = g.driver_fps ?? g.fps;
  return {
    connection: g.connected ? `Connected ${via}`.trim() : 'Not connected',
    rate: rate === null ? 'Frame rate: unknown' : `${Math.round(rate)} frames a second${g.driver_fps !== null && g.fps !== null ? ` (${Math.round(g.fps)} reach the app)` : ''}`,
    age: g.last_frame_age_ms === null ? 'No frames in the app yet' : `Last frame ${formatAge(g.last_frame_age_ms)} ago`,
    battery: g.battery_pct === null ? 'Battery: unknown' : `Battery ${Math.round(g.battery_pct)}%`,
  };
}

/** 12 ms, 1.4 s, 2 min. */
export function formatAge(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/** Splits a fix step into plain text and `commands`, for rendering commands as code. */
export function fixParts(text: string): { text: string; code: boolean }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) => (part.startsWith('`') && part.endsWith('`') ? { text: part.slice(1, -1), code: true } : { text: part, code: false }));
}

/** The issue to fix first (the first blocking one), and the rest. */
export function splitIssues(issues: GloveIssue[]): { now: GloveIssue | null; rest: GloveIssue[] } {
  const now = issues.find((i) => i.blocking) ?? null;
  return { now, rest: issues.filter((i) => i !== now) };
}

/** Whether the status offers the Start the gloves button: the driver or solver is missing, the SDK is there, Studio is closed. */
export function canStartGloves(s: GloveRigStatus): boolean {
  return s.driver.sdk_found && !s.driver.studio_running && s.issues.some((i) => i.code === 'driver_not_running' || i.code === 'solver_not_running');
}

/**
 * Whether opening the app should show the gloves screen first: always in demo mode (it runs the drift check), and on a
 * real-glove source; never with "No gloves" on, in mock mode or on the simulator, so walks through the app are not
 * interrupted.
 */
export function shouldOpenGlovesOnStart(status: GloveRigStatus | null, demo: boolean, mock: boolean, noGloves = false): boolean {
  if (noGloves) return false;
  if (demo) return true;
  if (mock || !status) return false;
  return status.source !== 'simulator';
}

/** The words for a calibration quality reading. Unknown values say so rather than guess. */
export function qualityLines(q: CalibrationQuality): { label: string; value: string }[] {
  return [
    { label: 'Noise at rest', value: q.noise_deg === null ? 'unknown' : `${q.noise_deg.toFixed(1)} degrees` },
    { label: 'Bias from a flat hand', value: q.bias_deg === null ? 'unknown' : `${Math.round(q.bias_deg)} degrees` },
    { label: 'Heading reliable', value: q.heading_reliable === null ? 'unknown' : `${Math.round(q.heading_reliable * 100)}% of the capture` },
  ];
}

export const GRADE_WORDS: Record<CalibrationQuality['grade'], string> = {
  good: 'Good calibration',
  fair: 'Fair calibration: usable, but a retake would help',
  poor: 'Poor calibration: capture it again',
};

/** Total flexion of a finger in degrees. */
export const totalDeg = (h: HandFrame, f: Finger): number => ((h.flexion[f][0] + h.flexion[f][1] + h.flexion[f][2]) * 180) / Math.PI;

/**
 * The verification step: the wearer opens and closes the hands, and each finger must travel at least minTravelDeg of
 * total flexion for the hand on screen to count as following.
 */
export class TravelTracker {
  private lo = new Map<string, number>();
  private hi = new Map<string, number>();

  constructor(readonly minTravelDeg: number) {}

  push(hand: HandFrame): void {
    for (const f of FINGERS) {
      const key = `${hand.side}.${f}`;
      const v = totalDeg(hand, f);
      this.lo.set(key, Math.min(this.lo.get(key) ?? v, v));
      this.hi.set(key, Math.max(this.hi.get(key) ?? v, v));
    }
  }

  travel(side: Side, f: Finger): number {
    const key = `${side}.${f}`;
    return (this.hi.get(key) ?? 0) - (this.lo.get(key) ?? 0);
  }

  /** Fingers of a side that have travelled far enough. */
  followed(side: Side): Finger[] {
    return FINGERS.filter((f) => this.travel(side, f) >= this.minTravelDeg);
  }

  done(sides: Side[]): boolean {
    return sides.length > 0 && sides.every((s) => this.followed(s).length === FINGERS.length);
  }

  reset(): void {
    this.lo.clear();
    this.hi.clear();
  }
}

/** Mirror of VERIFY_MIN_TRAVEL_DEG in backend/app/constants.py. */
export const VERIFY_MIN_TRAVEL_DEG = 60;
/** Mirror of NEUTRAL_DEFAULT_DURATION_S and DRIFT_CHECK_DURATION_S: the lesson flow holds the start pose for 3 s. */
export const NEUTRAL_SECONDS = 3;
export const DRIFT_SECONDS = 2;

export type DemoDecision = 'name' | 'loading' | 'calibrate' | 'wait' | 'run' | 'running';

/**
 * What demo mode does next: ask who wears the gloves, wait for their saved calibration, send them to calibrate when
 * there is none, wait for the gloves, or run the hold-still drift check.
 */
export function demoDecision(s: { wearer: string; saved: WearerCalibration | null | undefined; ready: boolean; phase: string; result: DriftCheckResult | null }): DemoDecision {
  if (!s.wearer.trim()) return 'name';
  if (s.saved === undefined) return 'loading';
  if (s.saved === null) return 'calibrate';
  if (s.phase !== 'idle') return 'running';
  if (!s.ready) return 'wait';
  return 'run';
}

/** Where Continue goes: the screen that sent the wearer here, else the apprentice home. Only app paths are accepted. */
export function nextPath(params: URLSearchParams): string {
  const next = params.get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/gloves') ? next : '/apprentice';
}
