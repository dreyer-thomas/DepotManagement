/**
 * Fee attribution for the realized-gain check against Parqet (story 2.8). Pure, decimal strings only.
 *
 * Parqet's `realizedgains` excludes fees; the ledger's FIFO gain deducts them (lot cost = amount + fee,
 * proceeds = amount − fee). FIFO cost and proceeds are linear in the fees, so the fees attributable to a
 * sale are `gain(every fee = 0) − gain(actual)`: the sell fee plus `buyFee × taken / lotQuantity` per
 * consumed lot, through splits and ISIN changes.
 */
import type { CorporateActions } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { fifo, type FifoRow } from "./fifo";

/** Key of a SELL in `saleFees`: `${date}|${sequence}`. */
export function saleKey(date: string, sequence: number): string {
  return `${date}|${sequence}`;
}

/** Fees attributable to each SELL (FIFO, as of `asOf`), keyed by `saleKey(date, sequence)`. */
export function saleFees(rows: readonly FifoRow[], asOf: string, actions: CorporateActions): Map<string, string> {
  const gains = (input: readonly FifoRow[]) => {
    const result = new Map<string, string>();
    for (const security of fifo(input, asOf, actions)) {
      for (const sale of security.sales) result.set(saleKey(sale.date, sale.sequence), sale.gain);
    }
    return result;
  };
  const actual = gains(rows);
  const feeless = gains(rows.map((row) => ({ ...row, fee: "0" })));
  const fees = new Map<string, string>();
  for (const [key, gain] of actual) {
    fees.set(key, canonicalDecimal(new ExactDecimal(feeless.get(key) ?? gain).minus(gain)));
  }
  return fees;
}

export type GainDifference = "equal" | "fees" | "deviation";

/**
 * Compares the ledger's realized gain of a sale with the file's: within `tolerance` → `equal`; a difference
 * (file − ledger) equal to the sale's attributable `fees` within `tolerance` → `fees`; else `deviation`.
 */
export function classifyGainDifference(
  ledgerGain: string,
  fileGain: string,
  fees: string,
  tolerance: string = "0.01",
): GainDifference {
  const difference = new ExactDecimal(fileGain).minus(ledgerGain);
  if (difference.abs().lessThanOrEqualTo(tolerance)) return "equal";
  if (difference.minus(fees).abs().lessThanOrEqualTo(tolerance)) return "fees";
  return "deviation";
}
