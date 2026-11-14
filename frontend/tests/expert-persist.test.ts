import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bundle, ImportReport, Lesson, Recording } from '../src/api/types';
import { BUNDLE_FORMAT, BUNDLE_FORMAT_VERSION } from '../src/api/types';
import { bundleFilename, importSummary, parseBundle, slug } from '../src/features/master/files/bundleFiles';
import { calibrationLine, calibrationWhen } from '../src/features/shared/gloves/CalibrationInUse';
import { loadDraft, newDraft, parseDraft, resumeSummary, saveDraft, shouldAdoptServerDraft, type ScratchDraft } from '../src/features/master/scratch/scratchDraft';
import { handleMockRequest } from '../src/mock/router';
import { resetMockDrafts } from '../src/mock/persist';
import { getStore } from '../src/mock/store';
import { frameAt } from '../src/mock/synth';

/** Expert training persistence: the scratch draft resumes anywhere, and a lesson round-trips through a bundle file. */

function stubStorage(local = new Map<string, string>()): Map<string, string> {
  const store = new Map<string, string>();
  const area = (m: Map<string, string>) => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
  vi.stubGlobal('window', { sessionStorage: area(store), localStorage: area(local), setTimeout, clearTimeout });
  return store;
}

const withTakes = (d: ScratchDraft, ids: string[]): ScratchDraft => ({ ...d, takeIds: { [d.current.id]: ids } });

afterEach(() => vi.unstubAllGlobals());

describe('the scratch draft resumes', () => {
  it('says what is waiting, in plain words', () => {
    const d = newDraft();
    expect(resumeSummary(d)).toBeNull();
    expect(resumeSummary(withTakes(d, ['a', 'b']))).toBe('Carry on where you left off: 2 takes of Move 1 recorded.');
    expect(resumeSummary(withTakes(d, ['a']))).toBe('Carry on where you left off: 1 take of Move 1 recorded.');
    const named = { ...withTakes(d, ['a', 'b', 'c']), skillName: 'Pottery', moves: [{ choice: d.current, model: {} as never }] };
    expect(resumeSummary(named)).toBe('Carry on where you left off on Pottery: 1 move ready and 3 takes of Move 1 recorded.');
  });

  it('survives closing the tab: it is kept in localStorage, with a copy for this tab in sessionStorage', () => {
    const local = new Map<string, string>();
    const session = stubStorage(local);
    const d = withTakes(newDraft(), ['a', 'b']);
    session.set('apprentice.scratch.draft.v2', JSON.stringify(d));
    expect(loadDraft()).toEqual(d);
    saveDraft(d, 5);
    expect(JSON.parse(session.get('apprentice.scratch.draft.v2')!).savedAt).toBe(5);
    session.clear(); // a new tab
    expect(loadDraft()?.id).toBe(d.id);
    expect(JSON.parse(local.get('apprentice.scratch.draft.v2')!).savedAt).toBe(5);
    expect(loadDraft()?.savedAt).toBe(5);
  });

  it('takes the backend copy on a new laptop, and only a newer one otherwise', () => {
    const work = { ...withTakes(newDraft(), ['a', 'b']), savedAt: 2000 };
    const fresh = newDraft();
    expect(shouldAdoptServerDraft(fresh, work)).toBe(true);
    expect(shouldAdoptServerDraft(fresh, { ...newDraft(), savedAt: 3000 })).toBe(false);
    expect(shouldAdoptServerDraft({ ...work, savedAt: 1000 }, work)).toBe(true);
    expect(shouldAdoptServerDraft({ ...work, savedAt: 2000 }, work)).toBe(false);
    expect(shouldAdoptServerDraft({ ...fresh, savedAt: 9000 }, work)).toBe(false);
    expect(shouldAdoptServerDraft(fresh, null)).toBe(false);
    expect(parseDraft({ v: 1, id: 'x' })).toBeNull();
    expect(parseDraft(work)).toEqual(work);
  });
});

describe('mock backend: drafts and bundle files', () => {
  beforeEach(() => {
    stubStorage();
    resetMockDrafts();
  });

  const call = (method: string, path: string, json?: unknown, query = '') => handleMockRequest({ method, path, query: new URLSearchParams(query), json });

  it('stores a draft and hands back the newest', async () => {
    expect((await call('GET', '/drafts/scratch')).status).toBe(404);
    const a = withTakes(newDraft(), ['r1', 'r2']);
    const b = newDraft();
    expect((await call('PUT', `/drafts/scratch/${a.id}`, { schema_version: 2, draft: a })).status).toBe(200);
    await call('PUT', `/drafts/scratch/${b.id}`, { schema_version: 2, draft: b });
    expect(((await call('GET', '/drafts/scratch')).body as { id: string }).id).toBe(b.id);
    expect((await call('DELETE', `/drafts/scratch/${b.id}`)).status).toBe(204);
    const back = (await call('GET', '/drafts/scratch')).body as { draft: ScratchDraft };
    expect(back.draft).toEqual(a);
    expect((await call('PUT', '/drafts/scratch/bad id', { schema_version: 2, draft: a })).status).toBe(400);
  });

  it('round-trips a lesson with its takes, and reports a changed local copy instead of overwriting it', async () => {
    const store = getStore();
    const take = (n: number): Recording => {
      const frames = Array.from({ length: 30 }, (_, i) => ({ ...frameAt({ preset: 'finger_sequence', sequence: [1, 2, 3], beat_ms: 300 }, i / 30 + n * 0.01, ['right']), t: i / 30 }));
      return { id: `take${n}xxxxxxx`.slice(0, 12), lesson_id: null, step_id: `free_a:rep${n}`, started_at: new Date(2026, 10, 14, 15, n).toISOString(), duration_s: 1, fps: 30, hands: 'right', video: null, frames };
    };
    const takes = [take(1), take(2), take(3)];
    takes.forEach((t) => store.saveRecording(t));
    const created = (await call('POST', '/lessons', {
      title: 'Pottery',
      skill: 'general',
      summary: '',
      master_name: 'Szymon',
      source: 'scratch',
      steps: [{ title: 'Move 1', instruction: 'Follow.', hands: 'right', reference_recording_id: takes[0].id, take_ids: takes.map((t) => t.id), tolerance: { angle_deg: 18, timing_ms: 250 } }],
    })).body as Lesson;

    const bundle = (await call('GET', `/lessons/${created.id}/export`)).body as Bundle;
    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.recordings.map((r) => r.id)).toEqual(takes.map((t) => t.id));
    expect(bundle.takes_models).toHaveLength(1);
    expect(bundleFilename(bundle.name)).toBe('pottery.geppetto.json');
    const fromFile = parseBundle(JSON.stringify(bundle));

    const again = (await call('POST', '/lessons/import', fromFile)).body as ImportReport;
    expect(again.created).toEqual([]);
    expect(again.conflicts).toEqual([]);
    expect(again.unchanged.map((i) => i.kind).sort()).toEqual(['lesson', 'recording', 'recording', 'recording']);

    await call('PUT', `/lessons/${created.id}`, { ...created, summary: 'Changed here.' });
    const clash = (await call('POST', '/lessons/import', fromFile)).body as ImportReport;
    expect(clash.conflicts).toEqual([{ kind: 'lesson', id: created.id, note: expect.any(String) }]);
    expect(store.getLesson(created.id)?.summary).toBe('Changed here.');
    expect(importSummary(clash).join(' ')).toContain('Kept your copy of 1 lesson');

    const forced = (await call('POST', '/lessons/import', fromFile, 'overwrite=true')).body as ImportReport;
    expect(forced.overwritten.map((i) => i.id)).toEqual([created.id]);
    expect(store.getLesson(created.id)?.summary).toBe('');
    expect((await call('POST', '/lessons/import', { ...bundle, format_version: BUNDLE_FORMAT_VERSION + 1 })).status).toBe(422);
  });
});

describe('file names, reading a file and the calibration line', () => {
  it('makes file-safe names like the backend', () => {
    expect(slug('Table tennis: Topspin loop!')).toBe('table-tennis-topspin-loop');
    expect(slug('***')).toBe('lesson');
  });

  it('refuses a file that is not a Geppetto bundle, or one from a newer Geppetto', () => {
    expect(() => parseBundle('not json')).toThrow(/not a Geppetto file/);
    expect(() => parseBundle('{"format":"other"}')).toThrow(/not a Geppetto file/);
    expect(() => parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, format_version: 99 }))).toThrow(/newer Geppetto/);
    expect(parseBundle(JSON.stringify({ format: BUNDLE_FORMAT, format_version: 1 })).lessons).toEqual([]);
  });

  it('names the saved calibration in use', () => {
    const cal = (side: 'left' | 'right', created_at: string) => ({ id: side, side, flat: {} as never, fist: {} as never, created_at });
    expect(calibrationLine({ left: null, right: null, wearer: null })).toBeNull();
    const line = calibrationLine({ left: cal('left', '2026-11-14T15:20:00'), right: cal('right', '2026-11-14T15:10:00'), wearer: null });
    expect(line).toBe(`Using your calibration from ${calibrationWhen('2026-11-14T15:20:00')}, for both hands. It is saved, so it carries over after a restart.`);
    expect(calibrationWhen('2026-11-14T15:20:00')).toBe('14 Nov, 15:20');
  });
});
