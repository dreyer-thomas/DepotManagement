/**
 * The one duplicate definition (AD-15). Pure, decimal strings only. Advisory: callers decide what a
 * match means (manual entry warns and asks for confirmation; import/migration apply their own policy).
 */
import { ExactDecimal } from "./decimal";

/** The fields a duplicate is matched on; `id` is set for an existing row (or the row being edited). */
export type DuplicateCandidate = {
  id?: string;
  depotId: string;
  date: string;
  type: string;
  securityId: string | null;
  quantity: string | null;
  amount: string;
  fee: string;
  tax: string;
};

export type DuplicateStatus = "unique" | "duplicate" | "ambiguous";

export type DuplicateResult<T> = { status: DuplicateStatus; matches: T[] };

/** Two event values differing by at most this are the same booking. */
const TOLERANCE = "0.01";

/** The value a row books: `fee` for a standalone FEE, `tax` for a TAX, else the gross `amount`. */
function eventValue(row: DuplicateCandidate): string {
  if (row.type === "FEE") return row.fee;
  if (row.type === "TAX") return row.tax;
  return row.amount;
}

function sameQuantity(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new ExactDecimal(a).equals(b);
}

function isMatch(candidate: DuplicateCandidate, row: DuplicateCandidate): boolean {
  if (candidate.id !== undefined && row.id === candidate.id) return false;
  return (
    row.depotId === candidate.depotId &&
    row.date === candidate.date &&
    row.type === candidate.type &&
    (row.securityId ?? null) === (candidate.securityId ?? null) &&
    sameQuantity(row.quantity, candidate.quantity) &&
    new ExactDecimal(eventValue(row)).minus(eventValue(candidate)).abs().lessThanOrEqualTo(TOLERANCE)
  );
}

/**
 * Rows `candidate` may repeat: same Depot, date, type, Security (null = null) and quantity (as
 * decimals; null = null), event values within €0.01. A row with the candidate's `id` never matches.
 * 0 matches → `unique`, 1 → `duplicate`, more → `ambiguous` (it cannot be told which one it repeats).
 */
export function matchDuplicates<T extends DuplicateCandidate>(
  candidate: DuplicateCandidate,
  rows: readonly T[],
): DuplicateResult<T> {
  const matches = rows.filter((row) => isMatch(candidate, row));
  const status: DuplicateStatus = matches.length === 0 ? "unique" : matches.length === 1 ? "duplicate" : "ambiguous";
  return { status, matches };
}
