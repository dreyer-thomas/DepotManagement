import { prisma } from "@/db";
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
 * Open Positions of a Depot as of `today` (`YYYY-MM-DD`). Prices come from the latest BUY/SELL of
 * each Security in any Depot dated on or before `today`. Quantities and prices follow the recorded
 * corporate actions as of `today` (splits; ISIN changes move lots and prices to the new Security). Read-only.
 */
export async function listPositions(depotId: string, today: string, db: LedgerDb = prisma): Promise<PositionRecord[]> {
  const rows = await db.transaction.findMany({
    where: { depotId },
    select: { securityId: true, type: true, date: true, sequence: true, quantity: true, amount: true, fee: true },
  });
  const own = new Set(rows.flatMap((row) => (row.securityId ? [row.securityId] : [])));
  if (own.size === 0) return [];
  const actions = await loadCorporateActions(db);
  // Prices of the Securities an ISIN change carried the Depot's lots into, transitively.
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
  const securityIds = [...lineage];

  const priced = await db.transaction.findMany({
    where: { securityId: { in: securityIds }, type: { in: ["BUY", "SELL"] }, date: { lte: today }, price: { not: null } },
    select: { id: true, securityId: true, date: true, sequence: true, price: true },
  });
  const observations: PriceObservation[] = priced.map((row) => ({
    id: row.id,
    securityId: row.securityId as string,
    date: row.date,
    sequence: row.sequence,
    price: row.price as string,
  }));

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
    where: { depotId, type: { in: ["BUY", "SELL"] } },
    select: { securityId: true, type: true, date: true, sequence: true, quantity: true, amount: true, fee: true },
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
