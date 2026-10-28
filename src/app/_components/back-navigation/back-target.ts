import { bottomItems, drawerItems, isActive } from "../navigation";

/**
 * Pure back-link resolution (story 8.6). Every history entry of a browser tab gets an id (kept in
 * `history.state.__dmNav`); the per-tab store maps each id to its predecessor, URL and page label.
 * The back target is the nearest predecessor with a different pathname, else the page's logical parent.
 */

/** Key of the entry id inside `history.state`. */
export const NAV_STATE_KEY = "__dmNav";

/** Oldest entries are dropped beyond this count so sessionStorage stays small. */
export const MAX_ENTRIES = 200;

export interface NavEntry {
  /** Id of the history entry this one was pushed on top of; null for the first known entry. */
  prev: string | null;
  /** Pathname plus search, the exact URL to return to. */
  path: string;
  pathname: string;
  /** Label registered by the page (Depot name, Security name, watchlist name, sub-page title). */
  label: string | null;
}

export interface NavStore {
  entries: Record<string, NavEntry>;
}

export interface BackParent {
  href: string;
  label: string;
}

export type BackTarget =
  | { kind: "history"; steps: number; href: string; label: string }
  | { kind: "link"; href: string; label: string };

export function emptyStore(): NavStore {
  return { entries: {} };
}

/** Generic label when a pathname matches no navigation entry. */
const UNKNOWN_PAGE_LABEL = "Zurück";

/** The navigation label of `pathname`: exact top-level entry, else the longest matching prefix. */
export function defaultPageLabel(pathname: string): string {
  const items = [...drawerItems, ...bottomItems];
  let best: { href: string; label: string } | null = null;
  for (const item of items) {
    if (isActive(item.href, pathname) && (best === null || item.href.length > best.href.length)) best = item;
  }
  return best?.label ?? UNKNOWN_PAGE_LABEL;
}

/**
 * Records (or updates) entry `id`. A new entry takes `prev` (default null) and inherits the label of
 * `prev` when the pathname is the same (an in-page change); an existing entry keeps its `prev` unless
 * given and keeps its label while the pathname is unchanged. An explicit `label` always wins.
 */
export function recordEntry(
  store: NavStore,
  id: string,
  input: { prev?: string | null; path: string; pathname: string; label?: string | null },
): NavStore {
  const existing = store.entries[id];
  let entry: NavEntry;
  if (existing) {
    entry = {
      prev: input.prev === undefined ? existing.prev : input.prev,
      path: input.path,
      pathname: input.pathname,
      label: input.label !== undefined ? input.label : existing.pathname === input.pathname ? existing.label : null,
    };
  } else {
    const prev = input.prev ?? null;
    const prevEntry = prev === null ? undefined : store.entries[prev];
    entry = {
      prev,
      path: input.path,
      pathname: input.pathname,
      label: input.label !== undefined ? input.label : prevEntry && prevEntry.pathname === input.pathname ? prevEntry.label : null,
    };
  }
  // Re-insert so insertion order is recency order: eviction keeps the most recently recorded entries.
  const entries: Record<string, NavEntry> = { ...store.entries };
  delete entries[id];
  entries[id] = entry;
  const ids = Object.keys(entries);
  let excess = ids.length - MAX_ENTRIES;
  for (const oldest of ids) {
    if (excess <= 0) break;
    if (oldest === id) continue;
    delete entries[oldest];
    excess -= 1;
  }
  return { entries };
}

/** The entry id stored in a `history.state` value, if any. */
export function navId(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const nav = (state as Record<string, unknown>)[NAV_STATE_KEY];
  if (typeof nav !== "object" || nav === null) return null;
  const id = (nav as Record<string, unknown>).id;
  return typeof id === "string" && id !== "" ? id : null;
}

function stateObject(data: unknown): Record<string, unknown> {
  return typeof data === "object" && data !== null ? { ...(data as Record<string, unknown>) } : {};
}

/** State data for a push: always a new entry id; every other field (Next.js internals) is kept. */
export function annotatePush(data: unknown, id: string): Record<string, unknown> {
  return { ...stateObject(data), [NAV_STATE_KEY]: { id } };
}

/** State data for a replace: keeps an id the data already carries, else the current entry's id. */
export function annotateReplace(data: unknown, currentId: string | null): unknown {
  if (navId(data) !== null || currentId === null) return data;
  return { ...stateObject(data), [NAV_STATE_KEY]: { id: currentId } };
}

/**
 * The back target of the current entry: walks `prev` from `currentId`, skipping entries with the
 * current pathname (in-page changes); `steps` counts the hops. A missing, broken or cyclic chain
 * falls back to the logical parent link.
 */
export function resolveBack(store: NavStore, currentId: string | null, currentPathname: string, fallback: BackParent): BackTarget {
  const link: BackTarget = { kind: "link", href: fallback.href, label: fallback.label };
  if (currentId === null) return link;
  const current = store.entries[currentId];
  if (!current) return link;
  const visited = new Set<string>([currentId]);
  let id = current.prev;
  let steps = 0;
  while (id !== null) {
    if (visited.has(id)) return link;
    visited.add(id);
    const entry = store.entries[id];
    if (!entry) return link;
    steps += 1;
    if (entry.pathname !== currentPathname) {
      return { kind: "history", steps, href: entry.path, label: entry.label ?? defaultPageLabel(entry.pathname) };
    }
    id = entry.prev;
  }
  return link;
}

/** Parses a stored store, dropping anything malformed. */
export function parseStore(raw: string | null): NavStore {
  if (!raw) return emptyStore();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyStore();
  }
  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (typeof entries !== "object" || entries === null) return emptyStore();
  const result: Record<string, NavEntry> = {};
  for (const [id, value] of Object.entries(entries as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null) continue;
    const { prev, path, pathname, label } = value as Record<string, unknown>;
    if (typeof path !== "string" || typeof pathname !== "string") continue;
    if (prev !== null && typeof prev !== "string") continue;
    result[id] = { prev, path, pathname, label: typeof label === "string" ? label : null };
  }
  return { entries: result };
}
