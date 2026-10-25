/**
 * Open Positions of one Depot as of a date, valued with the price resolver. Pure, decimal strings only;
 * nothing here is stored (AD-1).
 */
import { adjustedPrice, type CorporateActions } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { fifo, type FifoRow } from "./fifo";
import { type PriceObservation, resolvePrice } from "./prices";

export type Position = {
  securityId: string;
  quantity: string;
  /** Sum of the open lots' cost (gross, fees included). */
  costBasis: string;
  averagePrice: string;
  price: string | null;
  priceDate: string | null;
  value: string | null;
  gain: string | null;
  /** `gain / costBasis`; `null` without a price or when the Cost Basis is zero. */
  gainRatio: string | null;
};

/**
 * Positions with quantity > 0 from `rows` (one Depot's ledger) as of `today`; price-dependent fields
 * are `null` when the resolver finds no price on or before `today`. Quantities follow the corporate
 * actions dated on or before `today` (splits; ISIN changes move lots to the new Security); each observed
 * price is carried to the Security and units it maps to as of `today`. Cost Basis is unaffected.
 */
export function computePositions(
  rows: readonly FifoRow[],
  observations: readonly PriceObservation[],
  today: string,
  actions: CorporateActions,
): Position[] {
  const adjustedObservations =
    actions.splits.length === 0 && actions.isinChanges.length === 0
      ? observations
      : observations.map((observation) => ({
          ...observation,
          ...adjustedPrice(observation.securityId, observation.date, observation.price, actions, today),
        }));
  const positions: Position[] = [];
  for (const { securityId, lots } of fifo(rows, today, actions)) {
    let quantity = new ExactDecimal(0);
    let costBasis = new ExactDecimal(0);
    for (const lot of lots) {
      quantity = quantity.plus(lot.quantity);
      costBasis = costBasis.plus(lot.costBasis);
    }
    if (!quantity.greaterThan(0)) continue;

    const resolved = resolvePrice(adjustedObservations, securityId, today);
    let value: string | null = null;
    let gain: string | null = null;
    let gainRatio: string | null = null;
    if (resolved) {
      const worth = quantity.times(resolved.price);
      const difference = worth.minus(costBasis);
      value = canonicalDecimal(worth);
      gain = canonicalDecimal(difference);
      gainRatio = costBasis.isZero() ? null : canonicalDecimal(difference.dividedBy(costBasis));
    }
    positions.push({
      securityId,
      quantity: canonicalDecimal(quantity),
      costBasis: canonicalDecimal(costBasis),
      averagePrice: canonicalDecimal(costBasis.dividedBy(quantity)),
      price: resolved?.price ?? null,
      priceDate: resolved?.date ?? null,
      value,
      gain,
      gainRatio,
    });
  }
  return positions;
}
