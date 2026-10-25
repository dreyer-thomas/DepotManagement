// The price provider interface (AD-9): every price source fetches EUR closes per business date by
// provider symbol. Expected failures are typed results, never thrown. Reused by the adapters of 3.4.
import type { Split } from "@/core/corporate-actions";

/** One stored-ready daily close: business date `YYYY-MM-DD` (Europe/Berlin) and unadjusted EUR close (TEXT decimal). */
export type DailyClose = { date: string; close: string };

/**
 * Why a fetch failed: `network` (request failed / timed out), `not-found` (unknown symbol or no data),
 * `currency` (not quoted in EUR), `schema` (unexpected response shape), `unexpected` (anything else).
 */
export type PriceFetchFailure = "network" | "not-found" | "currency" | "schema" | "unexpected";

export const PRICE_FETCH_FAILURES: readonly PriceFetchFailure[] = ["network", "not-found", "currency", "schema", "unexpected"];

export type PriceFetch<T> = { ok: true; value: T } | { ok: false; reason: PriceFetchFailure };

/** What an adapter knows about the Security it fetches for: its recorded splits (to undo split adjustment). */
export type PriceFetchContext = { securityId: string; splits: readonly Split[] };

export interface PriceAdapter {
  /** The newest available close. */
  fetchLatest(symbol: string, ctx: PriceFetchContext): Promise<PriceFetch<DailyClose>>;
  /** Daily closes from `from` to `to` (business dates, inclusive), ascending, at most one per date. */
  fetchHistory(symbol: string, from: string, to: string, ctx: PriceFetchContext): Promise<PriceFetch<DailyClose[]>>;
}
