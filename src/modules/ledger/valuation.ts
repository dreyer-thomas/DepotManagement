import { prisma } from "@/db";
import { type PeriodSelection, resolvePeriod } from "@/core/period";
import { addDays } from "@/core/dates";
import { type PeriodPerformance, periodPerformance, portfolioPerformance } from "@/core/returns";
import { periodFlows, type ValuationPoint, type ValuationRow, valuationSeries } from "@/core/valuation";
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

type DepotRow = ValuationRow & { securityId: string | null };

/** The Depot's ledger rows as the valuation needs them. */
function loadRows(depotId: string, db: LedgerDb): Promise<DepotRow[]> {
  return db.transaction.findMany({
    where: { depotId },
    select: { securityId: true, type: true, date: true, sequence: true, quantity: true, amount: true, fee: true, tax: true },
  });
}

function firstDateOf(rows: readonly { date: string }[]): string | null {
  return rows.reduce<string | null>((first, row) => (first === null || row.date < first ? row.date : first), null);
}

/** The Depot's valuation over `from..to` (inclusive) from its `rows`, plus those rows. */
async function valuationOver(
  rows: DepotRow[],
  from: string,
  to: string,
  db: LedgerDb,
  storedPrices: StoredPriceLoader | undefined,
): Promise<{ valuation: DepotValuation; rows: DepotRow[] }> {
  const own = new Set(rows.flatMap((row) => (row.securityId ? [row.securityId] : [])));
  const actions = await loadCorporateActions(db);
  const observations = own.size === 0 ? [] : await lineageObservations(own, actions, to, db, storedPrices);
  // One series from the day before `from`: its first point is the start, the rest the Period.
  const startDate = addDays(from, -1);
  const points = valuationSeries(rows, observations, actions, startDate, from > to ? startDate : to);
  const start = points[0];
  const series = points.slice(1);
  return {
    rows,
    valuation: {
      from,
      to,
      start,
      series,
      ...periodFlows(rows, from, to),
      performance: periodPerformance(rows, start, series, actions),
    },
  };
}

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
  const rows = await loadRows(depotId, db);
  const { from, to } = resolvePeriod(selection, today, firstDateOf(rows));
  return (await valuationOver(rows, from, to, db, storedPrices)).valuation;
}

/** The Portfolio's Period evaluation: the sum of its non-archived Depots over one common Period. */
export type PortfolioValuation = {
  /** Common resolved Period, inclusive (`MAX` starts on the earliest ledger date of the Depots). */
  from: string;
  to: string;
  start: ValuationPoint;
  /** Summed daily series of the Depots. */
  series: ValuationPoint[];
  dividends: string;
  taxesPaid: string;
  /** Summed Gain/Loss and split; TTWROR and XIRR over the summed series and all external flows. */
  performance: PeriodPerformance;
  /** True when any of the Depots has a ledger row. */
  hasTransactions: boolean;
  /** Each non-archived Depot (name order) evaluated over exactly `from..to`. */
  depots: { id: string; name: string; valuation: DepotValuation }[];
};

/**
 * The Portfolio (non-archived Depots, AD-17) for `selection` as of `today`: every Depot is evaluated
 * over the same Period (`resolvePeriod` with the earliest ledger date of all of them) and the results
 * are summed by `core/returns` (FIFO stays per Depot). Same price inputs as `depotValuation`. Read-only.
 */
export async function portfolioValuation(
  selection: PeriodSelection,
  today: string,
  db: LedgerDb = prisma,
  { storedPrices }: DepotValuationOptions = {},
): Promise<PortfolioValuation> {
  const depots = (await db.depot.findMany({ where: { archived: false }, select: { id: true, name: true } })).sort((a, b) =>
    a.name.localeCompare(b.name, "de-DE"),
  );
  const rowsByDepot = await Promise.all(depots.map((depot) => loadRows(depot.id, db)));
  const firstDate = firstDateOf(rowsByDepot.flat());
  const { from, to } = resolvePeriod(selection, today, firstDate);
  const evaluated = await Promise.all(rowsByDepot.map((rows) => valuationOver(rows, from, to, db, storedPrices)));
  // Without any Depot the Portfolio is one empty (zero) part over the Period.
  const parts = evaluated.length > 0 ? evaluated : [await valuationOver([], from, to, db, storedPrices)];
  const portfolio = portfolioPerformance(
    parts.map(({ rows, valuation }) => ({ rows, start: valuation.start, series: valuation.series, performance: valuation.performance })),
  );
  return {
    from,
    to,
    start: portfolio.start,
    series: portfolio.series,
    dividends: portfolio.performance.dividends,
    taxesPaid: portfolio.performance.taxesPaid,
    performance: portfolio.performance,
    hasTransactions: firstDate !== null,
    depots: depots.map((depot, index) => ({ id: depot.id, name: depot.name, valuation: evaluated[index].valuation })),
  };
}
