/**
 * Watchlists (story 9.1): the per-entry figures (resolved Price, stale flag, change today, change since
 * the date added), the entry sort and the price-history start of watched Securities. Pure: "today" is
 * passed in; prices are decimal strings, ratios `ratioString`s (0.04 = 4 %).
 */
import { benchmarkStartDate } from "./benchmarks";
import type { CorporateActions } from "./corporate-actions";
import { addDays, isBusinessDate } from "./dates";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { isStale, type PriceObservation, type PriceSource, resolvePrice } from "./prices";
import { ratioString, ReturnDecimal } from "./returns";
import { adjustedObservations, currentSecurityId } from "./security";

// The Security a watched one maps to today (itself unless an ISIN change moved it); the held flag uses it too.
export { currentSecurityId } from "./security";

/** Longest watchlist name (trimmed, NFC). */
export const WATCHLIST_NAME_MAX_LENGTH = 60;

/** Longest entry note (plain text; empty allowed). */
export const WATCHLIST_NOTE_MAX_LENGTH = 2000;

/** Change of the latest Price against the Price resolved on the day before its date. */
export type ChangeToday = {
  /** € per unit (latest − previous), decimal string. */
  perUnit: string;
  /** latest ÷ previous − 1. */
  ratio: string;
};

/** Figures of one watchlist entry, computed on read (never stored). */
export type EntryFigures = {
  /** Resolved Price as of today (units as of today); `null` without any Price. */
  price: string | null;
  priceDate: string | null;
  priceSource: PriceSource | null;
  priceFetchedAt: string | null;
  priceProvider: string | null;
  /** `isStale(priceDate, today)`; false without a Price. */
  stale: boolean;
  /** Last trading-day change; `null` without a previous Price (or a previous Price of zero). */
  changeToday: ChangeToday | null;
  /** Price today ÷ Price on the date added − 1 (split-adjusted); `null` when either is missing or zero. */
  sinceAdded: string | null;
};

/** `a ÷ b − 1` as a ratio string; `null` when `b` is zero. */
function changeRatio(a: string, b: string): string | null {
  const base = new ReturnDecimal(b);
  if (base.isZero()) return null;
  return ratioString(new ReturnDecimal(a).dividedBy(base).minus(1));
}

/**
 * The figures of an entry for `securityId` added on `dateAdded`, as of `today`. Every observation is
 * carried to the Securities and units as of `today` (`adjustedPrice`), so a split after the date added
 * is neutral and an ISIN change follows the Security to its successor. Prices resolve with the single
 * resolver (manual > provider > Transaction, carry-forward).
 */
export function entryFigures(
  observations: readonly PriceObservation[],
  securityId: string,
  actions: CorporateActions,
  dateAdded: string,
  today: string,
): EntryFigures {
  const adjusted = adjustedObservations(observations, actions, today);
  const target = currentSecurityId(securityId, actions, today);
  const latest = resolvePrice(adjusted, target, today);
  if (latest === null) {
    return {
      price: null,
      priceDate: null,
      priceSource: null,
      priceFetchedAt: null,
      priceProvider: null,
      stale: false,
      changeToday: null,
      sinceAdded: null,
    };
  }
  const previous = resolvePrice(adjusted, target, addDays(latest.date, -1));
  const todayRatio = previous === null ? null : changeRatio(latest.price, previous.price);
  const base = resolvePrice(adjusted, target, dateAdded);
  return {
    price: latest.price,
    priceDate: latest.date,
    priceSource: latest.source,
    priceFetchedAt: latest.fetchedAt,
    priceProvider: latest.provider,
    stale: isStale(latest.date, today),
    changeToday:
      previous === null || todayRatio === null
        ? null
        : { perUnit: canonicalDecimal(new ExactDecimal(latest.price).minus(previous.price)), ratio: todayRatio },
    sinceAdded: base === null || new ExactDecimal(latest.price).isZero() ? null : changeRatio(latest.price, base.price),
  };
}

export const WATCHLIST_SORT_KEYS = ["name", "changeToday", "sinceAdded", "dateAdded"] as const;
export type WatchlistSortKey = (typeof WATCHLIST_SORT_KEYS)[number];
export type WatchlistSortDirection = "asc" | "desc";
export type WatchlistSort = { key: WatchlistSortKey; direction: WatchlistSortDirection };

/** Default order: newest date added first. */
export const DEFAULT_WATCHLIST_SORT: WatchlistSort = { key: "dateAdded", direction: "desc" };

/** What the sort needs of an entry row. */
export type SortableWatchlistEntry = {
  id: string;
  dateAdded: string;
  changeToday: { ratio: string } | null;
  sinceAdded: string | null;
  security: { name: string };
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Name (de collation), then id: the direction-independent tie-break. */
function byName(a: SortableWatchlistEntry, b: SortableWatchlistEntry): number {
  return a.security.name.localeCompare(b.security.name, "de") || compareText(a.id, b.id);
}

function sortValue(row: SortableWatchlistEntry, key: Exclude<WatchlistSortKey, "name" | "dateAdded">): string | null {
  return key === "changeToday" ? (row.changeToday?.ratio ?? null) : row.sinceAdded;
}

/**
 * Entries sorted by `key` in `direction`: ratios compare exactly as decimals and `null` ("–") is last in
 * both directions; dates compare as business dates; ties fall back to the name, then the id. Returns a
 * new array.
 */
export function sortWatchlistEntries<T extends SortableWatchlistEntry>(
  rows: readonly T[],
  key: WatchlistSortKey = DEFAULT_WATCHLIST_SORT.key,
  direction: WatchlistSortDirection = DEFAULT_WATCHLIST_SORT.direction,
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (key === "name") return sign * a.security.name.localeCompare(b.security.name, "de") || compareText(a.id, b.id);
    if (key === "dateAdded") return sign * compareText(a.dateAdded, b.dateAdded) || byName(a, b);
    const left = sortValue(a, key);
    const right = sortValue(b, key);
    if (left === null || right === null) {
      if (left === right) return byName(a, b);
      return left === null ? 1 : -1;
    }
    return sign * new ExactDecimal(left).comparedTo(right) || byName(a, b);
  });
}

/**
 * First date of the price history of watched Securities: the earlier of the `3J` preset start and the
 * earliest date added, minus the benchmark base buffer (`benchmarkStartDate`).
 */
export function watchlistHistoryStart(earliestAdded: string, today: string): string {
  return benchmarkStartDate(earliestAdded, today);
}

/** True when `value` is a valid business date on or before `today`. */
export function isValidDateAdded(value: unknown, today: string): value is string {
  return isBusinessDate(value) && value <= today;
}

/** The first non-blank line of a note, trimmed; `""` for an empty note. */
export function firstNoteLine(note: string): string {
  return note.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== "") ?? "";
}
