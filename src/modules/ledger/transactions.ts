import { prisma } from "@/db";
import type { TransactionType } from "@/db/generated/prisma/client";
import { isBusinessDate } from "@/core/dates";
import { canonicalDecimal, ExactDecimal, isDecimalString } from "@/core/decimal";
import { matchDuplicates } from "@/core/duplicates";
import { firstOversell, sellableAt, type TradeRow } from "@/core/holdings";
import { loadCorporateActions } from "./corporate-actions";
import { inTransaction, type LedgerDb } from "./depots";
import {
  ensureSecurity,
  findSecurityByKey,
  type SecurityFailureReason,
  type SecuritySummary,
  validateSecurity,
} from "./securities";

export type { TransactionType } from "@/db/generated/prisma/client";

export const TRADE_TYPES = ["BUY", "SELL"] as const;
export type TradeType = (typeof TRADE_TYPES)[number];

export const QUANTITY_MAX_DECIMALS = 8;

/** A ledger row in the canonical AD-14 shape; decimal values are canonical strings. */
export type TransactionRecord = {
  id: string;
  depotId: string;
  type: TransactionType;
  date: string;
  sequence: number;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  tax: string;
  security: SecuritySummary | null;
};

export type TradeFailureReason =
  | "depot-not-found"
  | "depot-archived"
  | "type-invalid"
  | "date-invalid"
  | "quantity-invalid"
  | "price-invalid"
  | "fee-invalid"
  | "tax-invalid"
  | "amount-invalid"
  | "security-required"
  | "security-not-found"
  | "sell-exceeds-holding"
  | "possible-duplicate"
  | SecurityFailureReason;

/**
 * Failure reasons of the ledger's Transaction writes: the trade reasons plus a Security on a
 * DEPOSIT/WITHDRAWAL, an unknown Transaction id (edit/delete) and an edit/delete that would make a
 * later SELL exceed the held quantity.
 */
export type TransactionFailureReason =
  | TradeFailureReason
  | "security-not-allowed"
  | "transaction-not-found"
  | "later-sell-exceeds-holding";

/** Reasons whose failure carries extra data. */
type DetailedReason = "sell-exceeds-holding" | "possible-duplicate" | "later-sell-exceeds-holding";

/** A SELL beyond the quantity sellable at its position; `available` is that quantity. */
export type SellExceedsHoldingFailure = { ok: false; reason: "sell-exceeds-holding"; available: string };

/**
 * The Transaction may repeat existing ones (`core/duplicates`): `duplicate` for one match, `ambiguous`
 * for several. Resubmit with `allowDuplicate: true` to book it anyway.
 */
export type PossibleDuplicateFailure = {
  ok: false;
  reason: "possible-duplicate";
  status: "duplicate" | "ambiguous";
  matches: TransactionRecord[];
};

/** An edit/delete would make the SELL on `date` exceed the held quantity. */
export type LaterSellExceedsHoldingFailure = { ok: false; reason: "later-sell-exceeds-holding"; date: string };

type RecordReason = Exclude<TransactionFailureReason, "transaction-not-found" | "later-sell-exceeds-holding">;

export type RecordTransactionResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: Exclude<RecordReason, DetailedReason> }
  | SellExceedsHoldingFailure
  | PossibleDuplicateFailure;

export type RecordTradeResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: Exclude<TradeFailureReason, DetailedReason> }
  | SellExceedsHoldingFailure
  | PossibleDuplicateFailure;

export type UpdateTransactionResult =
  | RecordTransactionResult
  | { ok: false; reason: "transaction-not-found" }
  | LaterSellExceedsHoldingFailure;

/** On success, `transaction` is the deleted row as it was. */
export type DeleteTransactionResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: "transaction-not-found" | "depot-archived" }
  | LaterSellExceedsHoldingFailure;

export type NewSecurityInput =
  | { isin: unknown; name: unknown; assetType: unknown }
  | { cryptoSymbol: unknown; name: unknown; assetType: unknown };

export type SecurityRefInput = { id: unknown } | { new: NewSecurityInput } | null;

export type RecordTransactionInput = {
  depotId: unknown;
  type: unknown;
  date: unknown;
  /** BUY/SELL only; ignored (stored as null) for other types. */
  quantity?: unknown;
  /** BUY/SELL only; ignored (stored as null) for other types. */
  price?: unknown;
  /**
   * Gross value. BUY/SELL: defaults to quantity × price (exact). DIVIDEND/DEPOSIT/WITHDRAWAL: required,
   * > 0. FEE/TAX: must be absent or 0.
   */
  amount?: unknown;
  fee?: unknown;
  tax?: unknown;
  security?: SecurityRefInput;
  /** Book even when the duplicate check finds a possible duplicate (the user confirmed it). */
  allowDuplicate?: boolean;
};

export type RecordTradeInput = RecordTransactionInput & { quantity: unknown; price: unknown };

export const TRANSACTION_INCLUDE = {
  security: { select: { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true } },
} as const;

export const TRANSACTION_TYPES = ["BUY", "SELL", "DIVIDEND", "FEE", "TAX", "DEPOSIT", "WITHDRAWAL"] as const satisfies readonly TransactionType[];

type ValidationFailure = { ok: false; reason: Exclude<RecordReason, DetailedReason> };
type Decimalish = InstanceType<typeof ExactDecimal>;

/** Parses an optional canonical-ish decimal string; `undefined`/`""` gives the default. */
function decimal(value: unknown, fallback?: string): Decimalish | null {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) {
    return new ExactDecimal(fallback);
  }
  return isDecimalString(value) ? new ExactDecimal(value) : null;
}

type ValidSecurity = { id: string } | { new: Extract<ReturnType<typeof validateSecurity>, { ok: true }>["value"] };

type ValidTransaction = {
  depotId: string;
  type: TransactionType;
  date: string;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  tax: string;
  security: ValidSecurity | null;
};

/** Parses the Security reference; `null` means none was given (an empty or non-string id counts as none). */
function parseSecurity(security: unknown): { ok: true; value: ValidSecurity | null } | ValidationFailure {
  if (security && typeof security === "object" && "new" in security && security.new) {
    const { name, assetType, ...identifier } = security.new as Record<string, unknown>;
    const valid = validateSecurity(
      "isin" in identifier ? { isin: identifier.isin } : { cryptoSymbol: identifier.cryptoSymbol },
      { name, assetType },
    );
    if (!valid.ok) return valid;
    return { ok: true, value: { new: valid.value } };
  }
  if (security && typeof security === "object" && "id" in security) {
    const id = (security as { id: unknown }).id;
    return { ok: true, value: typeof id === "string" && id !== "" ? { id } : null };
  }
  return { ok: true, value: null };
}

/** A value that must be zero for this type: absent, empty or a decimal equal to 0. */
function isZeroOrAbsent(value: unknown): boolean {
  const parsed = decimal(value, "0");
  return parsed !== null && parsed.isZero();
}

function validateTransaction(input: RecordTransactionInput): { ok: true; value: ValidTransaction } | ValidationFailure {
  if (typeof input.depotId !== "string" || input.depotId === "") return { ok: false, reason: "depot-not-found" };
  if (!TRANSACTION_TYPES.includes(input.type as TransactionType)) return { ok: false, reason: "type-invalid" };
  const type = input.type as TransactionType;
  if (!isBusinessDate(input.date)) return { ok: false, reason: "date-invalid" };

  let quantity: Decimalish | null = null;
  let price: Decimalish | null = null;
  let amount: Decimalish;
  let fee: Decimalish;
  let tax: Decimalish;

  if (type === "BUY" || type === "SELL") {
    quantity = decimal(input.quantity);
    if (!quantity || !quantity.greaterThan(0) || quantity.decimalPlaces() > QUANTITY_MAX_DECIMALS) {
      return { ok: false, reason: "quantity-invalid" };
    }
    price = decimal(input.price);
    if (!price || price.isNegative()) return { ok: false, reason: "price-invalid" };
    const parsedFee = decimal(input.fee, "0");
    if (!parsedFee || parsedFee.isNegative()) return { ok: false, reason: "fee-invalid" };
    const parsedTax = decimal(input.tax, "0");
    if (!parsedTax) return { ok: false, reason: "tax-invalid" };
    const parsedAmount = decimal(input.amount, quantity.times(price).toFixed());
    if (!parsedAmount || parsedAmount.isNegative()) return { ok: false, reason: "amount-invalid" };
    [fee, tax, amount] = [parsedFee, parsedTax, parsedAmount];
  } else if (type === "DIVIDEND") {
    const parsedAmount = decimal(input.amount);
    if (!parsedAmount || !parsedAmount.greaterThan(0)) return { ok: false, reason: "amount-invalid" };
    const parsedFee = decimal(input.fee, "0");
    if (!parsedFee || parsedFee.isNegative()) return { ok: false, reason: "fee-invalid" };
    const parsedTax = decimal(input.tax, "0");
    if (!parsedTax) return { ok: false, reason: "tax-invalid" };
    [fee, tax, amount] = [parsedFee, parsedTax, parsedAmount];
  } else if (type === "FEE") {
    const parsedFee = decimal(input.fee);
    if (!parsedFee || !parsedFee.greaterThan(0)) return { ok: false, reason: "fee-invalid" };
    if (!isZeroOrAbsent(input.amount)) return { ok: false, reason: "amount-invalid" };
    if (!isZeroOrAbsent(input.tax)) return { ok: false, reason: "tax-invalid" };
    [fee, tax, amount] = [parsedFee, new ExactDecimal(0), new ExactDecimal(0)];
  } else if (type === "TAX") {
    const parsedTax = decimal(input.tax);
    if (!parsedTax || parsedTax.isZero()) return { ok: false, reason: "tax-invalid" };
    if (!isZeroOrAbsent(input.amount)) return { ok: false, reason: "amount-invalid" };
    if (!isZeroOrAbsent(input.fee)) return { ok: false, reason: "fee-invalid" };
    [fee, tax, amount] = [new ExactDecimal(0), parsedTax, new ExactDecimal(0)];
  } else {
    const parsedAmount = decimal(input.amount);
    if (!parsedAmount || !parsedAmount.greaterThan(0)) return { ok: false, reason: "amount-invalid" };
    if (!isZeroOrAbsent(input.fee)) return { ok: false, reason: "fee-invalid" };
    if (!isZeroOrAbsent(input.tax)) return { ok: false, reason: "tax-invalid" };
    [fee, tax, amount] = [new ExactDecimal(0), new ExactDecimal(0), parsedAmount];
  }

  const security = parseSecurity(input.security);
  if (!security.ok) return security;
  const needsSecurity = type === "BUY" || type === "SELL" || type === "DIVIDEND";
  const forbidsSecurity = type === "DEPOSIT" || type === "WITHDRAWAL";
  if (needsSecurity && !security.value) return { ok: false, reason: "security-required" };
  if (forbidsSecurity && security.value) return { ok: false, reason: "security-not-allowed" };

  return {
    ok: true,
    value: {
      depotId: input.depotId,
      type,
      date: input.date,
      quantity: quantity ? canonicalDecimal(quantity) : null,
      price: price ? canonicalDecimal(price) : null,
      amount: canonicalDecimal(amount),
      fee: canonicalDecimal(fee),
      tax: canonicalDecimal(tax),
      security: security.value,
    },
  };
}

const TRADE_SELECT = { id: true, securityId: true, type: true, date: true, sequence: true, quantity: true } as const;

type TradeRowWithId = TradeRow & { id: string };

/**
 * Resolves the Security without writing: an existing id must exist; a new one resolves to an existing
 * Security with the same ISIN/crypto symbol, else stays unresolved (`null`) until every check passed.
 */
async function resolveSecurity(
  transaction: ValidTransaction,
  db: LedgerDb,
): Promise<{ ok: true; securityId: string | null } | ValidationFailure> {
  if (transaction.security && "id" in transaction.security) {
    const found = await db.security.findUnique({ where: { id: transaction.security.id }, select: { id: true } });
    if (!found) return { ok: false, reason: "security-not-found" };
    return { ok: true, securityId: found.id };
  }
  if (transaction.security) {
    return { ok: true, securityId: (await findSecurityByKey(transaction.security.new.key, db))?.id ?? null };
  }
  return { ok: true, securityId: null };
}

/** Next intra-day sequence of `date` in the Depot (appended after its last row). */
async function nextSequence(depotId: string, date: string, db: LedgerDb): Promise<number> {
  const last = await db.transaction.findFirst({
    where: { depotId, date },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  return (last?.sequence ?? 0) + 1;
}

type HoldingChange = {
  depotId: string;
  /** The row being edited or deleted; it leaves the ledger. */
  removedId: string | null;
  /** The row being written at its final position; `securityId` null for a not-yet-existing new Security. */
  added: TradeRow | null;
};

/**
 * Holding guard over the Depot's BUY/SELL rows (every Security) with the change applied, replayed with
 * every corporate action (splits and ISIN-change lineages): a written SELL beyond `sellableAt` its
 * position is `sell-exceeds-holding`; otherwise a SELL that the change makes oversell (and that did
 * not before) is `later-sell-exceeds-holding`. `available` is in the SELL's own units.
 */
async function checkHoldings(
  change: HoldingChange,
  db: LedgerDb,
): Promise<{ ok: true } | SellExceedsHoldingFailure | LaterSellExceedsHoldingFailure> {
  const { added } = change;
  if (added?.type === "SELL" && added.securityId === null) {
    // A Security that does not exist yet is not held anywhere.
    return { ok: false, reason: "sell-exceeds-holding", available: "0" };
  }
  const before: TradeRowWithId[] = await db.transaction.findMany({
    where: { depotId: change.depotId, type: { in: ["BUY", "SELL"] } },
    select: TRADE_SELECT,
  });
  const actions = await loadCorporateActions(db);
  const others = before.filter((row) => row.id !== change.removedId);
  if (added?.type === "SELL" && added.securityId !== null) {
    const available = sellableAt(others, added.securityId, added, actions);
    if (new ExactDecimal(added.quantity as string).greaterThan(available)) {
      return { ok: false, reason: "sell-exceeds-holding", available };
    }
  }
  const after: TradeRow[] = added && added.securityId !== null ? [...others, added] : others;
  const oversell = firstOversell(after, actions);
  if (oversell && !firstOversell(before, actions)) {
    return { ok: false, reason: "later-sell-exceeds-holding", date: oversell.date };
  }
  return { ok: true };
}

/**
 * Advisory duplicate check (AD-15, manual policy): the Depot's rows matching the candidate, the
 * edited row excluded; Securities are compared through recorded ISIN changes. A not-yet-existing new
 * Security is unique by definition.
 */
async function checkDuplicates(
  transaction: ValidTransaction,
  securityId: string | null,
  excludeId: string | null,
  db: LedgerDb,
): Promise<{ ok: true } | PossibleDuplicateFailure> {
  if (transaction.security && securityId === null) return { ok: true };
  const rows = await db.transaction.findMany({
    where: { depotId: transaction.depotId, date: transaction.date, type: transaction.type },
    orderBy: [{ date: "asc" }, { sequence: "asc" }],
    include: TRANSACTION_INCLUDE,
  });
  const { isinChanges } = await loadCorporateActions(db);
  const result = matchDuplicates(
    { ...(excludeId ? { id: excludeId } : {}), ...transaction, securityId },
    rows,
    isinChanges,
  );
  if (result.status === "unique") return { ok: true };
  return { ok: false, reason: "possible-duplicate", status: result.status, matches: result.matches.map(toRecord) };
}

/** Creates the new Security of `transaction` when it was not resolved to an existing one. */
async function ensureResolvedSecurity(
  transaction: ValidTransaction,
  securityId: string | null,
  db: LedgerDb,
): Promise<{ ok: true; securityId: string | null } | ValidationFailure> {
  if (securityId || !transaction.security || !("new" in transaction.security)) return { ok: true, securityId };
  const { key, name, assetType } = transaction.security.new;
  const created = await ensureSecurity(key, { name, assetType }, db);
  if (!created.ok) return created;
  return { ok: true, securityId: created.security.id };
}

function rowData(transaction: ValidTransaction) {
  return {
    type: transaction.type,
    date: transaction.date,
    quantity: transaction.quantity,
    price: transaction.price,
    amount: transaction.amount,
    fee: transaction.fee,
    tax: transaction.tax,
  };
}

/** True when the Depot is archived (read-only, AD-17). */
async function isArchived(depotId: string, db: LedgerDb): Promise<boolean> {
  const depot = await db.depot.findUnique({ where: { id: depotId }, select: { archived: true } });
  return depot?.archived === true;
}

async function writeTransaction(
  transaction: ValidTransaction,
  allowDuplicate: boolean,
  db: LedgerDb,
): Promise<RecordTransactionResult> {
  const depot = await db.depot.findUnique({ where: { id: transaction.depotId }, select: { id: true, archived: true } });
  if (!depot) return { ok: false, reason: "depot-not-found" };
  if (depot.archived) return { ok: false, reason: "depot-archived" };

  const resolved = await resolveSecurity(transaction, db);
  if (!resolved.ok) return resolved;
  const sequence = await nextSequence(transaction.depotId, transaction.date, db);

  const holdings = await checkHoldings(
    {
      depotId: transaction.depotId,
      removedId: null,
      added: { ...transaction, securityId: resolved.securityId, sequence },
    },
    db,
  );
  // Appending a row never turns an earlier-valid later SELL negative unless it is that SELL itself.
  if (!holdings.ok) return holdings as SellExceedsHoldingFailure;

  if (!allowDuplicate) {
    const duplicates = await checkDuplicates(transaction, resolved.securityId, null, db);
    if (!duplicates.ok) return duplicates;
  }

  const ensured = await ensureResolvedSecurity(transaction, resolved.securityId, db);
  if (!ensured.ok) return ensured;

  const row = await db.transaction.create({
    data: { ...rowData(transaction), depotId: transaction.depotId, securityId: ensured.securityId, sequence },
    include: TRANSACTION_INCLUDE,
  });
  return { ok: true, transaction: toRecord(row) };
}

/**
 * Records a Transaction of any type in the AD-14 shape with the next intra-day sequence (appended at
 * the end of its date). BUY/SELL: quantity and price required, a SELL beyond the sellable quantity is
 * rejected. DIVIDEND: Security and amount > 0. FEE: fee > 0. TAX: tax ≠ 0 (negative = refund).
 * DEPOSIT/WITHDRAWAL: amount > 0, no Security. Cash may go negative. An archived Depot is
 * `depot-archived`. After every other check, a
 * possible duplicate is `possible-duplicate` unless `allowDuplicate` is true. Expected failures never
 * throw; nothing is written on failure. Runs in one DB transaction (its own unless `db` already is one).
 */
export async function recordTransaction(
  input: RecordTransactionInput,
  db: LedgerDb = prisma,
): Promise<RecordTransactionResult> {
  const valid = validateTransaction(input);
  if (!valid.ok) return valid;
  return inTransaction(db, (tx) => writeTransaction(valid.value, input.allowDuplicate === true, tx));
}

/**
 * Replaces Transaction `id` with `input`, validated like `recordTransaction` (the type may change).
 * The Depot stays the row's Depot (`input.depotId` is ignored). Same date keeps the sequence; a new
 * date appends the row after the last row of that date. Rejects an edit that makes its own SELL or a
 * later SELL of the old or new Security exceed the held quantity, and a possible duplicate of another
 * row unless `allowDuplicate`. A row of an archived Depot is `depot-archived`. Nothing is written on
 * failure; one DB transaction.
 */
export async function updateTransaction(
  id: string,
  input: RecordTransactionInput,
  db: LedgerDb = prisma,
): Promise<UpdateTransactionResult> {
  return inTransaction(db, async (tx): Promise<UpdateTransactionResult> => {
    const existing = await tx.transaction.findUnique({
      where: { id: typeof id === "string" ? id : "" },
      select: { ...TRADE_SELECT, depotId: true },
    });
    if (!existing) return { ok: false, reason: "transaction-not-found" };
    const { depotId } = existing;
    const valid = validateTransaction({ ...input, depotId });
    if (!valid.ok) return valid;
    if (await isArchived(depotId, tx)) return { ok: false, reason: "depot-archived" };
    const transaction = valid.value;

    const resolved = await resolveSecurity(transaction, tx);
    if (!resolved.ok) return resolved;
    const sequence =
      transaction.date === existing.date ? existing.sequence : await nextSequence(depotId, transaction.date, tx);

    const holdings = await checkHoldings(
      {
        depotId,
        removedId: existing.id,
        added: { ...transaction, securityId: resolved.securityId, sequence },
      },
      tx,
    );
    if (!holdings.ok) return holdings;

    if (input.allowDuplicate !== true) {
      const duplicates = await checkDuplicates(transaction, resolved.securityId, existing.id, tx);
      if (!duplicates.ok) return duplicates;
    }

    const ensured = await ensureResolvedSecurity(transaction, resolved.securityId, tx);
    if (!ensured.ok) return ensured;

    const row = await tx.transaction.update({
      where: { id: existing.id },
      data: { ...rowData(transaction), securityId: ensured.securityId, sequence },
      include: TRANSACTION_INCLUDE,
    });
    return { ok: true, transaction: toRecord(row) };
  });
}

/**
 * Deletes Transaction `id`, unless that makes a later SELL of its Security exceed the held quantity.
 * A row of an archived Depot is `depot-archived`. The Security row stays. Nothing is written on
 * failure; one DB transaction.
 */
export async function deleteTransaction(id: string, db: LedgerDb = prisma): Promise<DeleteTransactionResult> {
  return inTransaction(db, async (tx): Promise<DeleteTransactionResult> => {
    const existing = await tx.transaction.findUnique({
      where: { id: typeof id === "string" ? id : "" },
      include: TRANSACTION_INCLUDE,
    });
    if (!existing) return { ok: false, reason: "transaction-not-found" };
    if (await isArchived(existing.depotId, tx)) return { ok: false, reason: "depot-archived" };
    const holdings = await checkHoldings(
      { depotId: existing.depotId, removedId: existing.id, added: null },
      tx,
    );
    // Without an added row only a later SELL can break.
    if (!holdings.ok) return holdings as LaterSellExceedsHoldingFailure;
    await tx.transaction.delete({ where: { id: existing.id } });
    return { ok: true, transaction: toRecord(existing) };
  });
}

/**
 * Records a BUY or SELL (AD-14 shape); any other type is `type-invalid`. Delegates to
 * `recordTransaction`.
 */
export async function recordTrade(input: RecordTradeInput, db: LedgerDb = prisma): Promise<RecordTradeResult> {
  if (!TRADE_TYPES.includes(input.type as TradeType)) return { ok: false, reason: "type-invalid" };
  return (await recordTransaction(input, db)) as RecordTradeResult;
}

export function toRecord(row: {
  id: string;
  depotId: string;
  type: TransactionType;
  date: string;
  sequence: number;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  tax: string;
  security: SecuritySummary | null;
}): TransactionRecord {
  return {
    id: row.id,
    depotId: row.depotId,
    type: row.type,
    date: row.date,
    sequence: row.sequence,
    quantity: row.quantity,
    price: row.price,
    amount: row.amount,
    fee: row.fee,
    tax: row.tax,
    security: row.security,
  };
}

/** A Depot's Transactions, newest first by (date, sequence), each with its Security. */
export async function listTransactions(depotId: string, db: LedgerDb = prisma): Promise<TransactionRecord[]> {
  const rows = await db.transaction.findMany({
    where: { depotId },
    orderBy: [{ date: "desc" }, { sequence: "desc" }],
    include: TRANSACTION_INCLUDE,
  });
  return rows.map(toRecord);
}
