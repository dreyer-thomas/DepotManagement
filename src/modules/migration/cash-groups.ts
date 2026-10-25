/**
 * Group reconciliation of one Parqet instant (story 2.7): the trades left unpaired by the 1:1 cash pairing
 * and the unused Cash rows of the same instant are reconciled together. Pure, decimal strings only.
 *
 * - `difference = Σ derived cash effects − Σ signed cash rows` (in +, out −).
 * - |difference| ≤ €0.01: the trade with the largest |effect| (ties: first given, i.e. chronologically
 *   first) is aligned so the set's derived total equals the cash rows.
 * - Otherwise one standalone TAX of `tax = difference` (negative = refund) closes the gap; its cash effect
 *   `−tax` makes derived + (−difference) = cash. The trades stay unchanged.
 */
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";

/** A leftover trade with its derived (signed) cash effect; `securityKey` is null for Security-less rows. */
export type GroupTrade<T> = { trade: T; effect: string; securityKey: string | null };

/** A Cash TransferIn (`in`) or TransferOut (`out`) row with its positive amount. */
export type GroupCash = { direction: "in" | "out"; amount: string };

export type GroupReconciliation<T> =
  /** Within tolerance: `trade` must get the cash effect `effect` (equal to its current effect when the group matches). */
  | { kind: "align"; trade: T; effect: string }
  /** Above tolerance: one TAX of signed `tax`, for `securityKey` when all trades share one Security. */
  | { kind: "tax"; tax: string; securityKey: string | null };

/** Group differences within this tolerance are aligned instead of booked as TAX. */
export const GROUP_TOLERANCE = "0.01";

/** Reconciles the leftover trades (chronological order, at least one) with the instant's unused cash rows. */
export function reconcileCashGroup<T>(
  trades: readonly GroupTrade<T>[],
  cash: readonly GroupCash[],
  tolerance: string = GROUP_TOLERANCE,
): GroupReconciliation<T> {
  if (trades.length === 0) throw new TypeError("A cash group needs at least one trade");
  const cashTotal = cash.reduce(
    (sum, row) => (row.direction === "in" ? sum.plus(row.amount) : sum.minus(row.amount)),
    new ExactDecimal(0),
  );
  const derived = trades.reduce((sum, trade) => sum.plus(trade.effect), new ExactDecimal(0));
  const difference = derived.minus(cashTotal);

  if (difference.abs().lessThanOrEqualTo(tolerance)) {
    let largest = trades[0];
    for (const trade of trades) {
      if (new ExactDecimal(trade.effect).abs().greaterThan(new ExactDecimal(largest.effect).abs())) largest = trade;
    }
    return { kind: "align", trade: largest.trade, effect: canonicalDecimal(new ExactDecimal(largest.effect).minus(difference)) };
  }

  const keys = new Set(trades.map((trade) => trade.securityKey));
  const [only] = keys;
  return { kind: "tax", tax: canonicalDecimal(difference), securityKey: keys.size === 1 && only !== null ? only : null };
}
