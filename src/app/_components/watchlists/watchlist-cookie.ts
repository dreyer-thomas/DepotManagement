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
