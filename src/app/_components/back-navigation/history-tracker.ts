import {
  annotatePush,
  annotateReplace,
  type BackParent,
  type BackTarget,
  navId,
  type NavStore,
  parseStore,
  recordEntry,
  resolveBack,
} from "./back-target";

/**
 * Client-only history tracking for the back link (story 8.6). Wraps `history.pushState` and
 * `replaceState` once per document so every entry carries an id in `history.state.__dmNav` and is
 * recorded (predecessor, URL, label) in this tab's sessionStorage. Coexists with Next.js' own patch in
 * either order: Next.js internals (`__NA`, `__PRIVATE_NEXTJS_INTERNALS_TREE`) are passed through
 * untouched. Storage failures are swallowed; the back link then shows its fallback parent.
 */

export const STORAGE_KEY = "dm.backNav";

const INSTALLED_FLAG = "__dmNavInstalled";

type Listener = () => void;
const listeners = new Set<Listener>();

function readStore(): NavStore {
  try {
    return parseStore(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return parseStore(null);
  }
}

function writeStore(store: NavStore): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage full or blocked: the back link falls back to the parent.
  }
}

function newId(): string {
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function currentLocation(): { path: string; pathname: string } {
  return { path: `${window.location.pathname}${window.location.search}`, pathname: window.location.pathname };
}

/** Notifies subscribers outside the caller's stack (Next.js writes history inside `useInsertionEffect`). */
function notify(): void {
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
}

function record(id: string, prev: string | null | undefined, label?: string): void {
  writeStore(recordEntry(readStore(), id, { prev, ...currentLocation(), ...(label === undefined ? {} : { label }) }));
  notify();
}

/** Installs the history wrappers once per document; never uninstalled. */
export function installHistoryTracking(): void {
  if (typeof window === "undefined") return;
  const flagged = window as unknown as Record<string, unknown>;
  if (flagged[INSTALLED_FLAG]) return;
  flagged[INSTALLED_FLAG] = true;
  const history = window.history;
  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  history.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    const prev = navId(history.state);
    const id = newId();
    originalPush.call(history, annotatePush(data, id), unused, url);
    record(id, prev);
  };

  history.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    const annotated = annotateReplace(data, navId(history.state));
    originalReplace.call(history, annotated, unused, url);
    const id = navId(annotated);
    if (id !== null) record(id, undefined);
  };

  window.addEventListener("popstate", notify);
}

/** The current entry's id; gives an untracked entry (first load, new tab) an id without predecessor. */
export function ensureCurrentEntry(): string | null {
  if (typeof window === "undefined") return null;
  installHistoryTracking();
  const id = navId(window.history.state);
  if (id !== null) {
    if (!readStore().entries[id]) record(id, null);
    return id;
  }
  const fresh = newId();
  try {
    // Goes through the wrappers (ours records the entry; Next.js keeps its internals in the spread state).
    window.history.replaceState(annotatePush(window.history.state, fresh), "");
  } catch {
    return null;
  }
  return navId(window.history.state);
}

/** Registers the label under which the current page appears as a back-link origin. */
export function registerPageLabel(label: string): void {
  const id = ensureCurrentEntry();
  if (id === null) return;
  record(id, undefined, label);
}

/** Subscribes to store changes (push, replace, traversal, label); returns the unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The back target of the page currently shown. */
export function currentBackTarget(fallback: BackParent): BackTarget {
  return resolveBack(readStore(), navId(window.history.state), window.location.pathname, fallback);
}
