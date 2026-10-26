/**
 * Rounding oversells of migrated rows (story 2.7). Parqet rounds fractional sell quantities, so a SELL can
 * exceed the holding by a few ten-thousandths. Pure, decimal strings only; works on the given rows alone.
 *
 * A SELL exceeding the net held quantity by more than 0 and at most `tolerance` (with held > 0 and held
 * representable in ≤ 8 decimals) sells exactly the held quantity. The shortfall is carried per Security —
 * a later split scales it × new/old, an ISIN change moves it × n/o to the new Security (dropped when it then
 * needs more than 8 decimals) — and the next BUY of that Security whose quantity is greater than the carry
 * buys `quantity − carry` (the carry clears); a BUY not greater than the carry stays unchanged. Larger
 * oversells are left untouched.
 */
import { ALL_ACTIONS, type CorporateActions, LotBook, type ReplayRow, replayEvents } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";

type Decimal = InstanceType<typeof ExactDecimal>;

/** The ledger's quantity precision. */
const MAX_DECIMALS = 8;
const SCALE = new ExactDecimal(10).pow(MAX_DECIMALS);

export const ROUNDING_TOLERANCE = "0.001";

function representable(value: Decimal): boolean {
  return value.times(SCALE).isInteger();
}

/**
 * Replays `rows` with every corporate action and returns the new quantity of each clamped SELL and each
 * BUY that absorbs a carried shortfall (rows not in the map keep their quantity).
 */
export function clampRoundingOversells<T extends ReplayRow>(
  rows: readonly T[],
  actions: CorporateActions,
  tolerance: string = ROUNDING_TOLERANCE,
): Map<T, string> {
  const result = new Map<T, string>();
  const book = new LotBook();
  const carry = new Map<string, Decimal>();
  const keep = (securityId: string, value: Decimal) => {
    if (value.isZero() || !representable(value)) carry.delete(securityId);
    else carry.set(securityId, value);
  };

  for (const event of replayEvents(rows, actions, ALL_ACTIONS)) {
    if (event.kind === "split") {
      book.apply(event);
      const { securityId, ratioNew, ratioOld } = event.split;
      const carried = carry.get(securityId);
      if (carried) keep(securityId, carried.times(ratioNew).dividedBy(ratioOld));
      continue;
    }
    if (event.kind === "isin-change") {
      book.apply(event);
      const { oldSecurityId, newSecurityId, oldQuantity, newQuantity } = event.change;
      const carried = carry.get(oldSecurityId);
      if (carried && oldSecurityId !== newSecurityId) {
        carry.delete(oldSecurityId);
        const moved = carried.times(newQuantity).dividedBy(oldQuantity);
        if (representable(moved)) keep(newSecurityId, moved.plus(carry.get(newSecurityId) ?? 0));
      }
      continue;
    }

    const { row } = event;
    if (row.type === "ADJUSTMENT") {
      // A holding correction is never clamped and never takes a carried shortfall.
      book.applyQuantity(row);
      continue;
    }
    const securityId = row.securityId as string;
    const quantity = new ExactDecimal(row.quantity ?? "0");
    if (row.type === "BUY") {
      const carried = carry.get(securityId);
      let bought = quantity;
      if (carried && quantity.greaterThan(carried)) {
        bought = quantity.minus(carried);
        result.set(row, canonicalDecimal(bought));
        carry.delete(securityId);
      }
      book.buy(securityId, row.date, row.sequence, canonicalDecimal(bought), new ExactDecimal(0));
      continue;
    }

    const { scaled, divisor } = book.net(securityId);
    const held = scaled.dividedBy(divisor);
    const excess = quantity.minus(held);
    if (held.greaterThan(0) && excess.greaterThan(0) && excess.lessThanOrEqualTo(tolerance) && representable(held)) {
      result.set(row, canonicalDecimal(held));
      keep(securityId, excess.plus(carry.get(securityId) ?? 0));
      book.sell(securityId, canonicalDecimal(held));
    } else {
      book.sell(securityId, canonicalDecimal(quantity));
    }
  }
  return result;
}
