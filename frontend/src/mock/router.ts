import type {
  CalibrationCapturePhase,
  Calibration,
  Finger,
  LlmProvider,
  FingerWeights,
  GloveFrame,
  JointTriple,
  Lesson,
  Margin,
  MediaInfo,
  MediaRef,
  MotionSpec,
  Recording,
  RecordingSummary,
  ScoreResult,
  Hands,
  Side,
  Skill,
  Step,
  Tolerance,
  WearerCalibration,
} from '../api/types';
import { mockCaptureNeutral, mockDriftCheck, mockDriverAction, mockGloveScenario, mockGloveStatus } from './rig';
import { getHub, isMotionSpec } from './glove';
import { newId, nowIso } from './ids';
import { MOCK_PROVIDER, templateLesson, templateLessonFromVideo, templateMotion, templatePlan, type LessonDraftBody } from './llm';
import { MOVES } from './seed';
import { applyCalibrationMasks, buildHint, compare, resample, ScoringError, toResult, calibrateAttempt, STATIC_PRESETS, thresholds, fingerThresholds, DEFAULT_TOLERANCE_ANGLE_DEG } from './scoring';
import { modelFromFrames, TAKES_HARD_MIN, TAKES_MAX } from './takes';
import { DEFAULT_MARGIN, isMargin } from '../api/margin';
import { getStore } from './store';
import { deleteMedia, getMedia, putMedia } from './media';
import { FINGERS } from '../api/types';
import { isAssistantOn, isAssistantPath } from '../features/shared/assistant';
import { handFrame, synthesise } from './synth';
import * as persist from './persist';

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
const SKILLS: Skill[] = ['table_tennis', 'piano', 'finnish_fingerspelling', 'fingerspelling', 'shadow_puppets', 'general'];
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
/** MEDIA_MAX_BYTES and MEDIA_MAX_OFFSET_S in backend/app/constants.py. */
const MAX_MEDIA_BYTES = 200 * 1024 * 1024;
const MAX_MEDIA_OFFSET_S = 3600;
const MAX_MEDIA_DURATION_S = 4 * 3600;
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
  return SKILLS.includes(v as Skill) ? (v as Skill) : invalid('skill must be table_tennis, piano, finnish_fingerspelling, shadow_puppets or general');
}

/** A per-finger degree map: known fingers only, every value positive; null when absent. */
function fingerDegrees(v: unknown, name: string): Partial<Record<Finger, number>> | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) return invalid(`${name} must be an object`);
  const out: Partial<Record<Finger, number>> = {};
  for (const [k, raw] of Object.entries(v)) {
    if (!FINGERS.includes(k as Finger)) return invalid(`${name} has an unknown finger: ${k}`);
    const n = Number(raw);
    if (!(n > 0)) return invalid(`${name} values must be positive`);
    out[k as Finger] = n;
  }
  return out;
}

function tolerance(v: unknown): Tolerance {
  if (v === undefined || v === null) return { ...DEFAULT_TOLERANCE, finger_angle_deg: null };
  if (!isObj(v)) return invalid('tolerance must be an object');
  const angle = v.angle_deg === undefined ? DEFAULT_TOLERANCE.angle_deg : Number(v.angle_deg);
  const timing = v.timing_ms === undefined ? DEFAULT_TOLERANCE.timing_ms : Number(v.timing_ms);
  if (!(angle > 0) || !(timing > 0)) return invalid('tolerance values must be positive');
  return { angle_deg: angle, timing_ms: timing, finger_angle_deg: fingerDegrees(v.finger_angle_deg, 'finger_angle_deg') };
}

function takeIds(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return invalid('take_ids must be a list of strings');
  if (v.length > TAKES_MAX) return invalid(`take_ids must have at most ${TAKES_MAX} items`);
  return v as string[];
}

/** A video reference on a step or a take: null, or {media_id, url, offset_s} with a bounded offset. */
function mediaRef(v: unknown, name: string): MediaRef | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v) || typeof v.media_id !== 'string' || typeof v.url !== 'string') return invalid(`${name} needs media_id and url`);
  const offset = v.offset_s === undefined ? 0 : Number(v.offset_s);
  if (!Number.isFinite(offset) || Math.abs(offset) > MAX_MEDIA_OFFSET_S) return invalid(`${name}.offset_s must be within ${MAX_MEDIA_OFFSET_S} s`);
  return { media_id: v.media_id, url: v.url, offset_s: offset };
}

/** The base type of a MediaRecorder type: 'video/webm;codecs=vp9' is 'video/webm'. */
const baseType = (type: string) => type.split(';')[0].trim().toLowerCase();

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
    take_ids: takeIds(raw.take_ids),
    repetitions: reps,
    tolerance: tolerance(raw.tolerance),
    video_url: (raw.video_url as string | null | undefined) ?? null,
    tutorial_video: mediaRef(raw.tutorial_video, 'tutorial_video'),
    weights: fingerWeights(raw.weights),
  };
}

/** Optional per-finger weights (Step.weights, ScoreRequest.weights): five numbers, or null. */
function fingerWeights(v: unknown): FingerWeights | null {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) return invalid('weights must be an object of five finger numbers');
  const out = {} as FingerWeights;
  for (const f of FINGERS) {
    const n = v[f] === undefined ? 0 : Number(v[f]);
    if (!Number.isFinite(n)) return invalid(`weights.${f} must be a number`);
    out[f] = n;
  }
  return out;
}

function normaliseLesson(raw: unknown): LessonDraftBody {
  if (!isObj(raw)) return invalid('request body must be a JSON object');
  if (typeof raw.title !== 'string' || !raw.title) return invalid('title is required');
  if (!SKILLS.includes(raw.skill as Skill)) return invalid('skill must be table_tennis, piano, finnish_fingerspelling, shadow_puppets or general');
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
async function captureFlexion(sideName: Side, phase: CalibrationCapturePhase, durationS: number): Promise<Record<Finger, JointTriple>> {
  await sleep(durationS * 1000);
  const level = phase === 'fist' ? 1 : 0;
  const pose = { thumb: phase === 'flat' ? 0 : 1, index: level, middle: level, ring: level, little: level };
  const hand = handFrame({ preset: 'hold_pose', pose }, sideName, 0);
  return hand.flexion;
}

const zeroFlexion = (): Record<Finger, JointTriple> => ({ thumb: [0, 0, 0], index: [0, 0, 0], middle: [0, 0, 0], ring: [0, 0, 0], little: [0, 0, 0] });
const pendingPhases = new Map<Side, Partial<Record<CalibrationCapturePhase, Record<Finger, JointTriple>>>>();

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
  let weights: Partial<Record<Finger, number>> | null = fingerWeights(b.weights);
  let jointMask: number[][] | null = null;
  const reference = resample(referenceFrames, sideName);
  let attempt = resample(attemptFrames, sideName);
  const ownId = b.attempt_calibration_id as string | undefined;
  const refId = b.reference_calibration_id as string | undefined;
  if (ownId || refId || b.use_latest_calibration === true) {
    const own = ownId ? getCalibration(ownId) : b.use_latest_calibration === true ? latestCalibration(sideName) : null;
    const refCal = refId ? getCalibration(refId) : null;
    if (own) {
      attempt = calibrateAttempt(attempt, own, refCal, warnings);
      const masked = applyCalibrationMasks(own, weights, warnings);
      jointMask = masked.jointMask;
      weights = masked.weights;
    }
  }
  const declaredStatic = hasRefMotion && STATIC_PRESETS.includes((b.reference_motion as { preset?: string }).preset ?? '') ? true : undefined;
  return { ...toResult(compare(reference, attempt, SCORE_FPS, declaredStatic, jointMask), tol, chosen, weights), warnings };
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
  if (b.phase !== 'flat' && b.phase !== 'fist' && b.phase !== 'thumb') invalid("phase must be 'flat', 'fist' or 'thumb'");
  const duration = b.duration_s === undefined ? 1.5 : Number(b.duration_s);
  if (!(duration > 0 && duration <= 10)) invalid('duration_s must be greater than 0 and at most 10');
  const averaged = await captureFlexion(sideName, b.phase as CalibrationCapturePhase, duration);
  const phases = pendingPhases.get(sideName) ?? {};
  phases[b.phase as CalibrationCapturePhase] = averaged;
  pendingPhases.set(sideName, phases);
  const cal: Calibration = { id: newId(), side: sideName, flat: phases.flat ?? zeroFlexion(), fist: phases.fist ?? zeroFlexion(), thumb: phases.thumb ?? null, created_at: nowIso() };
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
route('GET', '/recordings', (req) => {
  const stepId = req.query.get('step_id');
  const lessonId = req.query.get('lesson_id');
  const summaries: RecordingSummary[] = getStore()
    .listRecordings()
    .filter((r) => (stepId === null || r.step_id === stepId) && (lessonId === null || r.lesson_id === lessonId))
    .map(({ frames, ...rest }) => ({ ...rest, frame_count: frames.length }));
  return ok(summaries);
});
route('POST', '/recordings/model', async (req) => {
  const b = body(req);
  const ids = b.recording_ids;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) return invalid('recording_ids must be a list of strings');
  if (ids.length < TAKES_HARD_MIN || ids.length > TAKES_MAX) return invalid(`recording_ids must have ${TAKES_HARD_MIN} to ${TAKES_MAX} items`);
  if (new Set(ids).size !== ids.length) return invalid('recording_ids must be distinct');
  const timing = b.timing_ms === undefined ? DEFAULT_TOLERANCE.timing_ms : Number(b.timing_ms);
  if (!(timing > 0)) return invalid('timing_ms must be positive');
  const wanted = b.side === undefined || b.side === null ? null : side(b.side);
  const frames = (ids as string[]).map((id) => (getStore().getRecording(id) ?? notFound(`recording ${id} not found`)).frames);
  await sleep(120);
  try {
    return ok(modelFromFrames(frames, ids as string[], wanted, timing));
  } catch (e) {
    if (e instanceof ScoringError) return bad(e.message);
    throw e;
  }
});
route('GET', '/recordings/([^/]+)', (_req, [id]) => ok(getStore().getRecording(id) ?? notFound(`recording ${id} not found`)));
route('DELETE', '/recordings/([^/]+)', (_req, [id]) => {
  const active = takes.get(id);
  if (active) {
    // A take still recording is discarded, as the backend recorder does.
    active.stop();
    takes.delete(id);
    return ok(null, 204);
  }
  return getStore().deleteRecording(id) ? ok(null, 204) : notFound(`recording ${id} not found`);
});

route('PUT', '/recordings/([^/]+)/video', async (req, [id]) => {
  const b = body(req);
  if (typeof b.media_id !== 'string') return invalid('media_id is required');
  const entry = (await getMedia(b.media_id)) ?? notFound(`media ${b.media_id} not found`);
  const rec = getStore().getRecording(id) ?? notFound(`recording ${id} not found`);
  const video = mediaRef({ media_id: entry.info.id, url: entry.info.url, offset_s: b.offset_s }, 'video') as MediaRef;
  const { frames, ...rest } = getStore().saveRecording({ ...rec, video });
  return ok({ ...rest, frame_count: frames.length });
});
route('DELETE', '/recordings/([^/]+)/video', (_req, [id]) => {
  const rec = getStore().getRecording(id) ?? notFound(`recording ${id} not found`);
  const { frames, ...rest } = getStore().saveRecording({ ...rec, video: null });
  return ok({ ...rest, frame_count: frames.length });
});

route('POST', '/media', async (req) => {
  const video = req.form?.get('video');
  if (!(video instanceof Blob)) return invalid('video file is required');
  const type = baseType(video.type);
  if (!VIDEO_TYPES.includes(type)) throw new HttpError(415, `video must be one of ${VIDEO_TYPES.join(', ')}`);
  if (video.size === 0) return bad('video file is empty');
  if (video.size > MAX_MEDIA_BYTES) throw new HttpError(413, `video is larger than ${MAX_MEDIA_BYTES / (1024 * 1024)} MB`);
  const rawDuration = req.form?.get('duration_s');
  const duration = rawDuration === null || rawDuration === undefined || rawDuration === '' ? null : Number(rawDuration);
  if (duration !== null && !(duration >= 0 && duration <= MAX_MEDIA_DURATION_S)) return bad(`duration_s must be between 0 and ${MAX_MEDIA_DURATION_S}`);
  const id = newId();
  const info: MediaInfo = { id, url: `/api/media/${id}`, duration_s: duration, content_type: type as MediaInfo['content_type'], size_bytes: video.size, created_at: nowIso() };
  await putMedia(info, video);
  return ok(info, 201);
});
route('GET', '/media/([^/]+)', async (_req, [id]) => {
  const entry = (await getMedia(id)) ?? notFound(`media ${id} not found`);
  return ok(entry.blob);
});
route('DELETE', '/media/([^/]+)', async (_req, [id]) => ((await deleteMedia(id)) ? ok(null, 204) : notFound(`media ${id} not found`)));

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
  const chosen = margin(b.margin);
  const perFinger = fingerThresholds({ angle_deg: tol, timing_ms: DEFAULT_TOLERANCE.timing_ms, finger_angle_deg: fingerDegrees(b.finger_tolerance_deg, 'finger_tolerance_deg') }, chosen);
  return ok({ hint: buildHint(deviations, Number(b.timing_ms ?? 0), thresholds(chosen, tol), perFinger), provider: 'algorithmic' });
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

/* ---- real gloves (src/mock/rig.ts): simulated status, per-wearer calibration, drift check ---- */

const WEARER_MAX = 40;

function wearerName(v: unknown): string {
  const name = typeof v === 'string' ? v.split(/\s+/).filter(Boolean).join(' ') : '';
  if (!name || (typeof v === 'string' && v.length > WEARER_MAX)) invalid(`wearer must be 1 to ${WEARER_MAX} characters`);
  return name;
}

function durationOf(v: unknown, fallback: number): number {
  const d = v === undefined ? fallback : Number(v);
  if (!(d > 0 && d <= 10)) invalid('duration_s must be greater than 0 and at most 10');
  return d;
}

function wearerCalibrations(wearer?: string): WearerCalibration[] {
  const all = getStore().listWearerCalibrations();
  const mine = wearer === undefined ? all : all.filter((c) => c.wearer.toLowerCase() === wearer.toLowerCase());
  return [...mine].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function latestWearer(wearer: string): WearerCalibration {
  return wearerCalibrations(wearer)[0] ?? notFound(`no glove calibration saved for ${wearer}`);
}

route('GET', '/gloves/status', () => ok(mockGloveStatus(getStore().dev.glove_source)));
route('POST', '/gloves/driver', (req) => {
  const action = body(req).action;
  if (action !== 'start' && action !== 'stop') invalid("action must be 'start' or 'stop'");
  if (action === 'start' && mockGloveScenario() === 'studio') throw new HttpError(409, 'Rokoko Studio is open and holds the gloves. Close Studio first.');
  mockDriverAction(action as 'start' | 'stop');
  return ok(mockGloveStatus(getStore().dev.glove_source));
});
route('POST', '/gloves/reinit', () => ok({ devices: mockGloveStatus(getStore().dev.glove_source).gloves.filter((g) => g.connected).length }));
route('GET', '/gloves/calibrations', (req) => ok(wearerCalibrations(req.query.get('wearer') ?? undefined)));
route('GET', '/gloves/calibrations/latest', (req) => ok(latestWearer(wearerName(req.query.get('wearer')))));
route('POST', '/gloves/calibrations/neutral', async (req) => {
  const b = body(req);
  const wearer = wearerName(b.wearer);
  try {
    const cal = await mockCaptureNeutral(wearer, durationOf(b.duration_s, 3), b.reinit === true, newId(), nowIso());
    return ok(getStore().saveWearerCalibration(cal));
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
});
route('POST', '/gloves/calibrations/([^/]+)/finish', (req, [id]) => {
  const record = getStore().listWearerCalibrations().find((c) => c.id === id) ?? notFound(`glove calibration ${id} not found`);
  const b = body(req);
  const next: WearerCalibration = { ...record };
  if (b.range_calibration_ids !== undefined && b.range_calibration_ids !== null) {
    if (!isObj(b.range_calibration_ids)) invalid('range_calibration_ids must be an object');
    const ids = b.range_calibration_ids as Partial<Record<Side, string>>;
    for (const s of SIDES) {
      const rid = ids[s];
      if (rid === undefined) continue;
      if (getCalibration(rid).side !== s) bad(`calibration ${rid} is not for the ${s} hand`);
    }
    next.range_calibration_ids = { ...record.range_calibration_ids, ...ids };
  }
  if (typeof b.verified === 'boolean') next.verified = b.verified;
  return ok(getStore().saveWearerCalibration(next));
});
route('POST', '/gloves/drift_check', async (req) => {
  const b = body(req);
  const saved = latestWearer(wearerName(b.wearer));
  try {
    return ok(await mockDriftCheck(saved, durationOf(b.duration_s, 2)));
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
});

// Dev file reveal: sample data has no file on disk, so both answer a mock:// path and open nothing.
const FILE_KINDS = ['recording', 'lesson', 'draft', 'export', 'calibration', 'media'];
const MOCK_FILE_DIRS: Record<string, string> = { recording: 'recordings', lesson: 'lessons', draft: 'drafts', export: 'exports', calibration: 'calibrations', media: 'media' };
const mockFile = (kind: unknown, id: unknown) => {
  if (typeof kind !== 'string' || !FILE_KINDS.includes(kind)) invalid(`kind must be one of ${FILE_KINDS.join(', ')}`);
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,159}$/.test(id) || id.includes('..')) bad(`invalid id: ${String(id)}`);
  return ok({ kind, id, path: `mock://${MOCK_FILE_DIRS[kind as string]}/${id as string}.json`, opened: false });
};
route('POST', '/dev/reveal', (req) => {
  const b = body(req);
  return mockFile(b.kind, b.id);
});
route('GET', '/dev/locate', (req) => mockFile(req.query.get('kind'), req.query.get('id')));
// Glove compare captures: nothing to save without a backend, so the paths say mock:// and nothing is written.
route('POST', '/dev/glove_compare', (req) => {
  const b = body(req);
  const safe = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v);
  if (!safe(b.session) || !safe(b.slug)) invalid('session and slug must be safe ids');
  const index = Number(b.index);
  if (!Number.isInteger(index) || index < 0 || index > 99) invalid('index must be 0 to 99');
  if (!isObj(b.data)) invalid('data must be an object');
  const stem = `mock://glove_compare/${b.session as string}/${String(index).padStart(2, '0')}-${b.slug as string}`;
  return ok({ json_path: `${stem}.json`, png_path: typeof b.png === 'string' && b.png ? `${stem}.png` : null });
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
    if (!['fake', 'gemini', 'openai'].includes(b.llm_provider as string)) invalid('llm_provider must be fake, gemini or openai');
    store.dev.llm_provider = b.llm_provider as LlmProvider;
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

/* ---- Expert training persistence: drafts, bundle export and import (mock/persist.ts) ---- */
const persisted = (run: Handler): Handler => async (req, params) => {
  try {
    return await run(req, params);
  } catch (e) {
    if (e instanceof persist.PersistError) throw new HttpError(e.status, e.message);
    throw e;
  }
};
const draftKind = (kind: string): string => (kind === 'scratch' ? kind : invalid("kind must be 'scratch'"));
route('GET', '/calibrations/active', () => ok(persist.activeCalibration()));
route('GET', '/drafts/([^/]+)', persisted((_req, [kind]) => ok(persist.latestDraft(draftKind(kind)))));
route('GET', '/drafts/([^/]+)/([^/]+)', persisted((_req, [kind, id]) => ok(persist.getDraft(draftKind(kind), id))));
route('PUT', '/drafts/([^/]+)/([^/]+)', persisted((req, [kind, id]) => ok(persist.putDraft(draftKind(kind), id, req.json))));
route('DELETE', '/drafts/([^/]+)/([^/]+)', persisted((_req, [kind, id]) => {
  persist.deleteDraft(draftKind(kind), id);
  return ok(null, 204);
}));
route('GET', '/lessons/([^/]+)/export', (_req, [id]) => ok(persist.exportLessons([getStore().getLesson(id) ?? notFound(`lesson ${id} not found`)])));
route('GET', '/export/lessons', (req) => {
  const ids = [...new Set((req.query.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (!ids.length) return invalid('ids is required');
  return ok(persist.exportLessons(ids.map((id) => getStore().getLesson(id) ?? notFound(`lesson ${id} not found`)), req.query.get('name') ?? undefined));
});
route('GET', '/export/all', () => ok(persist.exportAll()));
route('POST', '/lessons/import', persisted((req) => ok(persist.importBundle(req.json, req.query.get('overwrite') === 'true'))));

/** Runs a request against the mock backend and returns the status and JSON body. */
export async function handleMockRequest(req: MockRequest): Promise<MockResponse> {
  const path = req.path.replace(/\/+$/, '') || '/';
  // The client never sends these while the AI Assistant is off; refuse them here too, as a second lock.
  if (req.method.toUpperCase() === 'POST' && isAssistantPath(path) && !isAssistantOn()) return { status: 403, body: { detail: 'The AI Assistant is off.' } };
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
