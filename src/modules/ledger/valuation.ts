import { prisma } from "@/db";
import { type PeriodSelection, resolvePeriod } from "@/core/period";
import { addDays } from "@/core/dates";
import { type PeriodPerformance, periodPerformance } from "@/core/returns";
import { periodFlows, type ValuationPoint, valuationSeries } from "@/core/valuation";
import { loadCorporateActions } from "./corporate-actions";
import type { LedgerDb } from "./depots";
import { lineageObservations, type StoredPriceLoader } from "./positions";

export type DepotValuationOptions = { storedPrices?: StoredPriceLoader };

/** A Depot's Period evaluation (computed on read, never stored). */
export type DepotValuation = {
  /** Resolved Period, inclusive. */
  from: string;
  to: string;
  /** Valuation at the end of the day before `from` (zero before the Depot's first row). */
  start: ValuationPoint;
  /** One point per calendar day `from..to` (`core/valuation`). */
  series: ValuationPoint[];
  /** Gross dividends of rows dated in the Period. */
  dividends: string;
  /** Net taxes (paid minus refunds) of rows dated in the Period. */
  taxesPaid: string;
  /** Period Gain/Loss, its split, TTWROR and XIRR (`core/returns`), from the same series. */
  performance: PeriodPerformance;
};

/**
 * The daily valuation series, Period flows and Period performance of a Depot for `selection` as of `today` (`MAX` starts on
 * the Depot's first ledger date). Prices come from the core resolver over the BUY/SELL prices of the
 * Depot's Securities and their ISIN-change successors in any Depot and, when `storedPrices` is given,
 * the stored manual and provider Prices it loads (pass the full history for per-day carry-forward).
 * Read-only.
 */
export async function depotValuation(
  depotId: string,
  selection: PeriodSelection,
  today: string,
  db: LedgerDb = prisma,
  { storedPrices }: DepotValuationOptions = {},
): Promise<DepotValuation> {
  const rows = await db.transaction.findMany({
    where: { depotId },
    select: { securityId: true, type: true, date: true, sequence: true, quantity: true, amount: true, fee: true, tax: true },
  });
  const firstDate = rows.reduce<string | null>((first, row) => (first === null || row.date < first ? row.date : first), null);
  const { from, to } = resolvePeriod(selection, today, firstDate);
  const own = new Set(rows.flatMap((row) => (row.securityId ? [row.securityId] : [])));
  const actions = await loadCorporateActions(db);
  const observations = own.size === 0 ? [] : await lineageObservations(own, actions, to, db, storedPrices);
  // One series from the day before `from`: its first point is the start, the rest the Period.
  const startDate = addDays(from, -1);
  const points = valuationSeries(rows, observations, actions, startDate, from > to ? startDate : to);
  const start = points[0];
  const series = points.slice(1);
  return {
    from,
    to,
    start,
    series,
    ...periodFlows(rows, from, to),
    performance: periodPerformance(rows, start, series, actions),
  };
}
