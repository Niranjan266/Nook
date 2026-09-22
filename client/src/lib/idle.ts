import { lazy, type ComponentType } from 'react';

/**
 * Run something once the browser has nothing better to do.
 *
 * Used to warm lazily-split chunks after first paint: the download happens
 * while the person is reading their chat list, so opening a sheet later is
 * still instant — but it never competes with the first screen for bandwidth
 * or the main thread. Safari has no requestIdleCallback, hence the fallback.
 */
export function whenIdle(fn: () => void, timeout = 2500): () => void {
  const w = window as any;
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(fn, { timeout });
    return () => w.cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 1200);
  return () => window.clearTimeout(id);
}

/** Fire-and-forget chunk warmers. A failed prefetch just means a later fetch. */
export function prefetch(...loaders: (() => Promise<unknown>)[]) {
  for (const load of loaders) load().catch(() => {});
}

const RELOADED = 'nook.chunk-reload';

/**
 * React.lazy, minus the white screen.
 *
 * A plain lazy() that fails to fetch throws into the tree, and with no error
 * boundary that blanks the whole app. The usual cause is a deploy: the page
 * still names last build's hashed chunk, which no longer exists. So retry once
 * (a flaky mobile connection), then fetch the new shell — once per session, so
 * a genuinely broken deploy cannot loop — and otherwise render nothing: a
 * sheet that will not open beats an app that will not draw.
 */
export function lazyChunk<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load()
      .catch(() => new Promise((r) => setTimeout(r, 1200)).then(load))
      .catch(() => {
        let reloaded = true;
        try {
          reloaded = Boolean(sessionStorage.getItem(RELOADED));
          if (!reloaded && navigator.onLine) sessionStorage.setItem(RELOADED, '1');
        } catch {
          /* storage blocked: never reload blind */
        }
        if (!reloaded && navigator.onLine) window.location.reload();
        return { default: (() => null) as unknown as T };
      })
  );
}
