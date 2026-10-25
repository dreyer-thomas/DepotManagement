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

export type RecordTradeResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: Exclude<TradeFailureReason, "sell-exceeds-holding"> }
  | { ok: false; reason: "sell-exceeds-holding"; available: string };

export type NewSecurityInput =
  | { isin: unknown; name: unknown; assetType: unknown }
  | { cryptoSymbol: unknown; name: unknown; assetType: unknown };

export type RecordTradeInput = {
  depotId: unknown;
  type: unknown;
  date: unknown;
  quantity: unknown;
  price: unknown;
  /** Gross value; defaults to quantity × price (exact). Importers pass the broker-stated value. */
  amount?: unknown;
  fee?: unknown;
  tax?: unknown;
  security?: { id: unknown } | { new: NewSecurityInput } | null;
};

const TRANSACTION_INCLUDE = {
  security: { select: { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true } },
} as const;

type Failure = Extract<RecordTradeResult, { ok: false }>;
type Decimalish = InstanceType<typeof ExactDecimal>;

/** Parses an optional canonical-ish decimal string; `undefined`/`""` gives the default. */
function decimal(value: unknown, fallback?: string): Decimalish | null {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) {
    return new ExactDecimal(fallback);
  }
  return isDecimalString(value) ? new ExactDecimal(value) : null;
}

type ValidTrade = {
  depotId: string;
  type: TradeType;
  date: string;
  quantity: string;
  price: string;
  amount: string;
  fee: string;
  tax: string;
  security: { id: string } | { new: Extract<ReturnType<typeof validateSecurity>, { ok: true }>["value"] };
};

function validateTrade(input: RecordTradeInput): { ok: true; value: ValidTrade } | Failure {
  if (typeof input.depotId !== "string" || input.depotId === "") return { ok: false, reason: "depot-not-found" };
  if (!TRADE_TYPES.includes(input.type as TradeType)) return { ok: false, reason: "type-invalid" };
  if (!isBusinessDate(input.date)) return { ok: false, reason: "date-invalid" };
  const quantity = decimal(input.quantity);
  if (!quantity || !quantity.greaterThan(0) || quantity.decimalPlaces() > QUANTITY_MAX_DECIMALS) {
    return { ok: false, reason: "quantity-invalid" };
  }
  const price = decimal(input.price);
  if (!price || price.isNegative()) return { ok: false, reason: "price-invalid" };
  const fee = decimal(input.fee, "0");
  if (!fee || fee.isNegative()) return { ok: false, reason: "fee-invalid" };
  const tax = decimal(input.tax, "0");
  if (!tax) return { ok: false, reason: "tax-invalid" };
  const amount = decimal(input.amount, quantity.times(price).toFixed());
  if (!amount || amount.isNegative()) return { ok: false, reason: "amount-invalid" };

  const security = input.security;
  let validSecurity: ValidTrade["security"];
  if (security && typeof security === "object" && "new" in security && security.new) {
    const { name, assetType, ...identifier } = security.new as Record<string, unknown>;
    const valid = validateSecurity(
      "isin" in identifier ? { isin: identifier.isin } : { cryptoSymbol: identifier.cryptoSymbol },
      { name, assetType },
    );
    if (!valid.ok) return valid;
    validSecurity = { new: valid.value };
  } else if (security && typeof security === "object" && "id" in security) {
    if (typeof security.id !== "string" || security.id === "") return { ok: false, reason: "security-required" };
    validSecurity = { id: security.id };
  } else {
    return { ok: false, reason: "security-required" };
  }

  return {
    ok: true,
    value: {
      depotId: input.depotId,
      type: input.type as TradeType,
      date: input.date,
      quantity: canonicalDecimal(quantity),
      price: canonicalDecimal(price),
      amount: canonicalDecimal(amount),
      fee: canonicalDecimal(fee),
      tax: canonicalDecimal(tax),
      security: validSecurity,
    },
  };
}

async function writeTrade(trade: ValidTrade, db: LedgerDb): Promise<RecordTradeResult> {
  const depot = await db.depot.findUnique({ where: { id: trade.depotId }, select: { id: true } });
  if (!depot) return { ok: false, reason: "depot-not-found" };

  // Resolve the Security without writing; a new one is created only after every check passed.
  let securityId: string | null;
  if ("id" in trade.security) {
    const found = await db.security.findUnique({ where: { id: trade.security.id }, select: { id: true } });
    if (!found) return { ok: false, reason: "security-not-found" };
    securityId = found.id;
  } else {
    securityId = (await findSecurityByKey(trade.security.new.key, db))?.id ?? null;
  }

  if (trade.type === "SELL") {
    const trades = securityId
      ? await db.transaction.findMany({
          where: { depotId: trade.depotId, securityId, type: { in: ["BUY", "SELL"] } },
          select: { securityId: true, type: true, date: true, sequence: true, quantity: true },
        })
      : [];
    const available = securityId ? sellableQuantity(trades, securityId, trade.date) : "0";
    if (new ExactDecimal(trade.quantity).greaterThan(available)) {
      return { ok: false, reason: "sell-exceeds-holding", available };
    }
  }

  if (!securityId && "new" in trade.security) {
    const { key, name, assetType } = trade.security.new;
    const created = await ensureSecurity(key, { name, assetType }, db);
    if (!created.ok) return created;
    securityId = created.security.id;
  }

  const last = await db.transaction.findFirst({
    where: { depotId: trade.depotId, date: trade.date },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const transaction = await db.transaction.create({
    data: {
      depotId: trade.depotId,
      securityId,
      type: trade.type,
      date: trade.date,
      sequence: (last?.sequence ?? 0) + 1,
      quantity: trade.quantity,
      price: trade.price,
      amount: trade.amount,
      fee: trade.fee,
      tax: trade.tax,
    },
    include: TRANSACTION_INCLUDE,
  });
  return { ok: true, transaction: toRecord(transaction) };
}

/**
 * Records a BUY or SELL (AD-14 shape) with the next intra-day sequence. A SELL is appended at the end
 * of its date and rejected when it exceeds the sellable quantity. Expected failures never throw;
 * nothing is written on failure. Runs in one DB transaction (its own unless `db` already is one).
 */
export async function recordTrade(input: RecordTradeInput, db: LedgerDb = prisma): Promise<RecordTradeResult> {
  const valid = validateTrade(input);
  if (!valid.ok) return valid;
  const client = db as LedgerDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") {
    return client.$transaction((tx) => writeTrade(valid.value, tx));
  }
  return writeTrade(valid.value, db);
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
