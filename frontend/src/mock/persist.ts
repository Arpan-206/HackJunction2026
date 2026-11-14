import type { ActiveCalibration, Bundle, Calibration, DraftDoc, ImportItem, ImportItemKind, ImportReport, Lesson, Recording, WearerCalibration } from '../api/types';
import { BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION } from '../api/types';
import { nowIso } from './ids';
import { getStore } from './store';
import { modelFromFrames, TAKES_HARD_MIN } from './takes';

/**
 * Mock mode's port of the expert training persistence routes (backend/app/services/drafts.py and bundles.py): drafts,
 * bundle export and import, and the calibrations in use. Drafts live in memory only (the scratch flow keeps its own
 * copy in localStorage); bundles read and write the mock store. Same shapes, ids and conflict rules as the backend.
 */

/** DRAFT_MAX_BYTES and DRAFTS_KEEP in backend/app/constants.py. */
export const DRAFT_MAX_BYTES = 512 * 1024;
const DRAFTS_KEEP = 20;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const drafts = new Map<string, DraftDoc>();

/** Thrown with an HTTP status; router.ts turns it into the {detail} body. */
export class PersistError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function checkId(id: string): void {
  if (!SAFE_ID.test(id)) throw new PersistError(400, `invalid id: '${id}'`);
}

export function latestDraft(kind: string): DraftDoc {
  const all = [...drafts.values()].filter((d) => d.kind === kind);
  if (!all.length) throw new PersistError(404, `no ${kind} draft saved`);
  return all.reduce((a, b) => (b.updated_at > a.updated_at ? b : a));
}

export function getDraft(kind: string, id: string): DraftDoc {
  const d = drafts.get(id);
  if (!d || d.kind !== kind) throw new PersistError(404, `${kind} draft ${id} not found`);
  return d;
}

export function putDraft(kind: string, id: string, body: unknown): DraftDoc {
  checkId(id);
  const b = body as { schema_version?: unknown; draft?: unknown } | null;
  if (!b || typeof b.schema_version !== 'number' || b.schema_version < 1 || !b.draft || typeof b.draft !== 'object' || Array.isArray(b.draft)) {
    throw new PersistError(422, 'body needs schema_version (>= 1) and a draft object');
  }
  if (JSON.stringify(b.draft).length > DRAFT_MAX_BYTES) throw new PersistError(413, `draft is larger than ${DRAFT_MAX_BYTES / 1024} KB`);
  // Strictly increasing times, so the newest draft is always the last one saved even within one millisecond.
  const last = [...drafts.values()].reduce((m, d) => (d.updated_at > m ? d.updated_at : m), '');
  let at = nowIso();
  if (at <= last) at = new Date(Date.parse(last) + 1).toISOString();
  const doc: DraftDoc = { id, kind: kind as DraftDoc['kind'], schema_version: b.schema_version, updated_at: at, draft: b.draft as Record<string, unknown> };
  drafts.set(id, doc);
  const old = [...drafts.values()].sort((x, y) => y.updated_at.localeCompare(x.updated_at)).slice(DRAFTS_KEEP);
  for (const d of old) drafts.delete(d.id);
  return doc;
}

export function deleteDraft(kind: string, id: string): void {
  if (drafts.get(id)?.kind === kind) drafts.delete(id);
}

/** Drops every mock draft (tests). */
export function resetMockDrafts(): void {
  drafts.clear();
}

export function activeCalibration(): ActiveCalibration {
  const cals = getStore().listCalibrations();
  const newest = (side: 'left' | 'right') => cals.filter((c) => c.side === side).reduce<Calibration | null>((a, b) => (!a || b.created_at > a.created_at ? b : a), null);
  const wearers = getStore().listWearerCalibrations();
  const wearer = wearers.reduce<WearerCalibration | null>((a, b) => (!a || b.created_at > a.created_at ? b : a), null);
  return { left: newest('left'), right: newest('right'), wearer };
}

function sidesOf(rec: Recording): string[] {
  const s = new Set(rec.frames.flatMap((f) => f.hands.map((h) => h.side)));
  return s.size ? [...s] : rec.hands === 'both' ? ['left', 'right'] : [rec.hands];
}

/** The bundle of some lessons: their takes, takes models, calibrations at recording time. Videos are listed only. */
export function exportLessons(lessons: Lesson[], name?: string): Bundle {
  const store = getStore();
  const warnings: string[] = [];
  const ids = [...new Set(lessons.flatMap((l) => l.steps.flatMap((s) => [...(s.reference_recording_id ? [s.reference_recording_id] : []), ...(s.take_ids ?? [])])))];
  const recordings: Recording[] = [];
  for (const id of ids) {
    const r = store.getRecording(id);
    if (r) recordings.push(r);
    else warnings.push(`take ${id} is referenced but not stored`);
  }
  const cals = [...store.listCalibrations()].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const chosen = new Map<string, Calibration>();
  for (const r of recordings) {
    for (const side of sidesOf(r)) {
      const same = cals.filter((c) => c.side === side);
      const before = same.filter((c) => c.created_at <= r.started_at);
      const pick = (before.length ? before : same).at(-1);
      if (pick) chosen.set(pick.id, pick);
    }
  }
  const wearers = store.listWearerCalibrations().filter((w) => Object.values(w.range_calibration_ids).some((id) => id && chosen.has(id)));
  const takes_models: Bundle['takes_models'] = [];
  for (const lesson of lessons) {
    for (const step of lesson.steps) {
      const takeIds = step.take_ids ?? [];
      if (takeIds.length < TAKES_HARD_MIN) continue;
      const frames = takeIds.map((id) => store.getRecording(id)?.frames);
      if (frames.some((f) => !f)) {
        warnings.push(`takes model of step '${step.title}' not rebuilt: a take is missing`);
        continue;
      }
      try {
        const model = modelFromFrames(frames as Recording['frames'][], takeIds, step.hands === 'both' ? null : step.hands, step.tolerance.timing_ms);
        takes_models.push({ lesson_id: lesson.id, step_id: step.id, model });
      } catch (e) {
        warnings.push(`takes model of step '${step.title}' not rebuilt: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const mediaIds = [
    ...new Set([
      ...lessons.flatMap((l) => l.steps.flatMap((s) => (s.tutorial_video ? [s.tutorial_video.media_id] : []))),
      ...recordings.flatMap((r) => (r.video ? [r.video.media_id] : [])),
    ]),
  ];
  for (const id of mediaIds) warnings.push(`video ${id} stays in this browser; sample data mode does not put videos in files`);
  return {
    format: BUNDLE_FORMAT,
    format_version: BUNDLE_FORMAT_VERSION,
    kind: 'lessons',
    name: name || lessons[0]?.title || '',
    exported_at: nowIso(),
    lessons,
    recordings,
    takes_models,
    calibrations: [...chosen.values()],
    wearer_calibrations: wearers,
    media: [],
    drafts: [],
    warnings,
  };
}

export function exportAll(): Bundle {
  const store = getStore();
  return {
    format: BUNDLE_FORMAT,
    format_version: BUNDLE_FORMAT_VERSION,
    kind: 'all',
    name: 'geppetto-backup',
    exported_at: nowIso(),
    lessons: store.listLessons(),
    recordings: store.listRecordings(),
    takes_models: [],
    calibrations: [...store.listCalibrations()],
    wearer_calibrations: [...store.listWearerCalibrations()],
    media: [],
    drafts: [...drafts.values()],
    warnings: [],
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Writes a bundle into the mock store with the backend's rules: new items added, identical ones left, differing ones
 * reported as conflicts (or replaced with overwrite). */
export function importBundle(raw: unknown, overwrite: boolean): ImportReport {
  const b = raw as Partial<Bundle> | null;
  if (!b || typeof b !== 'object' || (b.format !== undefined && b.format !== BUNDLE_FORMAT)) throw new PersistError(422, 'not a Geppetto bundle');
  if ((b.format_version ?? 1) > BUNDLE_FORMAT_VERSION) {
    throw new PersistError(422, `this file is format ${b.format_version}; this Geppetto reads up to ${BUNDLE_FORMAT_VERSION}`);
  }
  const store = getStore();
  const report: ImportReport = { created: [], unchanged: [], overwritten: [], conflicts: [], lesson_ids: [], warnings: [...(b.warnings ?? [])] };
  const merge = <T extends { id: string }>(kind: ImportItemKind, items: T[] | undefined, get: (id: string) => T | undefined, put: (item: T) => unknown) => {
    for (const item of items ?? []) {
      const local = get(item.id);
      const entry: ImportItem = { kind, id: item.id, note: '' };
      if (!local) {
        put(item);
        report.created.push(entry);
      } else if (same(local, item)) report.unchanged.push(entry);
      else if (overwrite) {
        put(item);
        report.overwritten.push(entry);
      } else report.conflicts.push({ ...entry, note: 'a different copy is already here; it was kept' });
    }
  };
  for (const m of b.media ?? []) report.warnings.push(`video ${m.info.id} is not loaded in sample data mode`);
  merge('calibration', b.calibrations, (id) => store.listCalibrations().find((c) => c.id === id), (c) => store.saveCalibration(c));
  merge('wearer_calibration', b.wearer_calibrations, (id) => store.listWearerCalibrations().find((c) => c.id === id), (c) => store.saveWearerCalibration(c));
  merge('recording', b.recordings, (id) => store.getRecording(id), (r) => store.saveRecording(r));
  merge('lesson', b.lessons, (id) => store.getLesson(id), (l) => store.saveLesson(l));
  merge('draft', b.drafts, (id) => drafts.get(id), (d) => drafts.set(d.id, d));
  report.lesson_ids = (b.lessons ?? []).map((l) => l.id);
  return report;
}
