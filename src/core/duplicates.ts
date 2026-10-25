/**
 * The one duplicate definition (AD-15). Pure, decimal strings only. Advisory: callers decide what a
 * match means (manual entry warns and asks for confirmation; import/migration apply their own policy).
 */
import type { IsinChange } from "./corporate-actions";
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

/**
 * The Security `securityId` resolves to today: follow ISIN changes from it in date order, each next
 * change dated after the previous one, to the last. Unchanged Securities (and `null`) map to themselves.
 */
export function currentSecurity(securityId: string | null, isinChanges: readonly IsinChange[]): string | null {
  if (securityId === null || isinChanges.length === 0) return securityId;
  const ordered = [...isinChanges].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let current = securityId;
  let after = "";
  for (const change of ordered) {
    if (change.oldSecurityId !== current || !(change.date > after)) continue;
    current = change.newSecurityId;
    after = change.date;
  }
  return current;
}

function isMatch(candidate: DuplicateCandidate, row: DuplicateCandidate, isinChanges: readonly IsinChange[]): boolean {
  if (candidate.id !== undefined && row.id === candidate.id) return false;
  return (
    row.depotId === candidate.depotId &&
    row.date === candidate.date &&
    row.type === candidate.type &&
    currentSecurity(row.securityId ?? null, isinChanges) === currentSecurity(candidate.securityId ?? null, isinChanges) &&
    sameQuantity(row.quantity, candidate.quantity) &&
    new ExactDecimal(eventValue(row)).minus(eventValue(candidate)).abs().lessThanOrEqualTo(TOLERANCE)
  );
}

/**
 * Rows `candidate` may repeat: same Depot, date, type, Security (null = null) and quantity (as
 * decimals; null = null), event values within €0.01. A row with the candidate's `id` never matches.
 * Securities are compared as resolved through `isinChanges` (`currentSecurity`), so a row of an old
 * ISIN matches one of its successor. 0 matches → `unique`, 1 → `duplicate`, more → `ambiguous` (it
 * cannot be told which one it repeats).
 */
export function matchDuplicates<T extends DuplicateCandidate>(
  candidate: DuplicateCandidate,
  rows: readonly T[],
  isinChanges: readonly IsinChange[] = [],
): DuplicateResult<T> {
  const matches = rows.filter((row) => isMatch(candidate, row, isinChanges));
  const status: DuplicateStatus = matches.length === 0 ? "unique" : matches.length === 1 ? "duplicate" : "ambiguous";
  return { status, matches };
}
