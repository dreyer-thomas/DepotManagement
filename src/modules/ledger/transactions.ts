import { prisma } from "@/db";
import type { TransactionType } from "@/db/generated/prisma/client";
import { isBusinessDate } from "@/core/dates";
import { canonicalDecimal, ExactDecimal, isDecimalString } from "@/core/decimal";
import { sellableQuantity } from "@/core/holdings";
import type { LedgerDb } from "./depots";
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
  | SecurityFailureReason;

/** Failure reasons of `recordTransaction`: the trade reasons plus a Security on a DEPOSIT/WITHDRAWAL. */
export type TransactionFailureReason = TradeFailureReason | "security-not-allowed";

export type RecordTransactionResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: Exclude<TransactionFailureReason, "sell-exceeds-holding"> }
  | { ok: false; reason: "sell-exceeds-holding"; available: string };

export type RecordTradeResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: Exclude<TradeFailureReason, "sell-exceeds-holding"> }
  | { ok: false; reason: "sell-exceeds-holding"; available: string };

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
};

export type RecordTradeInput = RecordTransactionInput & { quantity: unknown; price: unknown };

const TRANSACTION_INCLUDE = {
  security: { select: { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true } },
} as const;

export const TRANSACTION_TYPES = ["BUY", "SELL", "DIVIDEND", "FEE", "TAX", "DEPOSIT", "WITHDRAWAL"] as const satisfies readonly TransactionType[];

type Failure = Extract<RecordTransactionResult, { ok: false }>;
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
function parseSecurity(security: unknown): { ok: true; value: ValidSecurity | null } | Failure {
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

function validateTransaction(input: RecordTransactionInput): { ok: true; value: ValidTransaction } | Failure {
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

async function writeTransaction(transaction: ValidTransaction, db: LedgerDb): Promise<RecordTransactionResult> {
  const depot = await db.depot.findUnique({ where: { id: transaction.depotId }, select: { id: true } });
  if (!depot) return { ok: false, reason: "depot-not-found" };

  // Resolve the Security without writing; a new one is created only after every check passed.
  let securityId: string | null = null;
  if (transaction.security && "id" in transaction.security) {
    const found = await db.security.findUnique({ where: { id: transaction.security.id }, select: { id: true } });
    if (!found) return { ok: false, reason: "security-not-found" };
    securityId = found.id;
  } else if (transaction.security) {
    securityId = (await findSecurityByKey(transaction.security.new.key, db))?.id ?? null;
  }

  if (transaction.type === "SELL") {
    const trades = securityId
      ? await db.transaction.findMany({
          where: { depotId: transaction.depotId, securityId, type: { in: ["BUY", "SELL"] } },
          select: { securityId: true, type: true, date: true, sequence: true, quantity: true },
        })
      : [];
    const available = securityId ? sellableQuantity(trades, securityId, transaction.date) : "0";
    if (new ExactDecimal(transaction.quantity as string).greaterThan(available)) {
      return { ok: false, reason: "sell-exceeds-holding", available };
    }
  }

  if (!securityId && transaction.security && "new" in transaction.security) {
    const { key, name, assetType } = transaction.security.new;
    const created = await ensureSecurity(key, { name, assetType }, db);
    if (!created.ok) return created;
    securityId = created.security.id;
  }

  const last = await db.transaction.findFirst({
    where: { depotId: transaction.depotId, date: transaction.date },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const row = await db.transaction.create({
    data: {
      depotId: transaction.depotId,
      securityId,
      type: transaction.type,
      date: transaction.date,
      sequence: (last?.sequence ?? 0) + 1,
      quantity: transaction.quantity,
      price: transaction.price,
      amount: transaction.amount,
      fee: transaction.fee,
      tax: transaction.tax,
    },
    include: TRANSACTION_INCLUDE,
  });
  return { ok: true, transaction: toRecord(row) };
}

/**
 * Records a Transaction of any type in the AD-14 shape with the next intra-day sequence (appended at
 * the end of its date). BUY/SELL: quantity and price required, a SELL beyond the sellable quantity is
 * rejected. DIVIDEND: Security and amount > 0. FEE: fee > 0. TAX: tax ≠ 0 (negative = refund).
 * DEPOSIT/WITHDRAWAL: amount > 0, no Security. Cash may go negative. Expected failures never throw;
 * nothing is written on failure. Runs in one DB transaction (its own unless `db` already is one).
 */
export async function recordTransaction(
  input: RecordTransactionInput,
  db: LedgerDb = prisma,
): Promise<RecordTransactionResult> {
  const valid = validateTransaction(input);
  if (!valid.ok) return valid;
  const client = db as LedgerDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") {
    return client.$transaction((tx) => writeTransaction(valid.value, tx));
  }
  return writeTransaction(valid.value, db);
}

/**
 * Records a BUY or SELL (AD-14 shape); any other type is `type-invalid`. Delegates to
 * `recordTransaction`.
 */
export async function recordTrade(input: RecordTradeInput, db: LedgerDb = prisma): Promise<RecordTradeResult> {
  if (!TRADE_TYPES.includes(input.type as TradeType)) return { ok: false, reason: "type-invalid" };
  return (await recordTransaction(input, db)) as RecordTradeResult;
}

function toRecord(row: {
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
