import { prisma } from "@/db";
import { addDays } from "@/core/dates";
import { type PeriodSelection, resolvePeriod } from "@/core/period";
import { computePositions } from "@/core/positions";
import type { ResolvedPrice } from "@/core/prices";
import type { PeriodPerformance } from "@/core/returns";
import {
  currentSecurityId,
  securityChain,
  type SecurityLot,
  securityLots,
  securityPerformance,
  securityPrice,
  securitySeries,
  type SecuritySnapshot,
  securitySnapshot,
  sumSecurityPerformance,
} from "@/core/security";
import { type ValuationPoint, type ValuationRow, valuationSeries } from "@/core/valuation";
import { loadCorporateActions } from "./corporate-actions";
import type { LedgerDb } from "./depots";
import { lineageObservations, type StoredPriceLoader } from "./positions";
import { getSecurity, type SecuritySummary } from "./securities";
import { toRecord, TRANSACTION_INCLUDE, type TransactionRecord } from "./transactions";

export type SecurityDetailOptions = { storedPrices?: StoredPriceLoader };

/** A Depot that booked the Security chain. */
export type SecurityDetailDepot = { id: string; name: string; archived: boolean };

/** One row of the Security's Transaction history, with its Depot's name. */
export type SecurityTransactionRecord = TransactionRecord & { depotName: string };

/** The Security detail page's figures (computed on read, never stored). */
export type SecurityDetail = {
  security: SecuritySummary;
  /** Depots with ≥ 1 row of the Security chain, name order (de-DE). Empty when never booked. */
  depots: SecurityDetailDepot[];
  /** Selected Depot id; `null` = "Alle Depots" (the non-archived booking Depots). */
  selected: string | null;
  /** Common resolved Period, inclusive. */
  from: string;
  to: string;
  /** Security series point at the end of the day before `from`, and one point per day `from..to`. */
  start: ValuationPoint;
  series: ValuationPoint[];
  performance: PeriodPerformance;
  /** The holding as of `to`, summed over the scope. */
  snapshot: SecuritySnapshot;
  /** The chain's current Security as of `to` (whose price is shown). */
  priceSecurity: SecuritySummary;
  /** Resolver price of `priceSecurity` as of `to`; `null` without one. */
  price: ResolvedPrice | null;
  /** Open FIFO lots as of `to` per scope Depot that has any. */
  lots: { depotId: string; depotName: string; lots: SecurityLot[] }[];
  /** Every chain row of the scope's Depots, newest first `(date, sequence)`. */
  transactions: SecurityTransactionRecord[];
};

type ChainRow = ValuationRow & { depotId: string };

/**
 * The Security detail of `securityId` for `selection` as of `today`; `null` for an unknown id. Scope rows
 * are the Transactions of the Security chain (`core/security`: the Security plus its ISIN-change
 * relatives). `depotParam` selects a booking Depot; otherwise "Alle Depots" (non-archived booking
 * Depots, AD-17), or the first booking Depot when all are archived. Every scope Depot is evaluated over
 * one common Period (`MAX` starts on the scope's first row) and summed by core. Prices as
 * `depotValuation` (pass the full stored history for per-day carry-forward). Read-only.
 */
export async function securityDetail(
  securityId: string,
  depotParam: string | undefined,
  selection: PeriodSelection,
  today: string,
  db: LedgerDb = prisma,
  { storedPrices }: SecurityDetailOptions = {},
): Promise<SecurityDetail | null> {
  const security = await getSecurity(securityId, db);
  if (!security) return null;
  const actions = await loadCorporateActions(db);
  const chain = securityChain(securityId, actions);
  const records = await db.transaction.findMany({
    where: { securityId: { in: chain } },
    orderBy: [{ date: "desc" }, { sequence: "desc" }],
    include: TRANSACTION_INCLUDE,
  });
  const depotIds = [...new Set(records.map((record) => record.depotId))];
  const depots = (
    await db.depot.findMany({ where: { id: { in: depotIds } }, select: { id: true, name: true, archived: true } })
  ).sort((a, b) => a.name.localeCompare(b.name, "de-DE"));

  const requested = depots.find((depot) => depot.id === depotParam);
  const active = depots.filter((depot) => !depot.archived);
  let selected: string | null;
  let scope: SecurityDetailDepot[];
  if (requested) {
    selected = requested.id;
    scope = [requested];
  } else if (active.length > 0 || depots.length === 0) {
    selected = null;
    scope = active;
  } else {
    selected = depots[0].id;
    scope = [depots[0]];
  }

  const scopeIds = new Set(scope.map((depot) => depot.id));
  const rowsByDepot = new Map<string, ChainRow[]>(scope.map((depot) => [depot.id, []]));
  for (const record of records) {
    rowsByDepot.get(record.depotId)?.push({
      depotId: record.depotId,
      securityId: record.securityId,
      type: record.type,
      date: record.date,
      sequence: record.sequence,
      quantity: record.quantity,
      amount: record.amount,
      fee: record.fee,
      tax: record.tax,
    });
  }
  const scopeRows = [...rowsByDepot.values()].flat();
  const firstDate = scopeRows.reduce<string | null>((first, row) => (first === null || row.date < first ? row.date : first), null);
  const { from, to } = resolvePeriod(selection, today, firstDate);
  const observations = await lineageObservations(chain, actions, to, db, storedPrices);

  // One series from the day before `from` per Depot: its first point is the start, the rest the Period.
  const startDate = addDays(from, -1);
  const evaluate = (rows: ChainRow[]) => {
    const points = securitySeries(valuationSeries(rows, observations, actions, startDate, from > to ? startDate : to));
    const start = points[0];
    const series = points.slice(1);
    return { rows, start, series, performance: securityPerformance(rows, start, series, actions) };
  };
  const parts = scope.map((depot) => evaluate(rowsByDepot.get(depot.id)!));
  const summed =
    parts.length === 1
      ? parts[0]
      : sumSecurityPerformance(parts.length > 0 ? parts : [evaluate([])]);

  const snapshot = securitySnapshot(
    scope.flatMap((depot) => computePositions(rowsByDepot.get(depot.id)!, observations, to, actions)),
  );
  const lots = scope.flatMap((depot) => {
    const open = securityLots(rowsByDepot.get(depot.id)!, to, actions);
    return open.length > 0 ? [{ depotId: depot.id, depotName: depot.name, lots: open }] : [];
  });

  const priceSecurityId = currentSecurityId(securityId, actions, to);
  const priceSecurity = priceSecurityId === securityId ? security : ((await getSecurity(priceSecurityId, db)) ?? security);
  const names = new Map(depots.map((depot) => [depot.id, depot.name]));

  return {
    security,
    depots,
    selected,
    from,
    to,
    start: summed.start,
    series: [...summed.series],
    performance: summed.performance,
    snapshot,
    priceSecurity,
    price: securityPrice(observations, priceSecurity.id, actions, to),
    lots,
    transactions: records
      .filter((record) => scopeIds.has(record.depotId))
      .map((record) => ({ ...toRecord(record), depotName: names.get(record.depotId) ?? "" })),
  };
}
