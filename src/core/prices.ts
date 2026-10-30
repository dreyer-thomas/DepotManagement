/**
 * The single price resolver (AD-9). Sources: manual Prices, provider Prices and the price of BUY/SELL
 * Transactions of every Depot (derived on read, never stored). Pure.
 */
import { addDays } from "./dates";
import { compareLedgerOrder } from "./ledger-order";

/** Where an observed price comes from; on the same date provider wins over manual over Transaction. */
export type PriceSource = "manual" | "provider" | "transaction";

/**
 * A price seen on a date: a Transaction row (any Depot, `sequence` = its ledger sequence) or a stored
 * Price (`sequence` 0). `price` is a decimal string.
 */
export type PriceObservation = {
  id: string;
  securityId: string;
  date: string;
  sequence: number;
  price: string;
  source: PriceSource;
  /** UTC ISO instant a stored Price was fetched or entered; absent for Transaction prices. */
  fetchedAt?: string | null;
  /** Provider of a stored provider Price (e.g. `YAHOO`, from the Security's mapping); absent otherwise. */
  provider?: string | null;
};

/** The resolved price with where it came from (for date, stale badge and tooltip). */
export type ResolvedPrice = {
  price: string;
  date: string;
  source: PriceSource;
  fetchedAt: string | null;
  provider: string | null;
};

// A manual Price fills a gap until the provider delivers that date; then the provider Price makes it redundant.
const SOURCE_RANK: Record<PriceSource, number> = { transaction: 0, manual: 1, provider: 2 };

/** Resolver order: `(date, source transaction < manual < provider, sequence, id)`; the last on or before a date wins. */
export function compareObservations(a: PriceObservation, b: PriceObservation): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (
    SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
    compareLedgerOrder(a, b) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Price of `securityId` on `date`: the last observation dated on or before `date`, ordered by
 * `(date, source transaction < manual < provider, sequence, id)` — on a date a provider Price wins, else a
 * manual Price, else the last Transaction; without one on `date` the latest earlier one is carried
 * forward by the same precedence. `null` when there is none.
 */
export function resolvePrice(
  observations: readonly PriceObservation[],
  securityId: string,
  date: string,
): ResolvedPrice | null {
  let latest: PriceObservation | null = null;
  for (const observation of observations) {
    if (observation.securityId !== securityId || observation.date > date) continue;
    if (!latest || compareObservations(observation, latest) > 0) latest = observation;
  }
  return latest
    ? {
        price: latest.price,
        date: latest.date,
        source: latest.source,
        fetchedAt: latest.fetchedAt ?? null,
        provider: latest.provider ?? null,
      }
    : null;
}

/** A Price is stale when "today" is more than this many calendar days after its date. */
export const STALE_AFTER_DAYS = 3;

/**
 * The only staleness rule (AD-9): true when `today` is more than `STALE_AFTER_DAYS` calendar days after
 * `latestPriceDate` (`2026-10-22` is stale on `2026-10-26`, `2026-10-23` is not). Both are business dates.
 */
export function isStale(latestPriceDate: string, today: string): boolean {
  return addDays(latestPriceDate, STALE_AFTER_DAYS) < today;
}
