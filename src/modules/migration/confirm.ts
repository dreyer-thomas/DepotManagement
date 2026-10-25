/**
 * Parqet migration confirmation (story 2.4): stateless — re-reads the uploaded file, re-runs the
 * analysis against the current ledger, applies the user's decisions and books everything through
 * `ledger.recordBatch` in one DB transaction (AD-3, AD-15, AD-16). Then reconciles the Depot's ledger at
 * export date with the file: Positions, invested capital, cash and per-sale realized Gain/Loss.
 */
import { prisma } from "@/db";
import { cashBalance } from "@/core/cash";
import { isBusinessDate } from "@/core/dates";
import { canonicalDecimal, ExactDecimal, isDecimalString } from "@/core/decimal";
import { parseDecimalInput } from "@/core/decimal-input";
import { classifyGainDifference, saleKey } from "@/core/fee-attribution";
import {
  type BatchEntry,
  type BatchFailure,
  type BatchSecurity,
  getDepot,
  type LedgerDb,
  listPositions,
  listRealizedSales,
  listTransactions,
  recordBatch,
  recordTransaction,
  type RecordTransactionInput,
  type RecordTransactionResult,
  type SecurityIdentifierInput,
  type TransactionRecord,
} from "@/modules/ledger";
import {
  type Correction,
  correctionFields,
  type CorrectionType,
  itemKey,
  type MigrationDecisions,
  type OpenDecision,
  openDecisions,
  SECURITY_CORRECTION_TYPES,
} from "./decisions";
import type { FlagReason, ProposalType } from "./parqet-reader";
import { analyzeParqetExport, type ParqetPreview, type PreviewFailure } from "./preview";

/** Money differences above this are an "Abweichung". */
const MONEY_TOLERANCE = new ExactDecimal("0.01");

/** The item a booking failure belongs to. */
export type BookingItem =
  | { kind: "depot" }
  | { kind: "security"; key: string }
  | { kind: "proposal"; key: string; records: readonly number[]; date: string; type: ProposalType }
  | { kind: "flag"; key: string; records: readonly number[]; date: string; type: CorrectionType }
  | { kind: "isin-change"; key: string; records: readonly number[]; date: string; oldKey: string; newKey: string }
  | { kind: "split"; key: string; records: readonly number[]; date: string; securityKey: string; ratio: string };

/** Unparseable correction figures fail like the ledger's validation of that field. */
export type CorrectionFieldFailure = {
  ok: false;
  reason: "quantity-invalid" | "price-invalid" | "amount-invalid" | "fee-invalid" | "tax-invalid";
};

export type BookingFailure = BatchFailure | CorrectionFieldFailure;

/**
 * Ledger vs file. `explained` (story 2.8): the difference is fully explained — `fees` (a sale's gain differs
 * by exactly its attributable fees; Parqet's `realizedgains` excludes them) or `missing-deposits` (the cash
 * balance differs by exactly the funding DEPOSITs Parqet lacks); an explained figure is never a mismatch.
 */
export type Figure = { ledger: string; file: string; mismatch: boolean; explained?: "fees" | "missing-deposits" };

export type PositionComparison = {
  key: string;
  name: string;
  quantity: Figure;
  costBasis: Figure;
  mismatch: boolean;
};

export type SaleComparison = {
  /** `itemKey` of the SELL proposal. */
  key: string;
  securityKey: string;
  name: string;
  date: string;
  gain: Figure;
};

/** A flagged row (or group) that was not booked. */
export type SkippedFlag = { key: string; records: number[]; reason: FlagReason; detail?: string };

export type MigrationSummary = {
  depot: { id: string; name: string };
  exportDate: string | null;
  booked: { transactions: number; splits: number; isinChanges: number; securities: number };
  /** `splits` / `isinChanges`: already recorded, not booked again. */
  skipped: { duplicates: number; flags: number; splits: number; isinChanges: number };
  /** Every flag that was skipped, in preview order. */
  skippedFlags: SkippedFlag[];
  /** Ledger vs file at export date; `null` without an export date. */
  comparison: {
    positions: PositionComparison[];
    investedCapital: Figure;
    /** `null` when the file has no Cash rows (not reconcilable). */
    cash: Figure | null;
    sales: SaleComparison[];
  } | null;
  /** Funding DEPOSITs added to keep cash ≥ 0 (count 0, total "0" without any). */
  funding: { count: number; total: string };
  /**
   * Offered when the file has no Cash rows or funding was added: book the difference to the broker's balance
   * at `asOf`.
   */
  openingBalance: { date: string; asOf: string; ledgerBalance: string } | null;
};

export type ConfirmResult =
  | { ok: true; summary: MigrationSummary }
  | { ok: false; reason: "decisions-open"; preview: ParqetPreview; open: OpenDecision[] }
  | { ok: false; reason: "booking-failed"; item: BookingItem; failure: BookingFailure }
  | PreviewFailure;

const securityRef = (key: string) => `security:${key}`;

function identifierOf(key: string, crypto: boolean): SecurityIdentifierInput {
  return crypto ? { cryptoSymbol: key } : { isin: key };
}

function figure(ledger: string, file: string, quantity = false): Figure {
  const difference = new ExactDecimal(ledger).minus(file).abs();
  return {
    ledger: canonicalDecimal(ledger),
    file: canonicalDecimal(file),
    mismatch: quantity ? !difference.isZero() : difference.greaterThan(MONEY_TOLERANCE),
  };
}

function correctionInput(
  correction: Correction,
): { ok: true; input: Omit<RecordTransactionInput, "depotId" | "security"> } | CorrectionFieldFailure {
  const input: Omit<RecordTransactionInput, "depotId" | "security"> = {
    type: correction.type,
    date: correction.date.trim(),
    allowDuplicate: true,
  };
  for (const field of correctionFields(correction.type)) {
    const parsed = parseDecimalInput(correction[field]);
    if (!parsed.ok) return { ok: false, reason: `${field}-invalid` };
    if (parsed.value !== "") input[field] = parsed.value;
  }
  return { ok: true, input };
}

type Planned = { date: string; group: number; order: number; entry: BatchEntry; item: BookingItem };

/**
 * Books Parqet export `text` into Depot `depotId` with `decisions`. Re-reads the file and re-checks
 * duplicates against the current ledger: an undecided duplicate gives `decisions-open` with a fresh
 * preview. A new Security gets its classification override, else the estimated type; a flag without a
 * decision is skipped. Booking order: by date; on one date splits, then ISIN changes, then file
 * proposals in reader sequence, then corrected flagged rows. Duplicates decided "skip" and splits / ISIN
 * changes already recorded are not booked; everything booked uses `allowDuplicate` (the user decided).
 * Atomic: a failure names its item and writes nothing.
 */
export async function confirmParqetMigration(
  depotId: string,
  text: string,
  decisions: MigrationDecisions,
  db: LedgerDb = prisma,
): Promise<ConfirmResult> {
  const analyzed = await analyzeParqetExport(depotId, text, db);
  if (!analyzed.ok) return analyzed;
  const { read, preview, stored } = analyzed.analysis;
  const open = openDecisions(preview, decisions);
  if (open.length > 0) return { ok: false, reason: "decisions-open", preview, open };

  const fileSecurities = new Map(read.securities.map((security) => [security.key, security]));
  const securities = new Map<string, BatchSecurity>();
  const refFor = (key: string): string => {
    const ref = securityRef(key);
    if (securities.has(ref)) return ref;
    const existing = stored.get(key);
    const file = fileSecurities.get(key);
    if (existing) {
      securities.set(ref, {
        ref,
        identifier: identifierOf(key, existing.cryptoSymbol !== null),
        details: { name: existing.name, assetType: existing.assetType },
      });
    } else if (file) {
      securities.set(ref, {
        ref,
        identifier: identifierOf(key, file.cryptoSymbol !== null),
        details: {
          name: file.name,
          assetType:
            file.proposedAssetType === "CRYPTO" ? "CRYPTO" : (decisions.classifications[key] ?? file.proposedAssetType),
        },
      });
    }
    return ref;
  };

  const planned: Planned[] = [];
  const duplicateByKey = new Map(preview.duplicates.map((duplicate) => [duplicate.key, duplicate]));
  /** The ledger row of each SELL proposal: booked (by ref) or a single-match skipped duplicate. */
  const knownSellRows = new Map<string, TransactionRecord | string>();
  let skippedDuplicates = 0;
  const skippedFlags: SkippedFlag[] = [];
  let recordedChanges = 0;
  let recordedSplits = 0;

  preview.splits.forEach((split, index) => {
    if (split.recorded) {
      recordedSplits += 1;
      return;
    }
    const key = itemKey(split);
    const ratio = `${split.ratioOld}:${split.ratioNew}`;
    planned.push({
      date: split.date,
      group: 0,
      order: index,
      entry: { kind: "split", ref: `split:${key}`, securityRef: refFor(split.key), date: split.date, ratio },
      item: { kind: "split", key, records: split.records, date: split.date, securityKey: split.key, ratio },
    });
  });

  preview.isinChanges.forEach((change, index) => {
    if (change.recorded) {
      recordedChanges += 1;
      return;
    }
    const key = itemKey(change);
    const ref = `isin-change:${key}`;
    planned.push({
      date: change.date,
      group: 1,
      order: index,
      entry: {
        kind: "isin-change",
        ref,
        oldSecurityRef: refFor(change.oldKey),
        newSecurityRef: refFor(change.newKey),
        date: change.date,
        oldQuantity: change.oldQuantity,
        newQuantity: change.newQuantity,
      },
      item: { kind: "isin-change", key, records: change.records, date: change.date, oldKey: change.oldKey, newKey: change.newKey },
    });
  });

  for (const proposal of read.proposals) {
    const key = itemKey(proposal);
    const duplicate = duplicateByKey.get(key);
    if (duplicate && decisions.duplicates[key] === "skip") {
      skippedDuplicates += 1;
      if (proposal.type === "SELL" && duplicate.status === "duplicate") knownSellRows.set(key, duplicate.matches[0]);
      continue;
    }
    const ref = `proposal:${key}`;
    if (proposal.type === "SELL") knownSellRows.set(key, ref);
    planned.push({
      date: proposal.date,
      group: 2,
      order: proposal.sequence,
      entry: {
        kind: "transaction",
        ref,
        securityRef: proposal.securityKey === null ? null : refFor(proposal.securityKey),
        input: {
          type: proposal.type,
          date: proposal.date,
          quantity: proposal.quantity ?? undefined,
          price: proposal.price ?? undefined,
          amount: proposal.amount,
          fee: proposal.fee,
          tax: proposal.tax,
          allowDuplicate: true,
        },
      },
      item: { kind: "proposal", key, records: proposal.records, date: proposal.date, type: proposal.type },
    });
  }

  for (const flag of preview.flagged) {
    const key = itemKey(flag);
    const decision = decisions.flags[key];
    if (!decision || decision.action === "skip") {
      skippedFlags.push({
        key,
        records: flag.records,
        reason: flag.reason,
        ...(flag.detail !== undefined ? { detail: flag.detail } : {}),
      });
      continue;
    }
    const { correction } = decision;
    const item: BookingItem = { kind: "flag", key, records: flag.records, date: correction.date.trim(), type: correction.type };
    const parsed = correctionInput(correction);
    if (!parsed.ok) return { ok: false, reason: "booking-failed", item, failure: parsed };
    let ref: string | null = null;
    const securityKey = correction.securityKey.trim().toUpperCase();
    if (SECURITY_CORRECTION_TYPES.includes(correction.type) && securityKey !== "") {
      if (stored.has(securityKey) || fileSecurities.has(securityKey)) {
        ref = refFor(securityKey);
      } else {
        ref = `flag-security:${key}`;
        securities.set(ref, {
          ref,
          identifier: identifierOf(securityKey, correction.assetType === "CRYPTO"),
          details: { name: correction.securityName, assetType: correction.assetType },
        });
      }
    }
    planned.push({
      date: item.date,
      group: 3,
      order: flag.records[0],
      entry: { kind: "transaction", ref: `flag:${key}`, securityRef: ref, input: parsed.input },
      item,
    });
  }

  planned.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.group - b.group || a.order - b.order));
  const items = new Map<string, BookingItem>(planned.map((plan) => [plan.entry.ref, plan.item]));
  // A correction's new Security fails as that flag.
  for (const flag of preview.flagged) {
    const item = items.get(`flag:${itemKey(flag)}`);
    if (item) items.set(`flag-security:${itemKey(flag)}`, item);
  }

  const result = await recordBatch(
    { depotId: preview.depot.id, securities: [...securities.values()], entries: planned.map((plan) => plan.entry) },
    db,
  );
  if (!result.ok) {
    let item: BookingItem | undefined = items.get(result.ref);
    if (!item && result.ref.startsWith("security:")) item = { kind: "security", key: result.ref.slice("security:".length) };
    return { ok: false, reason: "booking-failed", item: item ?? { kind: "depot" }, failure: result.failure };
  }

  const createdSecurities = new Set(
    Object.values(result.securities)
      .filter((security) => !stored.has(security.isin ?? security.cryptoSymbol ?? ""))
      .map((security) => security.id),
  );

  const summary: MigrationSummary = {
    depot: preview.depot,
    exportDate: read.exportDate,
    booked: {
      transactions: Object.keys(result.transactions).length,
      splits: Object.keys(result.splits).length,
      isinChanges: Object.keys(result.isinChanges).length,
      securities: createdSecurities.size,
    },
    skipped: {
      duplicates: skippedDuplicates,
      flags: skippedFlags.length,
      splits: recordedSplits,
      isinChanges: recordedChanges,
    },
    skippedFlags,
    comparison: null,
    funding: { count: 0, total: "0" },
    openingBalance: null,
  };
  const funding = read.proposals.filter((proposal) => proposal.funding);
  const fundingTotal = funding.reduce((sum, proposal) => sum.plus(proposal.amount), new ExactDecimal(0));
  summary.funding = { count: funding.length, total: canonicalDecimal(fundingTotal) };
  const asOf = read.exportDate;
  if (asOf === null || !preview.figures) return { ok: true, summary };

  // Positions by Security key: union of ledger and file.
  const names = new Map(preview.securities.map((security) => [security.key, security.name]));
  const ledgerPositions = new Map<string, { quantity: string; costBasis: string }>();
  for (const position of await listPositions(preview.depot.id, asOf, db)) {
    const key = position.security.isin ?? position.security.cryptoSymbol ?? position.security.id;
    ledgerPositions.set(key, position);
    names.set(key, position.security.name);
  }
  const filePositions = new Map(preview.figures.positions.map((position) => [position.securityKey, position]));
  const keys = [...new Set([...ledgerPositions.keys(), ...filePositions.keys()])];
  const positions: PositionComparison[] = keys
    .map((key) => {
      const ledger = ledgerPositions.get(key);
      const file = filePositions.get(key);
      const quantity = figure(ledger?.quantity ?? "0", file?.quantity ?? "0", true);
      const costBasis = figure(ledger?.costBasis ?? "0", file?.costBasis ?? "0");
      return { key, name: names.get(key) ?? key, quantity, costBasis, mismatch: quantity.mismatch || costBasis.mismatch };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de-DE") || (a.key < b.key ? -1 : 1));
  const ledgerInvested = [...ledgerPositions.values()].reduce((sum, position) => sum.plus(position.costBasis), new ExactDecimal(0));

  const ledgerRows = await listTransactions(preview.depot.id, db);
  const ledgerCash = cashBalance(ledgerRows, asOf);

  const realized = await listRealizedSales(preview.depot.id, asOf, db);
  const saleAt = new Map(realized.map((sale) => [saleKey(sale.date, sale.sequence), sale]));
  const sales: SaleComparison[] = [];
  for (const proposal of read.proposals) {
    if (proposal.type !== "SELL" || proposal.realizedGain === null || proposal.securityKey === null) continue;
    const known = knownSellRows.get(itemKey(proposal));
    const row = typeof known === "string" ? result.transactions[known] : known;
    if (!row) continue;
    const sale = saleAt.get(saleKey(row.date, row.sequence));
    if (sale === undefined) continue;
    let gain = figure(sale.gain, proposal.realizedGain);
    if (gain.mismatch && classifyGainDifference(sale.gain, proposal.realizedGain, sale.fees) === "fees") {
      gain = { ...gain, mismatch: false, explained: "fees" };
    }
    sales.push({
      key: itemKey(proposal),
      securityKey: proposal.securityKey,
      name: names.get(proposal.securityKey) ?? proposal.securityKey,
      date: proposal.date,
      gain,
    });
  }

  let cash: Figure | null = null;
  if (read.hasCashRows) {
    // Parqet's own balance: the proposals' balance without the funding DEPOSITs (contribution DEPOSITs and
    // difference TAXes already sum to the file's Cash rows).
    cash = figure(ledgerCash, canonicalDecimal(new ExactDecimal(preview.figures.cashBalance).minus(fundingTotal)));
    const unexplained = new ExactDecimal(ledgerCash).minus(cash.file).minus(fundingTotal).abs();
    if (funding.length > 0 && unexplained.lessThanOrEqualTo(MONEY_TOLERANCE)) {
      cash = { ...cash, mismatch: false, explained: "missing-deposits" };
    }
  }
  summary.comparison = {
    positions,
    investedCapital: figure(canonicalDecimal(ledgerInvested), preview.figures.investedCapital),
    cash,
    sales,
  };
  if (!read.hasCashRows || funding.length > 0) {
    // Dated at the export date: aligning down to the broker's balance never makes past cash negative.
    summary.openingBalance = { date: asOf, asOf, ledgerBalance: ledgerCash };
  }
  return { ok: true, summary };
}

export type OpeningBalanceInput = { depotId: string; date: string; asOf: string; balance: string };

export type OpeningBalanceResult =
  /** `transaction` is `null` when the balance already matched; `balance` is the ledger's at `asOf` after it. */
  | { ok: true; transaction: TransactionRecord | null; balance: string }
  | { ok: false; reason: "balance-invalid" | "date-invalid" | "date-after-export" | "depot-not-found" | "depot-archived" }
  | Extract<RecordTransactionResult, { ok: false }>;

/**
 * Opening cash booking for a file without Cash rows or with funding added: books the difference between
 * `balance` (the broker's balance at `asOf`, the export date) and the ledger's balance at `asOf` as a
 * DEPOSIT (> 0) or WITHDRAWAL (< 0) dated `date` (≤ `asOf`). A zero difference books nothing.
 */
export async function recordOpeningBalance(input: OpeningBalanceInput, db: LedgerDb = prisma): Promise<OpeningBalanceResult> {
  if (!isDecimalString(input.balance)) return { ok: false, reason: "balance-invalid" };
  if (!isBusinessDate(input.date) || !isBusinessDate(input.asOf)) return { ok: false, reason: "date-invalid" };
  if (input.date > input.asOf) return { ok: false, reason: "date-after-export" };
  const depot = await getDepot(input.depotId, db);
  if (!depot) return { ok: false, reason: "depot-not-found" };
  if (depot.archived) return { ok: false, reason: "depot-archived" };

  const current = cashBalance(await listTransactions(depot.id, db), input.asOf);
  const difference = new ExactDecimal(input.balance).minus(current);
  if (difference.isZero()) return { ok: true, transaction: null, balance: current };
  const result = await recordTransaction(
    {
      depotId: depot.id,
      type: difference.isPositive() ? "DEPOSIT" : "WITHDRAWAL",
      date: input.date,
      amount: canonicalDecimal(difference.abs()),
      allowDuplicate: true,
    },
    db,
  );
  if (!result.ok) return result;
  return { ok: true, transaction: result.transaction, balance: cashBalance(await listTransactions(depot.id, db), input.asOf) };
}
