import { lazy, Suspense, useState, type ComponentType } from 'react';

export interface LazyPage {
  (): JSX.Element;
  /** Starts loading the page's code (once); resolves with the component. */
  preload: () => Promise<ComponentType>;
}

/**
 * A route page (no props) whose code loads in its own chunk, so the first screen does not parse every page. `preload()` fetches it
 * ahead of time (App calls it once the first screen has painted); a page that has loaded renders directly, so following a
 * link to it never shows an empty frame. A page mounted before its code arrived waits in a Suspense with no fallback, as
 * every other lazy route does, and keeps that path for as long as it stays mounted, so its state is never reset.
 */
export function lazyPage(load: () => Promise<ComponentType>): LazyPage {
  let loaded: ComponentType | null = null;
  let pending: Promise<ComponentType> | null = null;
  const preload = (): Promise<ComponentType> =>
    (pending ??= load().then(
      (c) => (loaded = c),
      (e: unknown) => {
        pending = null;
        throw e;
      },
    ));
  const Deferred = lazy(() => preload().then((c) => ({ default: c })));
  function Page() {
    // Read once per mount: switching from the deferred path to the direct one would remount the page.
    const [Ready] = useState(() => loaded);
    if (Ready) return <Ready />;
    return (
      <Suspense fallback={null}>
        <Deferred />
      </Suspense>
    );
  }
  return Object.assign(Page, { preload });
}

/** Runs `work` when the browser is idle (or after a short delay where idle callbacks are missing). Returns a cancel. */
export function whenIdle(work: () => void, timeoutMs = 2000): () => void {
  if (typeof window === 'undefined') return () => {};
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(work, { timeout: timeoutMs });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(work, 200);
  return () => window.clearTimeout(id);
}
