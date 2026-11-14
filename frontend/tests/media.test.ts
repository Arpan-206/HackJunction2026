import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lesson, MediaInfo, Recording, RecordingSummary } from '../src/api/types';
import { tutorialVideoOf } from '../src/api/media';
import { handleMockRequest } from '../src/mock/router';
import { mediaIdFromUrl, mediaObjectUrl } from '../src/mock/media';
import { clearMockStorage, getStore } from '../src/mock/store';

/** The mock port of the media routes (docs/CONTRACT.md "Expert media"): upload, serve, attach to a take and a step, delete. */

const call = (method: string, path: string, extra: { json?: unknown; form?: FormData } = {}) =>
  handleMockRequest({ method, path, query: new URLSearchParams(), ...extra });

function clip(type = 'video/webm', bytes = 64): FormData {
  const form = new FormData();
  form.append('video', new Blob([new Uint8Array(bytes)], { type }), 'take.webm');
  return form;
}

describe('mock router: media', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
    vi.stubGlobal('window', { localStorage: storage, sessionStorage: storage, setTimeout: (f: () => void, ms: number) => setTimeout(f, ms) });
    clearMockStorage();
  });

  it('stores a clip, serves its bytes and deletes it', async () => {
    const form = clip('video/webm;codecs=vp9', 100);
    form.append('duration_s', '3.25');
    const res = await call('POST', '/media', { form });
    expect(res.status).toBe(201);
    const info = res.body as MediaInfo;
    expect(info).toMatchObject({ url: `/api/media/${info.id}`, content_type: 'video/webm', duration_s: 3.25, size_bytes: 100 });
    expect(mediaIdFromUrl(info.url)).toBe(info.id);
    const got = await call('GET', `/media/${info.id}`);
    expect(got.status).toBe(200);
    expect(got.body).toBeInstanceOf(Blob);
    expect((got.body as Blob).size).toBe(100);
    expect((await call('DELETE', `/media/${info.id}`)).status).toBe(204);
    expect((await call('GET', `/media/${info.id}`)).status).toBe(404);
    expect((await call('DELETE', `/media/${info.id}`)).status).toBe(404);
    expect(await mediaObjectUrl(info.id)).toBeNull();
  });

  it('refuses other types and bad durations like the backend', async () => {
    expect((await call('POST', '/media', { form: clip('image/png') })).status).toBe(415);
    const form = clip();
    form.append('duration_s', '-2');
    expect((await call('POST', '/media', { form })).status).toBe(400);
    expect((await call('POST', '/media', { form: new FormData() })).status).toBe(422);
  });

  it('attaches a clip to a take and to a step tutorial', async () => {
    const info = (await call('POST', '/media', { form: clip() })).body as MediaInfo;
    const rec: Recording = { id: 'take1', lesson_id: null, step_id: null, started_at: '2026-11-14T10:00:00Z', duration_s: 1, fps: 60, hands: 'right', frames: [] };
    getStore().saveRecording(rec);
    const put = await call('PUT', '/recordings/take1/video', { json: { media_id: info.id, offset_s: 0.2 } });
    expect(put.status).toBe(200);
    const video = { media_id: info.id, url: info.url, offset_s: 0.2 };
    expect((put.body as RecordingSummary).video).toEqual(video);
    expect(((await call('GET', '/recordings/take1')).body as Recording).video).toEqual(video);
    expect((await call('PUT', '/recordings/take1/video', { json: { media_id: 'nope' } })).status).toBe(404);
    expect((await call('PUT', '/recordings/nope/video', { json: { media_id: info.id } })).status).toBe(404);
    expect(((await call('DELETE', '/recordings/take1/video')).body as RecordingSummary).video).toBeNull();

    const tutorial = { media_id: info.id, url: info.url, offset_s: 4 };
    const lesson = (await call('POST', '/lessons', { json: { title: 'Grip', skill: 'general', steps: [{ title: 'Hold', instruction: 'Hold it.', tutorial_video: tutorial }] } })).body as Lesson;
    expect(lesson.steps[0].tutorial_video).toEqual(tutorial);
    expect(tutorialVideoOf(lesson.steps[0])).toEqual(tutorial);
    const bad = await call('POST', '/lessons', { json: { title: 'Grip', skill: 'general', steps: [{ title: 'Hold', instruction: 'Hold it.', tutorial_video: { media_id: info.id, url: info.url, offset_s: 99999 } }] } });
    expect(bad.status).toBe(422);
  });

  it('reads an old video_url as a tutorial synced at 0 s', () => {
    expect(tutorialVideoOf({ video_url: '/clips/a.mp4' })).toEqual({ media_id: '', url: '/clips/a.mp4', offset_s: 0 });
    expect(tutorialVideoOf({ video_url: null, tutorial_video: null })).toBeNull();
  });
});
