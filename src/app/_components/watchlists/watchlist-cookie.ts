/**
 * The last opened watchlist, remembered per browser like the chart choices: written client-side when a
 * list is shown (no server action, never reloads) and read by the server page for a visit without
 * `?list=`. Not httpOnly: the cookie holds only a UI choice (a list id).
 */
import { chartPreferenceCookie } from "../charts/chart-preference";

export const WATCHLIST_COOKIE = "dm_watchlist";

/**
 * The list to open: the requested one (`?list=`) when it exists, else the remembered one when it exists,
 * else the first list; `null` without lists.
 */
export function selectWatchlistId(
  lists: readonly { id: string }[],
  requested: string | undefined | null,
  remembered: string | undefined | null,
): string | null {
  const exists = (id: string | undefined | null): id is string => Boolean(id) && lists.some((list) => list.id === id);
  if (exists(requested)) return requested;
  if (exists(remembered)) return remembered;
  return lists[0]?.id ?? null;
}

/** Remembers `watchlistId` as the last opened list (client components only). */
export function storeLastWatchlist(watchlistId: string): void {
  if (typeof document === "undefined") return;
  document.cookie = chartPreferenceCookie(WATCHLIST_COOKIE, watchlistId, window.location.protocol === "https:");
}

/** URL of a watchlist on the Watchlists page. */
export function watchlistHref(watchlistId: string): string {
  return `/watchlists?list=${encodeURIComponent(watchlistId)}`;
}

/** The optional key-figure columns (story 9.6; "Analysten" story 9.7), remembered per browser; hidden by default. */
export const WATCHLIST_COLUMNS_COOKIE = "dm_watchlist_columns";
export const WATCHLIST_COLUMN_KEYS = ["kgv", "dividendYield", "distanceToHigh", "analysts"] as const;
export type WatchlistColumnKey = (typeof WATCHLIST_COLUMN_KEYS)[number];

/** The stored column choice (comma list): unknown keys dropped, duplicates removed, in column order. */
export function parseWatchlistColumns(value: string | undefined | null): WatchlistColumnKey[] {
  let text = value ?? "";
  try {
    // The client writes the value URI-encoded ("%2C"); tolerate both forms.
    text = decodeURIComponent(text);
  } catch {
    // Malformed escapes: keep the raw text (its keys are dropped as unknown).
  }
  const chosen = new Set(text.split(",").map((key) => key.trim()));
  return WATCHLIST_COLUMN_KEYS.filter((key) => chosen.has(key));
}

/** Remembers the shown optional columns (client components only; never reloads the page). */
export function storeWatchlistColumns(columns: readonly WatchlistColumnKey[]): void {
  if (typeof document === "undefined") return;
  document.cookie = chartPreferenceCookie(WATCHLIST_COLUMNS_COOKIE, columns.join(","), window.location.protocol === "https:");
}
