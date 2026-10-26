import { prisma } from "@/db";
import { type CorporateActions, LOT_TYPES } from "@/core/corporate-actions";
import { saleFees, saleKey } from "@/core/fee-attribution";
import { fifo } from "@/core/fifo";
import { computePositions, type Position } from "@/core/positions";
import type { PriceObservation } from "@/core/prices";
import { loadCorporateActions } from "./corporate-actions";
import type { LedgerDb } from "./depots";
import type { SecuritySummary } from "./securities";

/** An open Position (computed on read, never stored) with its Security. */
export type PositionRecord = Omit<Position, "securityId"> & { security: SecuritySummary };

const SECURITY_SELECT = { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true } as const;

/**
 * Loads stored Prices (manual / provider) of `securityIds` dated on or before `asOf` as observations.
 * Injected by callers (e.g. `prices.latestStoredPrices`); the ledger never imports `prices`.
 */
export type StoredPriceLoader = (securityIds: string[], asOf: string) => Promise<PriceObservation[]>;

export type ListPositionsOptions = { storedPrices?: StoredPriceLoader };

/**
 * The Securities of `own` plus those an ISIN change carried their lots into, transitively: the
 * Securities whose prices can value the Depot's Positions.
 */
export function securityLineage(own: Iterable<string>, actions: CorporateActions): string[] {
  const lineage = new Set(own);
  for (let grew = true; grew; ) {
    grew = false;
    for (const change of actions.isinChanges) {
      if (lineage.has(change.oldSecurityId) && !lineage.has(change.newSecurityId)) {
        lineage.add(change.newSecurityId);
        grew = true;
      }
    }
  }
  return [...lineage];
}

/**
 * Price observations for the lineage of `own` dated on or before `asOf`: the BUY/SELL prices of any
 * Depot and, when `storedPrices` is given, the stored manual / provider Prices it loads.
 */
export async function lineageObservations(
  own: Iterable<string>,
  actions: CorporateActions,
  asOf: string,
  db: LedgerDb,
  storedPrices?: StoredPriceLoader,
): Promise<PriceObservation[]> {
  const securityIds = securityLineage(own, actions);
  const priced = await db.transaction.findMany({
    where: { securityId: { in: securityIds }, type: { in: ["BUY", "SELL"] }, date: { lte: asOf }, price: { not: null } },
    select: { id: true, securityId: true, date: true, sequence: true, price: true },
  });
  const observations: PriceObservation[] = priced.map((row) => ({
    id: row.id,
    securityId: row.securityId as string,
    date: row.date,
    sequence: row.sequence,
    price: row.price as string,
    source: "transaction",
  }));
  if (storedPrices) {
    const ids = new Set(securityIds);
    for (const observation of await storedPrices(securityIds, asOf)) {
      if (ids.has(observation.securityId) && observation.date <= asOf) observations.push(observation);
    }
  }
  return observations;
}

/**
 * Open Positions of a Depot as of `today` (`YYYY-MM-DD`). Prices come from the core resolver over the
 * BUY/SELL prices of each Security in any Depot dated on or before `today` and, when `storedPrices` is
 * given, the stored manual and provider Prices it loads (manual > provider > Transaction, carried
 * forward). Quantities and prices follow the recorded corporate actions as of `today` (splits; ISIN
 * changes move lots and prices to the new Security). Read-only.
 */
export async function listPositions(
  depotId: string,
  today: string,
  db: LedgerDb = prisma,
  { storedPrices }: ListPositionsOptions = {},
): Promise<PositionRecord[]> {
  const rows = await db.transaction.findMany({
    where: { depotId },
    select: { securityId: true, type: true, date: true, sequence: true, quantity: true, price: true, amount: true, fee: true },
  });
  const own = new Set(rows.flatMap((row) => (row.securityId ? [row.securityId] : [])));
  if (own.size === 0) return [];
  const actions = await loadCorporateActions(db);
  const observations = await lineageObservations(own, actions, today, db, storedPrices);
  const positions = computePositions(rows, observations, today, actions);
  if (positions.length === 0) return [];
  const securities = await db.security.findMany({
    where: { id: { in: positions.map((position) => position.securityId) } },
    select: SECURITY_SELECT,
  });
  const byId = new Map(securities.map((security) => [security.id, security]));
  return positions.map(({ securityId, ...position }) => ({ ...position, security: byId.get(securityId)! }));
}

/**
 * Per Security of `securityIds`, the latest BUY/SELL price observation (any Depot) dated on or before
 * `asOf`, ordered by `(date, sequence, id)`; Securities without one are absent. As traded (no corporate
 * action adjustment): callers use it for the price date and source, not as a value. Read-only.
 */
export async function latestTradePrices(
  securityIds: readonly string[],
  asOf: string,
  db: LedgerDb = prisma,
): Promise<PriceObservation[]> {
  if (securityIds.length === 0) return [];
  const rows = await db.transaction.findMany({
    where: { securityId: { in: [...securityIds] }, type: { in: ["BUY", "SELL"] }, date: { lte: asOf }, price: { not: null } },
    select: { id: true, securityId: true, date: true, sequence: true, price: true },
  });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const current = latest.get(row.securityId as string);
    const later =
      !current ||
      row.date > current.date ||
      (row.date === current.date && (row.sequence > current.sequence || (row.sequence === current.sequence && row.id > current.id)));
    if (later) latest.set(row.securityId as string, row);
  }
  return [...latest.values()].map((row) => ({
    id: row.id,
    securityId: row.securityId as string,
    date: row.date,
    sequence: row.sequence,
    price: row.price as string,
    source: "transaction" as const,
  }));
}

/**
 * One realized SELL of a Depot (computed on read): its ledger position, FIFO gain (gross, tax excluded) and
 * the fees that gain deducts (sell fee plus the consumed share of buy fees, `core/fee-attribution`).
 */
export type RealizedSaleRecord = { securityId: string; date: string; sequence: number; gain: string; fees: string };

/**
 * The Depot's SELLs dated on or before `asOf` with their FIFO realized gain and attributable fees
 * (`core/fifo`, replayed with every recorded corporate action as of `asOf`), ordered by `(date, sequence)`.
 * Read-only.
 */
export async function listRealizedSales(depotId: string, asOf: string, db: LedgerDb = prisma): Promise<RealizedSaleRecord[]> {
  const rows = await db.transaction.findMany({
    where: { depotId, type: { in: [...LOT_TYPES] } },
    select: { securityId: true, type: true, date: true, sequence: true, quantity: true, price: true, amount: true, fee: true },
  });
  if (rows.length === 0) return [];
  const actions = await loadCorporateActions(db);
  const fees = saleFees(rows, asOf, actions);
  return fifo(rows, asOf, actions)
    .flatMap(({ securityId, sales }) =>
      sales.map((sale) => ({
        securityId,
        date: sale.date,
        sequence: sale.sequence,
        gain: sale.gain,
        fees: fees.get(saleKey(sale.date, sale.sequence)) ?? "0",
      })),
    )
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.sequence - b.sequence));
}
