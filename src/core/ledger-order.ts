/**
 * The one ledger ordering (AD-6): by business date, then intra-day sequence. Pure.
 */
export type LedgerOrdered = { date: string; sequence: number };

/** Comparator for `Array.prototype.sort`: `(date, sequence)` ascending. */
export function compareLedgerOrder(a: LedgerOrdered, b: LedgerOrdered): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.sequence - b.sequence;
}
