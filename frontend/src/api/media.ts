import { useEffect, useState } from 'react';
import type { MediaRef, Step } from './types';

/**
 * The step's tutorial video: `tutorial_video` when set, else the older `video_url` read as a tutorial synced at 0 s, else
 * null. Every screen that shows a tutorial goes through here, so lessons saved before media existed keep working.
 */
export function tutorialVideoOf(step: Pick<Step, 'tutorial_video' | 'video_url'>): MediaRef | null {
  if (step.tutorial_video) return step.tutorial_video;
  if (step.video_url) return { media_id: '', url: step.video_url, offset_s: 0 };
  return null;
}

/**
 * A playable src for a stored video. With the real backend this is the url itself (/api/media/{id}, range requests and all).
 * In mock mode a <video> element cannot go through the patched fetch, so the clip comes from the mock store as an object
 * URL. Null while it resolves, or when the clip is gone (the screen then shows its still).
 */
export function useMediaSrc(url: string | null | undefined): string | null {
  const mock = typeof window !== 'undefined' && window.__apprenticeMock === true;
  const direct = url && !(mock && url.startsWith('/api/media/')) ? url : null;
  const [resolved, setResolved] = useState<{ url: string; src: string | null } | null>(null);

  useEffect(() => {
    if (!url || direct) return;
    let alive = true;
    void import('../mock/media').then(async (m) => {
      const id = m.mediaIdFromUrl(url);
      const src = id ? await m.mediaObjectUrl(id) : null;
      if (alive) setResolved({ url, src });
    });
    return () => {
      alive = false;
    };
  }, [url, direct]);

  if (direct) return direct;
  return resolved && resolved.url === url ? resolved.src : null;
}
