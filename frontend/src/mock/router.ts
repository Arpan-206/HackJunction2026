import type {
  Calibration,
  Finger,
  GloveFrame,
  JointTriple,
  Lesson,
  Margin,
  MotionSpec,
  Recording,
  ScoreResult,
  Hands,
  Side,
  Skill,
  Step,
  Tolerance,
} from '../api/types';
import { getHub, isMotionSpec } from './glove';
import { newId, nowIso } from './ids';
import { MOCK_PROVIDER, templateLesson, templateLessonFromVideo, templateMotion, templatePlan, type LessonDraftBody } from './llm';
import { MOVES } from './seed';
import { buildHint, compare, resample, ScoringError, toResult, calibrateAttempt, STATIC_PRESETS, thresholds, DEFAULT_TOLERANCE_ANGLE_DEG } from './scoring';
import { DEFAULT_MARGIN, isMargin } from '../api/margin';
import { getStore } from './store';
import { isAssistantOn, isAssistantPath } from '../features/shared/assistant';
import { handFrame, synthesise } from './synth';

/**
 * In-browser implementation of every route in docs/CONTRACT.md (prefix /api). It returns the same status codes and
 * the same {detail} error body as the FastAPI backend, so the frontend cannot tell the difference.
 */

export interface MockRequest {
  method: string;
  /** Path below /api, for example `/lessons/abc`. */
  path: string;
  query: URLSearchParams;
  json?: unknown;
  form?: FormData;
}

export interface MockResponse {
  status: number;
  body: unknown;
}

/** An error that maps straight to an HTTP status and a {detail} body. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SIDES: Side[] = ['left', 'right'];
const SKILLS: Skill[] = ['table_tennis', 'piano', 'general'];
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const DEFAULT_TOLERANCE: Tolerance = { angle_deg: 18, timing_ms: 250 };
const SCORE_FPS = 30;
const MAX_PREVIEW_S = 30;
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

const bad = (message: string): never => {
  throw new HttpError(400, message);
};
const invalid = (message: string): never => {
  throw new HttpError(422, message);
};
const notFound = (message: string): never => {
  throw new HttpError(404, message);
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function body(req: MockRequest): Record<string, unknown> {
  if (!isObj(req.json)) return invalid('request body must be a JSON object');
  return req.json;
}

function side(v: unknown, fallback?: Side): Side {
  if (v === undefined || v === null) return fallback ?? invalid('side is required');
  return SIDES.includes(v as Side) ? (v as Side) : invalid("side must be 'left' or 'right'");
}

function skillOrNull(v: unknown): Skill | null {
  if (v === undefined || v === null || v === '') return null;
  return SKILLS.includes(v as Skill) ? (v as Skill) : invalid('skill must be table_tennis, piano or general');
}

function tolerance(v: unknown): Tolerance {
  if (v === undefined || v === null) return { ...DEFAULT_TOLERANCE };
  if (!isObj(v)) return invalid('tolerance must be an object');
  const angle = v.angle_deg === undefined ? DEFAULT_TOLERANCE.angle_deg : Number(v.angle_deg);
  const timing = v.timing_ms === undefined ? DEFAULT_TOLERANCE.timing_ms : Number(v.timing_ms);
  if (!(angle > 0) || !(timing > 0)) return invalid('tolerance values must be positive');
  return { angle_deg: angle, timing_ms: timing };
}

function margin(v: unknown): Margin {
  if (v === undefined || v === null) return DEFAULT_MARGIN;
  return isMargin(v) ? v : invalid('margin must be strict, standard, relaxed or just_trying');
}

function motion(v: unknown): MotionSpec {
  return isMotionSpec(v) ? v : invalid('motion is not a valid MotionSpec');
}

/** Applies the backend's defaults to a step and assigns an id when none is given. */
function normaliseStep(raw: unknown): Step {
  if (!isObj(raw)) return invalid('each step must be an object');
  if (typeof raw.title !== 'string' || typeof raw.instruction !== 'string') return invalid('step title and instruction are required');
  const reps = raw.repetitions === undefined ? 3 : Number(raw.repetitions);
  if (!(reps >= 1)) return invalid('repetitions must be at least 1');
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    title: raw.title,
    instruction: raw.instruction,
    move_id: (raw.move_id as string | null | undefined) ?? null,
    hands: (raw.hands as Step['hands'] | undefined) ?? 'right',
    prop: (raw.prop as Step['prop'] | undefined) ?? 'none',
    motion: raw.motion === undefined || raw.motion === null ? null : motion(raw.motion),
    reference_recording_id: (raw.reference_recording_id as string | null | undefined) ?? null,
    repetitions: reps,
    tolerance: tolerance(raw.tolerance),
    video_url: (raw.video_url as string | null | undefined) ?? null,
  };
}

function normaliseLesson(raw: unknown): LessonDraftBody {
  if (!isObj(raw)) return invalid('request body must be a JSON object');
  if (typeof raw.title !== 'string' || !raw.title) return invalid('title is required');
  if (!SKILLS.includes(raw.skill as Skill)) return invalid('skill must be table_tennis, piano or general');
  if (!Array.isArray(raw.steps) || raw.steps.length < 1) return invalid('a lesson needs at least one step');
  return {
    title: raw.title,
    skill: raw.skill as Skill,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    master_name: typeof raw.master_name === 'string' ? raw.master_name : 'Expert',
    source: (raw.source as Lesson['source'] | undefined) ?? 'scratch',
    steps: raw.steps.map(normaliseStep),
    test: (raw.test as Lesson['test'] | undefined) ?? null,
  };
}

/**
 * Stands in for a person holding a flat hand or a loose fist for duration_s: the glove simulator idles whatever the
 * person does, so the captured pose is the guide hand at curl 0 (flat) or curl 1 (fist), which keeps the calibrated
 * range meaningful and makes calibrated scoring behave like it would with a real glove.
 */
async function captureFlexion(sideName: Side, phase: 'flat' | 'fist', durationS: number): Promise<Record<Finger, JointTriple>> {
  await sleep(durationS * 1000);
  const level = phase === 'fist' ? 1 : 0;
  const pose = { thumb: level, index: level, middle: level, ring: level, little: level };
  const hand = handFrame({ preset: 'hold_pose', pose }, sideName, 0);
  return hand.flexion;
}

const zeroFlexion = (): Record<Finger, JointTriple> => ({ thumb: [0, 0, 0], index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], little: [0, 0, 0] });
const pendingPhases = new Map<Side, Partial<Record<'flat' | 'fist', Record<Finger, JointTriple>>>>();

interface Take {
  lesson_id: string | null;
  step_id: string | null;
  hands: Hands;
  started_at: string;
  frames: GloveFrame[];
  stop: () => void;
}
const takes = new Map<string, Take>();

const MAX_TAKE_FRAMES = 60 * 60 * 5;

function stopTake(id: string): Recording {
  const take = takes.get(id);
  if (!take) return notFound(`no active recording ${id}`);
  take.stop();
  takes.delete(id);
  const origin = take.frames[0]?.t ?? 0;
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const frames = take.frames.map((f) => ({ ...f, t: r4(f.t - origin) }));
  const duration = frames.length ? frames[frames.length - 1].t : 0;
  const fps = duration > 0 ? (frames.length - 1) / duration : 60;
  return getStore().saveRecording({
    id,
    lesson_id: take.lesson_id,
    step_id: take.step_id,
    started_at: take.started_at,
    duration_s: duration,
    fps: Math.round(fps * 100) / 100,
    hands: take.hands,
    frames,
  });
}

function latestCalibration(sideName: Side): Calibration {
  const matches = getStore().listCalibrations().filter((c) => c.side === sideName);
  if (!matches.length) return notFound(`no calibration for ${sideName} hand`);
  return matches[matches.length - 1];
}

function getCalibration(id: string): Calibration {
  return getStore().listCalibrations().find((c) => c.id === id) ?? notFound(`calibration ${id} not found`);
}

function parseFrames(v: unknown): GloveFrame[] {
  if (!Array.isArray(v)) return invalid('attempt_frames must be a list');
  for (const f of v) if (!isObj(f) || typeof f.t !== 'number' || !Array.isArray(f.hands)) return invalid('attempt_frames contains an invalid frame');
  return v as GloveFrame[];
}

function sideOf(frames: GloveFrame[]): Side {
  for (const f of frames) if (f.hands.length) return f.hands[0].side;
  return bad('recording contains no hand frames');
}

function score(b: Record<string, unknown>): ScoreResult {
  const hasRefRec = typeof b.reference_recording_id === 'string';
  const hasRefMotion = b.reference_motion !== undefined && b.reference_motion !== null;
  if (hasRefRec === hasRefMotion) invalid('provide exactly one of reference_recording_id or reference_motion');
  const hasFrames = b.attempt_frames !== undefined && b.attempt_frames !== null;
  const hasAttemptRec = typeof b.attempt_recording_id === 'string';
  if (!hasFrames && !hasAttemptRec) invalid('provide attempt_recording_id or attempt_frames');
  const tol = tolerance(b.tolerance);
  const chosen = margin(b.margin);

  let attemptFrames: GloveFrame[];
  if (hasFrames) attemptFrames = parseFrames(b.attempt_frames);
  else attemptFrames = (getStore().getRecording(b.attempt_recording_id as string) ?? notFound(`recording ${b.attempt_recording_id} not found`)).frames;
  const attemptDuration = attemptFrames.length ? attemptFrames[attemptFrames.length - 1].t - attemptFrames[0].t : 0;

  let referenceFrames: GloveFrame[];
  let sideName: Side;
  if (hasRefRec) {
    referenceFrames = (getStore().getRecording(b.reference_recording_id as string) ?? notFound(`recording ${b.reference_recording_id} not found`)).frames;
    sideName = sideOf(referenceFrames);
  } else {
    sideName = sideOf(attemptFrames);
    referenceFrames = synthesise(motion(b.reference_motion), sideName, Math.max(attemptDuration, 2 / SCORE_FPS), SCORE_FPS);
  }

  const warnings: string[] = [];
  const reference = resample(referenceFrames, sideName);
  let attempt = resample(attemptFrames, sideName);
  const ownId = b.attempt_calibration_id as string | undefined;
  const refId = b.reference_calibration_id as string | undefined;
  if (ownId || refId || b.use_latest_calibration === true) {
    const own = ownId ? getCalibration(ownId) : b.use_latest_calibration === true ? latestCalibration(sideName) : null;
    const refCal = refId ? getCalibration(refId) : null;
    if (own) attempt = calibrateAttempt(attempt, own, refCal, warnings);
  }
  const declaredStatic = hasRefMotion && STATIC_PRESETS.includes((b.reference_motion as { preset?: string }).preset ?? '') ? true : undefined;
  return { ...toResult(compare(reference, attempt, SCORE_FPS, declaredStatic), tol, chosen), warnings };
}

type Handler = (req: MockRequest, params: string[]) => Promise<MockResponse> | MockResponse;
const ok = (b: unknown, status = 200): MockResponse => ({ status, body: b });

const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
const route = (method: string, pattern: string, handler: Handler) => routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler });

route('GET', '/health', () => ok({ status: 'ok', glove_source: getStore().dev.glove_source, llm_provider: getStore().dev.llm_provider }));

route('GET', '/moves', (req) => {
  const skill = skillOrNull(req.query.get('skill'));
  return ok(skill ? MOVES.filter((m) => m.skill === skill) : MOVES);
});

route('GET', '/lessons', () => ok(getStore().listLessons()));
route('POST', '/lessons/generate', async (req) => {
  const b = body(req);
  if (typeof b.prompt !== 'string' || !b.prompt.length) invalid('prompt is required');
  const skill = skillOrNull(b.skill);
  await sleep(650);
  const lesson: Lesson = { ...templateLesson(b.prompt as string, skill), id: newId(), created_at: nowIso() };
  return ok({ lesson, provider: MOCK_PROVIDER, attempts: 1 });
});
route('POST', '/lessons/generate_from_video', async (req) => {
  const video = req.form?.get('video');
  if (!(video instanceof File)) return invalid('video file is required');
  if (video.size > MAX_VIDEO_BYTES) throw new HttpError(413, 'video is larger than 50 MB');
  if (!VIDEO_TYPES.includes(video.type)) throw new HttpError(415, 'unsupported video type; use mp4, webm or mov');
  const prompt = String(req.form?.get('prompt') ?? '');
  const skill = skillOrNull(req.form?.get('skill'));
  await sleep(900);
  const lesson: Lesson = { ...templateLessonFromVideo(prompt, video.name, skill), id: newId(), created_at: nowIso() };
  return ok({ lesson, provider: MOCK_PROVIDER, attempts: 0 });
});
route('GET', '/lessons/([^/]+)', (_req, [id]) => ok(getStore().getLesson(id) ?? notFound(`lesson ${id} not found`)));
route('POST', '/lessons', (req) => {
  const lesson: Lesson = { ...normaliseLesson(req.json), id: newId(), created_at: nowIso() };
  return ok(getStore().saveLesson(lesson), 201);
});
route('PUT', '/lessons/([^/]+)', (req, [id]) => {
  const existing = getStore().getLesson(id);
  const lesson: Lesson = { ...normaliseLesson(req.json), id, created_at: existing?.created_at ?? nowIso() };
  return ok(getStore().saveLesson(lesson));
});

route('POST', '/calibrations', async (req) => {
  const b = body(req);
  const sideName = side(b.side);
  if (b.phase !== 'flat' && b.phase !== 'fist') invalid("phase must be 'flat' or 'fist'");
  const duration = b.duration_s === undefined ? 1.5 : Number(b.duration_s);
  if (!(duration > 0 && duration <= 10)) invalid('duration_s must be greater than 0 and at most 10');
  const averaged = await captureFlexion(sideName, b.phase as 'flat' | 'fist', duration);
  const phases = pendingPhases.get(sideName) ?? {};
  phases[b.phase as 'flat' | 'fist'] = averaged;
  pendingPhases.set(sideName, phases);
  const cal: Calibration = { id: newId(), side: sideName, flat: phases.flat ?? zeroFlexion(), fist: phases.fist ?? zeroFlexion(), created_at: nowIso() };
  return ok(getStore().saveCalibration(cal));
});
route('GET', '/calibrations/latest', (req) => ok(latestCalibration(side(req.query.get('side') ?? undefined))));

route('POST', '/recordings/start', (req) => {
  const b = req.json === undefined ? {} : body(req);
  const hands = b.hands ?? 'both';
  if (hands !== 'left' && hands !== 'right' && hands !== 'both') invalid("hands must be 'left', 'right' or 'both'");
  const id = newId();
  const take: Take = {
    lesson_id: (b.lesson_id as string | undefined) ?? null,
    step_id: (b.step_id as string | undefined) ?? null,
    hands: hands as Hands,
    started_at: nowIso(),
    frames: [],
    stop: () => undefined,
  };
  // A one-handed take keeps only that hand, as the backend recorder does.
  take.stop = getHub().subscribe((f) => {
    if (take.frames.length < MAX_TAKE_FRAMES) take.frames.push(take.hands === 'both' ? f : { ...f, hands: f.hands.filter((h) => h.side === take.hands) });
  });
  takes.set(id, take);
  return ok({ recording_id: id });
});
route('POST', '/recordings/([^/]+)/stop', (_req, [id]) => ok(stopTake(id)));
route('GET', '/recordings/([^/]+)', (_req, [id]) => ok(getStore().getRecording(id) ?? notFound(`recording ${id} not found`)));

route('POST', '/motion/preview', (req) => {
  const b = body(req);
  const duration = Number(b.duration_s);
  if (!(duration > 0 && duration <= MAX_PREVIEW_S)) invalid(`duration_s must be greater than 0 and at most ${MAX_PREVIEW_S}`);
  return ok({ frames: synthesise(motion(b.motion), side(b.side, 'right'), duration, 60) });
});
route('POST', '/motion/from_text', async (req) => {
  const b = body(req);
  if (typeof b.text !== 'string' || !b.text.length) invalid('text is required');
  if ((b.text as string).length > 200) invalid('text must be at most 200 characters');
  await sleep(250);
  return ok({ ...templateMotion(b.text as string), provider: MOCK_PROVIDER });
});

route('POST', '/score', async (req) => {
  await sleep(40);
  try {
    return ok(score(body(req)));
  } catch (e) {
    if (e instanceof ScoringError) return bad(e.message);
    throw e;
  }
});

route('POST', '/coach/hint', (req) => {
  const b = body(req);
  const deviations = (isObj(b.deviations) ? b.deviations : {}) as Partial<Record<Finger, number>>;
  const tol = b.tolerance_deg === undefined ? DEFAULT_TOLERANCE_ANGLE_DEG : Number(b.tolerance_deg);
  if (!(tol > 0)) invalid('tolerance_deg must be positive');
  return ok({ hint: buildHint(deviations, Number(b.timing_ms ?? 0), thresholds(margin(b.margin), tol)), provider: 'algorithmic' });
});
route('POST', '/coach/plan', async (req) => {
  const b = body(req);
  if (typeof b.lesson_title !== 'string' || !Array.isArray(b.steps) || !Array.isArray(b.attempts)) invalid('lesson_title, steps and attempts are required');
  if ((b.steps as unknown[]).length > 20) invalid('at most 20 steps');
  if ((b.attempts as unknown[]).length > 60) invalid('at most 60 attempts');
  await sleep(400);
  return ok({ ...templatePlan(b as unknown as Parameters<typeof templatePlan>[0]), provider: MOCK_PROVIDER });
});

route('POST', '/vision/hands', () => ok({ detail: 'Hand tracking from the webcam is not available in mock mode.' }, 503));

/** Accepts one GloveFrame, one HandFrame or {frames: [...]}, like POST /api/ingest/frames. */
function ingestFrames(raw: unknown): GloveFrame[] {
  const list = isObj(raw) && Array.isArray(raw.frames) ? raw.frames : [raw];
  if (list.length > 600) invalid('at most 600 frames per request');
  const t0 = getHub().now();
  return list.map((item) => {
    if (!isObj(item)) return invalid('frame must be an object');
    if (Array.isArray(item.hands)) return { t: typeof item.t === 'number' ? item.t : t0, source: 'replay', hands: item.hands } as GloveFrame;
    if (item.side === 'left' || item.side === 'right') {
      const hand = { wrist_quat: [0, 0, 0, 1], wrist_pos: null, ...item } as unknown as GloveFrame['hands'][number];
      return { t: t0, source: 'replay', hands: [hand] } as GloveFrame;
    }
    return invalid('frame must be a GloveFrame or a HandFrame');
  });
}

route('POST', '/ingest/frames', (req) => {
  const store = getStore();
  if (req.query.get('activate') === '1' && store.dev.glove_source !== 'external') {
    store.dev.glove_source = 'external';
    getHub().setExternal(true);
  }
  if (store.dev.glove_source !== 'external') throw new HttpError(409, 'Glove source is not external; pass ?activate=1 to switch.');
  const frames = ingestFrames(req.json);
  getHub().ingest(frames);
  return ok({ accepted: frames.length });
});

route('GET', '/dev/state', () => ok(getStore().dev));
route('POST', '/dev/state', (req) => {
  const b = body(req);
  const store = getStore();
  if (b.simulator_motion !== undefined) {
    const m = motion(b.simulator_motion);
    getHub().setMotion(m);
  }
  if (b.smoothing !== undefined) {
    if (!isObj(b.smoothing)) invalid('smoothing must be an object');
    const s = b.smoothing as Record<string, unknown>;
    if (s.min_cutoff !== undefined && !(Number(s.min_cutoff) > 0)) invalid('min_cutoff must be greater than 0');
    if (s.beta !== undefined && !(Number(s.beta) >= 0)) invalid('beta must be at least 0');
    if (s.enabled !== undefined) store.dev.smoothing.enabled = Boolean(s.enabled);
    if (s.min_cutoff !== undefined) store.dev.smoothing.min_cutoff = Number(s.min_cutoff);
    if (s.beta !== undefined) store.dev.smoothing.beta = Number(s.beta);
  }
  if (b.llm_provider !== undefined) {
    if (!['fake', 'gemini', 'ollama'].includes(b.llm_provider as string)) invalid('llm_provider must be fake, gemini or ollama');
    store.dev.llm_provider = b.llm_provider as 'fake' | 'gemini' | 'ollama';
  }
  if (b.glove_source !== undefined) {
    if (b.glove_source !== 'simulator' && b.glove_source !== 'external') {
      throw new HttpError(503, 'Only the simulator and external glove sources exist in mock mode.');
    }
    store.dev.glove_source = b.glove_source;
    getHub().setExternal(b.glove_source === 'external');
  }
  store.saveDev();
  return ok(store.dev);
});

/** Runs a request against the mock backend and returns the status and JSON body. */
export async function handleMockRequest(req: MockRequest): Promise<MockResponse> {
  const path = req.path.replace(/\/+$/, '') || '/';
  // The client never sends these while the assistant is off; refuse them here too, as a second lock.
  if (req.method.toUpperCase() === 'POST' && isAssistantPath(path) && !isAssistantOn()) return { status: 403, body: { detail: 'The assistant is off.' } };
  const matches = routes.filter((r) => r.pattern.test(path));
  const hit = matches.find((r) => r.method === req.method.toUpperCase());
  if (!hit) return matches.length ? { status: 405, body: { detail: 'Method Not Allowed' } } : { status: 404, body: { detail: 'Not Found' } };
  const params = (hit.pattern.exec(path) as RegExpExecArray).slice(1).map(decodeURIComponent);
  try {
    return await hit.handler(req, params);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: { detail: e.message } };
    return { status: 500, body: { detail: e instanceof Error ? e.message : 'Internal Server Error' } };
  }
}
