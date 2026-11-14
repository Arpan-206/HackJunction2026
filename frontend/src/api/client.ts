import type {
  CalibrationRequest,
  Calibration,
  CalibrationFinishRequest,
  DriftCheckRequest,
  DriftCheckResult,
  DriverActionRequest,
  GloveRigStatus,
  NeutralCaptureRequest,
  ReinitResult,
  WearerCalibration,
  CoachHintRequest,
  CoachHintResponse,
  CoachPlanRequest,
  CoachPlanResponse,
  GenerateFromVideoOptions,
  MotionFromTextRequest,
  MotionFromTextResponse,
  DevState,
  DevStatePatch,
  FileKind,
  FileLocation,
  GloveCompareSave,
  GloveCompareSaved,
  GenerateLessonRequest,
  GenerateLessonResponse,
  HealthResponse,
  Lesson,
  LessonDraft,
  MediaAttachRequest,
  MediaInfo,
  MediaUploadOptions,
  MotionPreviewRequest,
  MotionPreviewResponse,
  MoveKind,
  Recording,
  RecordingListQuery,
  RecordingStartRequest,
  RecordingSummary,
  RecordingStartResponse,
  ScoreRequest,
  ScoreResult,
  Skill,
  TakesModel,
  TakesModelRequest,
} from './types';
import type { ActiveCalibration, Bundle, DraftDoc, DraftKind, ImportReport } from './types';
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

/** Thrown, without any network request, for an assistant endpoint while the AI Assistant is switched off. */
export class AssistantOffError extends ApiError {
  constructor(path: string) {
    super('The AI Assistant is off. Turn it on in Settings to use this.', 403, path);
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
  /** GET /api/recordings: stored takes without frames, oldest first, optionally for one step or lesson. */
  recordings: (query: RecordingListQuery = {}, signal?: AbortSignal) =>
    request<RecordingSummary[]>('GET', `/recordings${qs({ step_id: query.step_id, lesson_id: query.lesson_id })}`, undefined, signal),
  /** DELETE /api/recordings/{id}: deletes a stored take, or discards one still recording (204; 404 when unknown). */
  deleteRecording: (id: string) => request<void>('DELETE', `/recordings/${encodeURIComponent(id)}`),
  /** POST /api/recordings/model: 2 to 5 takes become the reference (the medoid take) plus a per-finger tolerance. */
  takesModel: (req: TakesModelRequest) => request<TakesModel>('POST', '/recordings/model', req),

  /**
   * POST /api/media: stores an expert video (webm, mp4 or mov; 415 otherwise, 413 above 200 MB) and returns its id and
   * url. A recorded Blob is sent as a file named after `opts.filename` (default `clip` plus the type's extension).
   */
  uploadMedia: (video: Blob, opts: MediaUploadOptions = {}, onProgress?: (percent: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    const ext = video.type.includes('mp4') ? '.mp4' : video.type.includes('quicktime') ? '.mov' : '.webm';
    form.append('video', video, opts.filename ?? (video instanceof File ? video.name : `clip${ext}`));
    if (opts.duration_s !== undefined && Number.isFinite(opts.duration_s)) form.append('duration_s', String(opts.duration_s));
    return upload<MediaInfo>('/media', form, onProgress, signal);
  },
  /** DELETE /api/media/{id}: removes a stored video (204; 404 when unknown). Steps or takes still pointing at it fall back to their still. */
  deleteMedia: (id: string) => request<void>('DELETE', `/media/${encodeURIComponent(id)}`),
  /** PUT /api/recordings/{id}/video: attaches the webcam video filmed during a take, with the video time at its frame 0. */
  attachTakeVideo: (recordingId: string, req: MediaAttachRequest) =>
    request<RecordingSummary>('PUT', `/recordings/${encodeURIComponent(recordingId)}/video`, req),
  /** DELETE /api/recordings/{id}/video: detaches a take's video (the file stays until deleteMedia). */
  detachTakeVideo: (recordingId: string) => request<RecordingSummary>('DELETE', `/recordings/${encodeURIComponent(recordingId)}/video`),

  previewMotion: (req: MotionPreviewRequest) => request<MotionPreviewResponse>('POST', '/motion/preview', req),
  score: (req: ScoreRequest) => request<ScoreResult>('POST', '/score', req),
  coachPlan: (req: CoachPlanRequest) => request<CoachPlanResponse>('POST', '/coach/plan', req),
  motionFromText: (req: MotionFromTextRequest) => request<MotionFromTextResponse>('POST', '/motion/from_text', req),
  coachHint: (req: CoachHintRequest) => request<CoachHintResponse>('POST', '/coach/hint', req),

  gloveStatus: (signal?: AbortSignal) => request<GloveRigStatus>('GET', '/gloves/status', undefined, signal),
  gloveDriver: (req: DriverActionRequest) => request<GloveRigStatus>('POST', '/gloves/driver', req),
  gloveReinit: () => request<ReinitResult>('POST', '/gloves/reinit'),
  wearerCalibrations: (wearer?: string, signal?: AbortSignal) =>
    request<WearerCalibration[]>('GET', `/gloves/calibrations${qs({ wearer })}`, undefined, signal),
  latestWearerCalibration: (wearer: string, signal?: AbortSignal) =>
    request<WearerCalibration>('GET', `/gloves/calibrations/latest${qs({ wearer })}`, undefined, signal),
  captureNeutral: (req: NeutralCaptureRequest) => request<WearerCalibration>('POST', '/gloves/calibrations/neutral', req),
  finishWearerCalibration: (id: string, req: CalibrationFinishRequest) =>
    request<WearerCalibration>('POST', `/gloves/calibrations/${encodeURIComponent(id)}/finish`, req),
  driftCheck: (req: DriftCheckRequest) => request<DriftCheckResult>('POST', '/gloves/drift_check', req),

  // Expert training persistence (docs/CONTRACT.md, "Expert training persistence").
  activeCalibration: (signal?: AbortSignal) => request<ActiveCalibration>('GET', '/calibrations/active', undefined, signal),
  latestDraft: <T = Record<string, unknown>>(kind: DraftKind, signal?: AbortSignal) => request<DraftDoc<T>>('GET', `/drafts/${kind}`, undefined, signal),
  saveDraft: <T = Record<string, unknown>>(kind: DraftKind, id: string, schemaVersion: number, draft: T) =>
    request<DraftDoc<T>>('PUT', `/drafts/${kind}/${encodeURIComponent(id)}`, { schema_version: schemaVersion, draft }),
  deleteDraft: (kind: DraftKind, id: string) => request<void>('DELETE', `/drafts/${kind}/${encodeURIComponent(id)}`),
  exportLesson: (id: string) => request<Bundle>('GET', `/lessons/${encodeURIComponent(id)}/export`),
  exportLessons: (ids: string[], name = '') => request<Bundle>('GET', `/export/lessons${qs({ ids: ids.join(','), name: name || undefined })}`),
  exportAll: () => request<Bundle>('GET', '/export/all'),
  importBundle: (bundle: Bundle, overwrite = false) => request<ImportReport>('POST', `/lessons/import${overwrite ? '?overwrite=true' : ''}`, bundle),

  devState: (signal?: AbortSignal) => request<DevState>('GET', '/dev/state', undefined, signal),
  setDevState: (patch: DevStatePatch) => request<DevState>('POST', '/dev/state', patch),
  /** Dev only: open the file manager on the backend machine with a stored file selected; returns its path. */
  revealFile: (kind: FileKind, id: string) => request<FileLocation>('POST', '/dev/reveal', { kind, id }),
  /** Dev only: save one glove compare capture under the data folder's glove_compare/<session>/. */
  saveGloveCompare: (save: GloveCompareSave) => request<GloveCompareSaved>('POST', '/dev/glove_compare', save),
  /** Dev only: a stored file's absolute path, without opening anything. */
  locateFile: (kind: FileKind, id: string) => request<FileLocation>('GET', `/dev/locate${qs({ kind, id })}`),
};

export type Api = typeof api;
