import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GloveDeviceStatus, GloveRigStatus, WearerCalibration } from '../src/api/types';
import { driftCheckResultSchema, gloveRigStatusSchema, wearerCalibrationSchema } from '../src/api/schemas';
import {
  canStartGloves,
  demoDecision,
  fixParts,
  formatAge,
  gloveFacts,
  gloveLine,
  nextPath,
  qualityLines,
  shouldOpenGlovesOnStart,
  splitIssues,
  TravelTracker,
  VERIFY_MIN_TRAVEL_DEG,
} from '../src/features/shared/gloves/logic';
import { demoModePref, wearerPref } from '../src/features/shared/settings';
import { mockGloveStatus, summariseHand, qualityOf, wristYawDeg } from '../src/mock/rig';
import { handleMockRequest } from '../src/mock/router';
import { handWith } from './helpers';

function stubWindow(search = ''): Map<string, string> {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
  vi.stubGlobal('window', {
    localStorage: storage,
    sessionStorage: storage,
    location: { search, href: `http://localhost/${search}` },
    matchMedia: () => ({ matches: false }),
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    setInterval: (f: () => void, ms: number) => setInterval(f, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  });
  return store;
}

const call = (method: string, path: string, json?: unknown, query = '') => handleMockRequest({ method, path, query: new URLSearchParams(query), json });

describe('glove status in mock mode', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ready: both gloves over USB at the driver rate, battery unknown, no fix steps, and it matches the contract', () => {
    stubWindow();
    const s = mockGloveStatus('simulator', 'ready');
    expect(gloveRigStatusSchema.safeParse(s).success).toBe(true);
    expect(s.ready).toBe(true);
    expect(s.issues).toEqual([]);
    expect(s.gloves.map((g) => [g.side, g.connection, g.battery_pct, g.streaming])).toEqual([
      ['left', 'usb', null, true],
      ['right', 'usb', null, true],
    ]);
  });

  it.each([
    ['no_driver', 'driver_not_running', true],
    ['studio', 'studio_running', true],
    ['busy', 'device_busy', true],
    ['no_usb', 'no_usb_devices', true],
    ['one_glove', 'glove_missing', false],
    ['low_fps', 'low_frame_rate', false],
    ['saturated', 'saturation', false],
    ['not_streaming', 'not_streaming', true],
    ['no_frames', 'no_frames', true],
  ] as const)('scenario %s puts %s first', (scenario, code, blocking) => {
    stubWindow();
    const s = mockGloveStatus('external', scenario);
    expect(gloveRigStatusSchema.safeParse(s).success).toBe(true);
    expect(s.issues[0].code).toBe(code);
    expect(s.issues[0].blocking).toBe(blocking);
  });

  it('fix steps say what the brief asks for', () => {
    stubWindow();
    const fix = (sc: Parameters<typeof mockGloveStatus>[1]) => mockGloveStatus('external', sc).issues[0];
    expect(fix('no_driver').fix).toContain('rokoko-sdk --auto-stream-usb');
    expect(fix('studio').fix).toMatch(/Close Rokoko Studio/);
    expect(fix('busy').fix).toMatch(/Close Studio/);
    expect(fix('no_usb').fix).toMatch(/another cable/);
    expect(fix('one_glove')).toMatchObject({ side: 'left', title: 'The left glove is missing' });
    expect(fix('low_fps').fix).toMatch(/battery/);
    expect(fix('low_fps').fix).toMatch(/Wi-Fi/);
    expect(fix('saturated').fix).toMatch(/metal and magnets.*recalibrate/);
    expect(fix('not_streaming').fix).toMatch(/not a glove fault/);
  });

  it('the scenario comes from the URL and is remembered for the tab', async () => {
    const store = stubWindow('?mockGloves=studio');
    const res = await call('GET', '/gloves/status');
    expect((res.body as GloveRigStatus).issues[0].code).toBe('studio_running');
    expect(store.get('apprentice.mockGloves')).toBe('studio');
    expect((await call('POST', '/gloves/driver', { action: 'start' })).status).toBe(409);
  });

  it('Start the gloves clears the no_driver scenario', async () => {
    stubWindow('?mockGloves=no_driver');
    expect(((await call('GET', '/gloves/status')).body as GloveRigStatus).ready).toBe(false);
    const started = await call('POST', '/gloves/driver', { action: 'start' });
    expect((started.body as GloveRigStatus).ready).toBe(true);
    await call('POST', '/gloves/driver', { action: 'stop' });
    expect((await call('POST', '/gloves/driver', { action: 'jump' })).status).toBe(422);
  });

  it('validates the wearer and answers 404 with no saved calibration', async () => {
    stubWindow();
    expect((await call('POST', '/gloves/calibrations/neutral', { wearer: '   ' })).status).toBe(422);
    expect((await call('POST', '/gloves/calibrations/neutral', { wearer: 'x'.repeat(41) })).status).toBe(422);
    expect((await call('GET', '/gloves/calibrations/latest', undefined, 'wearer=Nobody')).status).toBe(404);
    expect((await call('POST', '/gloves/drift_check', { wearer: 'Nobody' })).status).toBe(404);
  });

  it('captures a neutral pose from the mock stream, saves it per wearer, then passes the drift check', async () => {
    stubWindow();
    const cap = await call('POST', '/gloves/calibrations/neutral', { wearer: '  Ada   Lovelace ', duration_s: 0.4 });
    expect(cap.status).toBe(200);
    const cal = cap.body as WearerCalibration;
    expect(wearerCalibrationSchema.safeParse(cal).success).toBe(true);
    expect(cal.wearer).toBe('Ada Lovelace');
    expect(cal.neutral.map((n) => n.side).sort()).toEqual(['left', 'right']);
    const latest = await call('GET', '/gloves/calibrations/latest', undefined, 'wearer=ada lovelace');
    expect((latest.body as WearerCalibration).id).toBe(cal.id);
    const drift = await call('POST', '/gloves/drift_check', { wearer: 'Ada Lovelace', duration_s: 0.3 });
    expect(driftCheckResultSchema.safeParse(drift.body).success).toBe(true);
    expect(drift.body).toMatchObject({ ok: true, calibration_id: cal.id });
    const done = await call('POST', `/gloves/calibrations/${cal.id}/finish`, { verified: true });
    expect((done.body as WearerCalibration).verified).toBe(true);
  });
});

describe('glove screen logic', () => {
  const glove = (over: Partial<GloveDeviceStatus> = {}): GloveDeviceStatus => ({
    side: 'right',
    connected: true,
    device_id: 1,
    connection: 'usb',
    fps: 60,
    driver_fps: 83.4,
    streaming: true,
    last_frame_age_ms: 12,
    battery_pct: null,
    heading_reliable: true,
    sensors: [],
    ...over,
  });

  beforeEach(() => stubWindow());
  afterEach(() => vi.unstubAllGlobals());

  it('says battery unknown rather than guessing, and names the link', () => {
    expect(gloveFacts(glove())).toEqual({ connection: 'Connected over USB', rate: '83 frames a second (60 reach the app)', age: 'Last frame 12 ms ago', battery: 'Battery: unknown' });
    expect(gloveFacts(glove({ connected: false, connection: null, driver_fps: null, fps: null, last_frame_age_ms: null })).connection).toBe('Not connected');
    expect(gloveFacts(glove({ battery_pct: 71.6 })).battery).toBe('Battery 72%');
    expect(formatAge(1400)).toBe('1.4 s');
  });

  it('rail line: mock says simulated, one glove names its side, a blocking step says it needs a fix', () => {
    const s = mockGloveStatus('external', 'ready');
    expect(gloveLine(s, true, 'open')).toEqual({ text: 'Gloves simulated', tone: 'sim' });
    expect(gloveLine(s, false, 'open')).toEqual({ text: 'Gloves ready', tone: 'ok' });
    expect(gloveLine(mockGloveStatus('external', 'one_glove'), false, 'open').text).toBe('Gloves: right only');
    expect(gloveLine(mockGloveStatus('external', 'not_streaming'), false, 'open').text).toBe('Gloves need a fix');
    expect(gloveLine(mockGloveStatus('external', 'no_usb'), false, 'open').text).toBe('Gloves off');
    expect(gloveLine(null, false, 'connecting').text).toBe('Gloves linking');
  });

  it('commands in fix steps render as code; the first blocking step comes first', () => {
    expect(fixParts('Run `rokoko-sdk --auto-stream-usb` now.')).toEqual([
      { text: 'Run ', code: false },
      { text: 'rokoko-sdk --auto-stream-usb', code: true },
      { text: ' now.', code: false },
    ]);
    const issues = mockGloveStatus('external', 'one_glove').issues;
    expect(splitIssues(issues).now).toBeNull();
    const studio = mockGloveStatus('external', 'studio');
    expect(splitIssues(studio.issues).now?.code).toBe('studio_running');
    expect(canStartGloves(studio)).toBe(false);
  });

  it('opens the gloves screen on start for real gloves or demo mode, never in mock or on the simulator', () => {
    const real = mockGloveStatus('external', 'ready');
    const sim = mockGloveStatus('simulator', 'ready');
    expect(shouldOpenGlovesOnStart(real, false, false)).toBe(true);
    expect(shouldOpenGlovesOnStart(sim, false, false)).toBe(false);
    expect(shouldOpenGlovesOnStart(real, false, true)).toBe(false);
    expect(shouldOpenGlovesOnStart(sim, true, true)).toBe(true);
  });

  it('Continue only goes to app paths', () => {
    expect(nextPath(new URLSearchParams('next=/expert/scratch'))).toBe('/expert/scratch');
    expect(nextPath(new URLSearchParams('next=//evil.example'))).toBe('/apprentice');
    expect(nextPath(new URLSearchParams('next=https://evil.example'))).toBe('/apprentice');
    expect(nextPath(new URLSearchParams('next=/gloves'))).toBe('/apprentice');
  });

  it('the follow check needs every finger to travel the full distance', () => {
    const t = new TravelTracker(VERIFY_MIN_TRAVEL_DEG);
    t.push(handWith({}));
    t.push(handWith({ thumb: 70, index: 90, middle: 90, ring: 90, little: 50 }));
    expect(t.followed('right')).toEqual(['thumb', 'index', 'middle', 'ring']);
    expect(t.done(['right'])).toBe(false);
    t.push(handWith({ little: 80 }));
    expect(t.done(['right'])).toBe(true);
    expect(t.done(['left', 'right'])).toBe(false);
  });

  it('demo mode asks for a name, then a calibration, waits for the gloves, then runs', () => {
    const saved = { id: 'c' } as WearerCalibration;
    const base = { wearer: 'Ada', saved, ready: true, phase: 'idle', result: null };
    expect(demoDecision({ ...base, wearer: ' ' })).toBe('name');
    expect(demoDecision({ ...base, saved: undefined })).toBe('loading');
    expect(demoDecision({ ...base, saved: null })).toBe('calibrate');
    expect(demoDecision({ ...base, ready: false })).toBe('wait');
    expect(demoDecision(base)).toBe('run');
    expect(demoDecision({ ...base, phase: 'holding' })).toBe('running');
  });

  it('demo mode and the wearer persist, off and empty by default', () => {
    const store = stubWindow();
    demoModePref.reset();
    wearerPref.reset();
    expect(demoModePref.get()).toBe(false);
    expect(wearerPref.get()).toBe('');
    demoModePref.set(true);
    wearerPref.set('  Ada ');
    expect(store.get('apprentice.demoMode')).toBe('1');
    expect(store.get('apprentice.wearer')).toBe('Ada');
    demoModePref.set(false);
    expect(store.has('apprentice.demoMode')).toBe(false);
    demoModePref.reset();
    wearerPref.reset();
  });

  it('quality reads in plain words and flags a moving or bent capture', () => {
    const still = Array.from({ length: 30 }, () => Array(15).fill(0.2));
    const hand = summariseHand('right', still, Array(30).fill(10));
    expect(hand.noise_deg).toBe(0);
    expect(hand.yaw_zero_deg).toBeCloseTo(10, 5);
    const q = qualityOf([hand], 1);
    expect(q.grade).toBe('good');
    expect(qualityLines(q).map((l) => l.label)).toEqual(['Noise at rest', 'Bias from a flat hand', 'Heading reliable']);
    const bent = qualityOf([summariseHand('right', Array.from({ length: 30 }, () => Array(15).fill(0.8)), Array(30).fill(0))], 1);
    expect(bent.grade).toBe('poor');
    expect(bent.notes.join(' ')).toMatch(/flat and straight/);
    expect(wristYawDeg([0, 0, 0, 1])).toBeCloseTo(0, 6);
  });
});
