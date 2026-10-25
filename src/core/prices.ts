/**
 * The single price resolver (AD-9). In Epic 1 the only source is the price of BUY/SELL Transactions
 * of every Depot; later epics add manual and provider Prices behind the same function. Pure.
 */
import { compareLedgerOrder } from "./ledger-order";

/** A price seen on a ledger row (any Depot). `price` is a decimal string. */
export type PriceObservation = { id: string; securityId: string; date: string; sequence: number; price: string };

export type ResolvedPrice = { price: string; date: string };

function compareObservations(a: PriceObservation, b: PriceObservation): number {
  return compareLedgerOrder(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Price of `securityId` on `date`: the last observation dated on or before `date`, ordered by
 * `(date, sequence, id)`; `null` when there is none.
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
