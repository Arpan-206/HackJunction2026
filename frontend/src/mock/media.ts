import type { MediaInfo } from '../api/types';

/**
 * Mock mode's video store (POST /api/media). Blobs live in memory and in IndexedDB, so an uploaded clip survives a reload;
 * when IndexedDB is unavailable (private window, tests) they live for the session only. A <video> element cannot be
 * routed through the patched fetch, so the player asks for an object URL here (see api/media.ts, useMediaSrc).
 */

interface Entry {
  info: MediaInfo;
  blob: Blob;
}

const DB_NAME = 'apprentice.mock.media';
const STORE = 'media';
const memory = new Map<string, Entry>();
const objectUrls = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  const d = await db();
  if (!d) return undefined;
  return new Promise((resolve) => {
    try {
      const req = run(d.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** The media id in an /api/media/{id} url, or null for any other url. */
export function mediaIdFromUrl(url: string): string | null {
  const m = /^\/api\/media\/([A-Za-z0-9_-]{1,64})$/.exec(url);
  return m ? m[1] : null;
}

export async function putMedia(info: MediaInfo, blob: Blob): Promise<void> {
  memory.set(info.id, { info, blob });
  await tx('readwrite', (s) => s.put({ info, blob }, info.id));
}

export async function getMedia(id: string): Promise<Entry | undefined> {
  const hit = memory.get(id);
  if (hit) return hit;
  const stored = await tx<Entry | undefined>('readonly', (s) => s.get(id) as IDBRequest<Entry | undefined>);
  if (stored?.blob && stored.info) memory.set(id, stored);
  return stored?.blob ? stored : undefined;
}

export async function deleteMedia(id: string): Promise<boolean> {
  const known = Boolean(await getMedia(id));
  memory.delete(id);
  const url = objectUrls.get(id);
  if (url) URL.revokeObjectURL(url);
  objectUrls.delete(id);
  await tx('readwrite', (s) => s.delete(id));
  return known;
}

/** A playable object URL for a stored clip, made once per session; null when the clip is unknown. */
export async function mediaObjectUrl(id: string): Promise<string | null> {
  const made = objectUrls.get(id);
  if (made) return made;
  const entry = await getMedia(id);
  if (!entry) return null;
  const url = URL.createObjectURL(entry.blob);
  objectUrls.set(id, url);
  return url;
}
