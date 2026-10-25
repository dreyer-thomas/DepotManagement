/**
 * The single price resolver (AD-9). Sources: manual Prices, provider Prices and the price of BUY/SELL
 * Transactions of every Depot (derived on read, never stored). Pure.
 */
import { compareLedgerOrder } from "./ledger-order";

/** Where an observed price comes from; on the same date manual wins over provider over Transaction. */
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
};

export type ResolvedPrice = { price: string; date: string };

const SOURCE_RANK: Record<PriceSource, number> = { transaction: 0, provider: 1, manual: 2 };

function compareObservations(a: PriceObservation, b: PriceObservation): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (
    SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
    compareLedgerOrder(a, b) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * Price of `securityId` on `date`: the last observation dated on or before `date`, ordered by
 * `(date, source transaction < provider < manual, sequence, id)` — on a date a manual Price wins, else a
 * provider Price, else the last Transaction; without one on `date` the latest earlier one is carried
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
  return latest ? { price: latest.price, date: latest.date } : null;
}
