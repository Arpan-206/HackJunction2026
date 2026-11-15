import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, AssistantOffError } from '../src/api/client';
import { ASSISTANT_PATHS, isAssistantOn, isAssistantPath, setAssistantOn } from '../src/features/shared/assistant';
import { handleMockRequest } from '../src/mock/router';
import { vals } from './helpers';

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('assistant switch', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let xhrMade: number;

  beforeEach(() => {
    const store = new Map<string, string>();
    fetchMock = vi.fn(async () => okJson({}));
    xhrMade = 0;
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
    vi.stubGlobal(
      'XMLHttpRequest',
      class {
        constructor() {
          xhrMade += 1;
          throw new Error('no XHR expected');
        }
      },
    );
  });

  afterEach(() => {
    setAssistantOn(true);
    vi.unstubAllGlobals();
  });

  it('is on by default and knows its endpoints', () => {
    expect(isAssistantOn()).toBe(true);
    expect(ASSISTANT_PATHS).toHaveLength(6);
    expect(isAssistantPath('/coach/hint')).toBe(true);
    expect(isAssistantPath('/coach/review')).toBe(true);
    expect(isAssistantPath('/score')).toBe(false);
    expect(isAssistantPath('/lessons')).toBe(false);
  });

  it('when off, no assistant call reaches the network', async () => {
    setAssistantOn(false);
    const calls: Promise<unknown>[] = [
      api.generateLesson({ prompt: 'Teach a pinch' }),
      api.generateLessonFromVideo(new File([new Uint8Array(4)], 'clip.mp4', { type: 'video/mp4' })),
      api.coachHint({ instruction: 'Pinch', deviations: vals(), timing_ms: 0 }),
      api.coachPlan({ lesson_title: 'L', steps: [], attempts: [] }),
      api.motionFromText({ text: 'a slow pinch' }),
    ];
    for (const c of calls) await expect(c).rejects.toBeInstanceOf(AssistantOffError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(xhrMade).toBe(0);
  });

  it('when off, the algorithmic scorer and the rest of the API still work', async () => {
    setAssistantOn(false);
    await api.lessons();
    await api.score({ reference_motion: { preset: 'idle' }, attempt_frames: [], tolerance: { angle_deg: 18, timing_ms: 250 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('when on, assistant calls are sent as before', async () => {
    setAssistantOn(true);
    await api.motionFromText({ text: 'a slow pinch' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/motion/from_text');
  });

  it('remembers the choice in localStorage', () => {
    setAssistantOn(false);
    expect((window as unknown as { localStorage: Storage }).localStorage.getItem('apprentice.assistant')).toBe('0');
  });

  it('mock mode refuses assistant routes while off, as a second lock', async () => {
    setAssistantOn(false);
    const res = await handleMockRequest({ method: 'POST', path: '/motion/from_text', query: new URLSearchParams(), json: { text: 'pinch' } });
    expect(res.status).toBe(403);
  });
});
