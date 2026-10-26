/**
 * Archive guard and the held set (AD-17). Pure, decimal strings only; "today" is passed in.
 */
import { cashBalance, type CashRow } from "./cash";
import { type CorporateActions, LotBook, replayEvents } from "./corporate-actions";
import { ExactDecimal } from "./decimal";

type Decimal = InstanceType<typeof ExactDecimal>;

/** A BUY/SELL/ADJUSTMENT-relevant ledger row: its Security and quantity (other types carry none). */
export type QuantityRow = {
  securityId: string | null;
  type: string;
  date: string;
  quantity: string | null;
};

/** A Depot's ledger row as the archive guard needs it. */
export type ArchiveRow = CashRow & QuantityRow;

/**
 * Net held quantity (open lots − oversold units) per Security as of `asOf`, replayed with the corporate
 * actions dated on or before `asOf`, as an exact scaled value (a positive multiple of the quantity:
 * only sign and zero are used). Securities moved away by an ISIN change are zero.
 */
function netQuantities(rows: readonly QuantityRow[], asOf: string, actions: CorporateActions): Map<string, Decimal> {
  const book = new LotBook();
  // Within a date the order of BUY/SELL rows does not change a net quantity; input order stands in.
  const sequenced = rows.map((row, index) => ({ ...row, sequence: index }));
  for (const event of replayEvents(sequenced, actions, asOf)) {
    if (event.kind !== "trade") {
      book.apply(event);
      continue;
    }
    book.applyQuantity(event.row);
  }
  return new Map(book.securityIds().map((securityId) => [securityId, book.net(securityId).scaled]));
}

/** Cash counts as zero below half a cent: it rounds (ROUND_HALF_UP, 2 places) to 0,00 €. */
const HALF_CENT = new ExactDecimal("0.005");

/**
 * True when, as of `asOf`, every Security's net quantity is exactly zero and the cash balance rounds
 * to zero at cent precision (|cash| < 0.005). Cash is judged at cent precision because BUY/SELL
 * amounts are stored unrounded (quantity × price), so a closed fractional-share Depot can keep a
 * sub-cent remainder that displays as "0,00 €"; quantities stay exact.
 */
export function isFlat(rows: readonly ArchiveRow[], asOf: string, actions: CorporateActions): boolean {
  for (const quantity of netQuantities(rows, asOf, actions).values()) {
    if (!quantity.isZero()) return false;
  }
  return new ExactDecimal(cashBalance(rows, asOf)).abs().lessThan(HALF_CENT);
}

/**
 * A Depot may be archived when it is flat today and after its last row (a future-dated row that
 * opens a Position or moves cash blocks archiving). No rows → true.
 */
export function canArchive(rows: readonly ArchiveRow[], today: string, actions: CorporateActions): boolean {
  if (rows.length === 0) return true;
  const lastDate = rows.reduce((latest, row) => (row.date > latest ? row.date : latest), rows[0].date);
  return isFlat(rows, today, actions) && isFlat(rows, lastDate, actions);
}

export type HeldSecuritiesLedger = {
  depots: readonly { id: string; archived: boolean }[];
  trades: readonly (QuantityRow & { depotId: string })[];
};

/**
 * The only definition of "held": sorted unique Security ids whose net BUY − SELL quantity as of
 * `today` is > 0 within one non-archived Depot (per Depot, never summed across Depots). Rows of
 * unknown Depots are ignored.
 */
export function heldSecurities(ledger: HeldSecuritiesLedger, today: string, actions: CorporateActions): string[] {
  const active = new Set(ledger.depots.filter((depot) => !depot.archived).map((depot) => depot.id));
  const byDepot = new Map<string, QuantityRow[]>();
  for (const row of ledger.trades) {
    if (!active.has(row.depotId)) continue;
    const list = byDepot.get(row.depotId);
    if (list) list.push(row);
    else byDepot.set(row.depotId, [row]);
  }
  const held = new Set<string>();
  for (const rows of byDepot.values()) {
    for (const [securityId, quantity] of netQuantities(rows, today, actions)) {
      if (quantity.greaterThan(0)) held.add(securityId);
    }
  }
  return [...held].sort();
}
