import type {
  CalibrationRequest,
  Calibration,
  CoachHintRequest,
  CoachHintResponse,
  DevState,
  DevStatePatch,
  GenerateLessonRequest,
  GenerateLessonResponse,
  HealthResponse,
  Lesson,
  LessonDraft,
  MotionPreviewRequest,
  MotionPreviewResponse,
  MoveKind,
  Recording,
  RecordingStartRequest,
  RecordingStartResponse,
  ScoreRequest,
  ScoreResult,
  Skill,
} from './types';

/** Error thrown for any failed request: HTTP error, network failure or unparseable body. */
export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly detail: unknown;

  constructor(message: string, status: number, path: string, detail?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.path = path;
    this.detail = detail;
  }

  /** True when the backend could not be reached at all. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

const BASE = '/api';

function describeDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'detail' in detail) {
    const d = (detail as { detail: unknown }).detail;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((x) => (x && typeof x === 'object' && 'msg' in x ? String((x as { msg: unknown }).msg) : String(x))).join('; ');
  }
  return null;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined || body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the backend. Is it running on port 8000?', 0, path, err);
  }

  const text = await res.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  if (!res.ok) {
    const msg = describeDetail(parsed) ?? `${method} ${path} failed with ${res.status}`;
    throw new ApiError(msg, res.status, path, parsed);
  }
  return parsed as T;
}

const qs = (params: Record<string, string | undefined>): string => {
  const p = Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined);
  return p.length ? `?${new URLSearchParams(p).toString()}` : '';
};

/** Typed wrapper over the REST API. Every method rejects with ApiError. */
export const api = {
  health: (signal?: AbortSignal) => request<HealthResponse>('GET', '/health', undefined, signal),

  moves: (skill?: Skill, signal?: AbortSignal) => request<MoveKind[]>('GET', `/moves${qs({ skill })}`, undefined, signal),

  lessons: (signal?: AbortSignal) => request<Lesson[]>('GET', '/lessons', undefined, signal),
  lesson: (id: string, signal?: AbortSignal) => request<Lesson>('GET', `/lessons/${encodeURIComponent(id)}`, undefined, signal),
  createLesson: (draft: LessonDraft) => request<Lesson>('POST', '/lessons', draft),
  updateLesson: (lesson: Lesson) => request<Lesson>('PUT', `/lessons/${encodeURIComponent(lesson.id)}`, lesson),
  generateLesson: (req: GenerateLessonRequest) => request<GenerateLessonResponse>('POST', '/lessons/generate', req),

  calibrate: (req: CalibrationRequest) => request<Calibration>('POST', '/calibrations', req),
  latestCalibration: (side: 'left' | 'right', signal?: AbortSignal) =>
    request<Calibration>('GET', `/calibrations/latest${qs({ side })}`, undefined, signal),

  startRecording: (req: RecordingStartRequest = {}) => request<RecordingStartResponse>('POST', '/recordings/start', req),
  stopRecording: (id: string) => request<Recording>('POST', `/recordings/${encodeURIComponent(id)}/stop`),
  recording: (id: string, signal?: AbortSignal) => request<Recording>('GET', `/recordings/${encodeURIComponent(id)}`, undefined, signal),

  previewMotion: (req: MotionPreviewRequest) => request<MotionPreviewResponse>('POST', '/motion/preview', req),
  score: (req: ScoreRequest) => request<ScoreResult>('POST', '/score', req),
  coachHint: (req: CoachHintRequest) => request<CoachHintResponse>('POST', '/coach/hint', req),

  devState: (signal?: AbortSignal) => request<DevState>('GET', '/dev/state', undefined, signal),
  setDevState: (patch: DevStatePatch) => request<DevState>('POST', '/dev/state', patch),
};

export type Api = typeof api;
