import type {
  CalibrationRequest,
  Calibration,
  CoachHintRequest,
  CoachHintResponse,
  CoachPlanRequest,
  CoachPlanResponse,
  GenerateFromVideoOptions,
  MotionFromTextRequest,
  MotionFromTextResponse,
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
import { isAssistantOn, isAssistantPath } from '../features/shared/assistant';

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

/** Thrown, without any network request, for an assistant endpoint while the assistant is switched off. */
export class AssistantOffError extends ApiError {
  constructor(path: string) {
    super('The assistant is off. Turn it on to use this.', 403, path);
    this.name = 'AssistantOffError';
  }
}

/** Refuses an assistant request while the switch is off, before anything is sent (mock mode included). */
function guardAssistant(path: string): void {
  if (isAssistantPath(path) && !isAssistantOn()) throw new AssistantOffError(path);
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
  guardAssistant(path);
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

/**
 * POST a multipart body with XMLHttpRequest, because fetch cannot report upload progress.
 * `onProgress` receives whole percentages (0 to 100) so callers re-render a few dozen times at most.
 */
function upload<T>(path: string, body: FormData, onProgress?: (percent: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    guardAssistant(path);
    const xhr = new XMLHttpRequest();
    let last = -1;
    xhr.open('POST', `${BASE}${path}`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      const pct = Math.floor((e.loaded / e.total) * 100);
      if (pct !== last) {
        last = pct;
        onProgress(pct);
      }
    };
    xhr.onerror = () => reject(new ApiError('Cannot reach the backend. Is it running on port 8000?', 0, path));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
    xhr.onload = () => {
      let parsed: unknown = undefined;
      if (xhr.responseText) {
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {
          parsed = xhr.responseText;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(parsed as T);
      else reject(new ApiError(describeDetail(parsed) ?? `POST ${path} failed with ${xhr.status}`, xhr.status, path, parsed));
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(body);
  });
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

  /** POST /api/lessons/generate_from_video: a clip of 50 MB at most (mp4, webm or mov) becomes a draft lesson. */
  generateLessonFromVideo: (video: File, opts: GenerateFromVideoOptions = {}, onProgress?: (percent: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.append('video', video);
    if (opts.prompt) form.append('prompt', opts.prompt);
    if (opts.skill) form.append('skill', opts.skill);
    return upload<GenerateLessonResponse>('/lessons/generate_from_video', form, onProgress, signal);
  },

  calibrate: (req: CalibrationRequest) => request<Calibration>('POST', '/calibrations', req),
  latestCalibration: (side: 'left' | 'right', signal?: AbortSignal) =>
    request<Calibration>('GET', `/calibrations/latest${qs({ side })}`, undefined, signal),

  startRecording: (req: RecordingStartRequest = {}) => request<RecordingStartResponse>('POST', '/recordings/start', req),
  stopRecording: (id: string) => request<Recording>('POST', `/recordings/${encodeURIComponent(id)}/stop`),
  recording: (id: string, signal?: AbortSignal) => request<Recording>('GET', `/recordings/${encodeURIComponent(id)}`, undefined, signal),

  previewMotion: (req: MotionPreviewRequest) => request<MotionPreviewResponse>('POST', '/motion/preview', req),
  score: (req: ScoreRequest) => request<ScoreResult>('POST', '/score', req),
  coachPlan: (req: CoachPlanRequest) => request<CoachPlanResponse>('POST', '/coach/plan', req),
  motionFromText: (req: MotionFromTextRequest) => request<MotionFromTextResponse>('POST', '/motion/from_text', req),
  coachHint: (req: CoachHintRequest) => request<CoachHintResponse>('POST', '/coach/hint', req),

  devState: (signal?: AbortSignal) => request<DevState>('GET', '/dev/state', undefined, signal),
  setDevState: (patch: DevStatePatch) => request<DevState>('POST', '/dev/state', patch),
};

export type Api = typeof api;
