/**
 * Parqet CSV reader (FR-15; AD-6, AD-7, AD-8, AD-14, AD-16). Pure: `(text) → result`, no DB, no clock,
 * no I/O. Turns one Parqet export into chronological AD-14 Transaction proposals, ISIN-change proposals,
 * the Securities they reference and the rows that must not be booked (flagged, with reason).
 */
import { cashEffect } from "@/core/cash";
import { businessDate, isBusinessDate } from "@/core/dates";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { parseDecimalInput } from "@/core/decimal-input";
import { cryptoSymbolSchema, isinSchema, QUANTITY_MAX_DECIMALS, SECURITY_NAME_MAX_LENGTH } from "@/modules/ledger";
import { parseSemicolonCsv } from "./csv";

type Decimal = InstanceType<typeof ExactDecimal>;

export const PROPOSAL_TYPES = ["BUY", "SELL", "DIVIDEND", "TAX", "DEPOSIT", "WITHDRAWAL"] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

/** A proposed Transaction in AD-14 shape; `securityKey` is the ISIN or upper-case crypto symbol. */
export type TransactionProposal = {
  type: ProposalType;
  date: string;
  /** Chronological index (1-based) within the file's proposals. */
  sequence: number;
  securityKey: string | null;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  tax: string;
  /** Parqet's `realizedgains` of a SELL (reconciliation in story 2.4); `null` otherwise. */
  realizedGain: string | null;
  /** The file's amount before it was aligned to the cash row (rounding). */
  originalAmount?: string;
  /** The file's tax before it was aligned to the cash row (rounding, TAX only). */
  originalTax?: string;
  /** CSV record numbers (header = 1) this proposal came from, ascending. */
  records: number[];
};

export type IsinChangeProposal = {
  date: string;
  oldKey: string;
  newKey: string;
  oldQuantity: string;
  newQuantity: string;
  records: number[];
};

export type ParqetSecurity = {
  key: string;
  isin: string | null;
  cryptoSymbol: string | null;
  name: string;
  proposedAssetType: "UNCLASSIFIED" | "CRYPTO";
};

export const FLAG_REASONS = [
  "unparseable",
  "non-eur",
  "unsupported-row",
  "unpaired-security-transfer",
  "cash-pair-mismatch",
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

/**
 * A row (or pair) that is never booked. `detail`: the offending column (`unparseable`; absent on a wrong
 * field count), the currency (`non-eur`) or the raw `type/assettype` (`unsupported-row`).
 */
export type FlaggedRow = { records: number[]; reason: FlagReason; detail?: string };

export type ParqetReadResult =
  | {
      ok: true;
      proposals: TransactionProposal[];
      isinChanges: IsinChangeProposal[];
      securities: ParqetSecurity[];
      flagged: FlaggedRow[];
      /** Latest business date among Transaction and ISIN-change proposals (else among all parsed dates); `null` without any. */
      exportDate: string | null;
    }
  | { ok: false; reason: "empty-file" }
  | { ok: false; reason: "missing-columns"; columns: string[] };

export const REQUIRED_COLUMNS = [
  "datetime",
  "price",
  "shares",
  "amount",
  "tax",
  "fee",
  "type",
  "assettype",
  "identifier",
  "currency",
] as const;
type Column = (typeof REQUIRED_COLUMNS)[number] | "holdingname" | "realizedgains";

/** Cash pairs within this tolerance are collapsed (and aligned to the cash row). */
const PAIR_TOLERANCE = new ExactDecimal("0.01");

const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

/** Where a row sits in time: business date, instant (ms) and file position (newest rows come first). */
type Placement = { record: number; position: number; instant: number; date: string };

type Trade = Placement & {
  type: "BUY" | "SELL" | "DIVIDEND" | "TAX";
  securityKey: string | null;
  quantity: string | null;
  price: string | null;
  amount: string;
  fee: string;
  tax: string;
  realizedGain: string | null;
  originalAmount?: string;
  originalTax?: string;
  cashRecord?: number;
};

type Direction = "in" | "out";
type CashRow = Placement & { direction: Direction; amount: string };
type Transfer = Placement & { direction: Direction; key: string; shares: string };
type Named = { key: string; name: string; instant: number; position: number };

type Parsed =
  | { kind: "trade"; row: Trade }
  | { kind: "cash"; row: CashRow }
  | { kind: "transfer"; row: Transfer }
  /** `instant` is set when the datetime parsed; `nonCash` unless the row is a Cash TransferIn/TransferOut. */
  | { kind: "flag"; flag: FlaggedRow; instant?: number; nonCash: boolean };

class RowError extends Error {
  constructor(
    readonly reason: FlagReason,
    readonly detail?: string,
  ) {
    super(reason);
  }
}

/** Oldest first: business date, instant, then reverse file position (the file lists newest first). */
function compareChronological(a: Placement, b: Placement): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.instant !== b.instant) return a.instant - b.instant;
  return b.position - a.position;
}

function decimals(value: string): number {
  const dot = value.indexOf(".");
  return dot < 0 ? 0 : value.length - dot - 1;
}

/** Truncates to the Security name limit without splitting a code point. */
function securityName(raw: string): string {
  return Array.from(raw.trim().normalize("NFC")).slice(0, SECURITY_NAME_MAX_LENGTH).join("").trim();
}

function parseRecord(
  fields: string[],
  record: number,
  position: number,
  columns: Map<Column, number>,
  names: Named[],
  dates: string[],
): Parsed {
  const value = (column: Column): string => {
    const index = columns.get(column);
    return index === undefined ? "" : fields[index].trim();
  };
  const number = (column: Column, { required = true, absolute = true } = {}): string => {
    const parsed = parseDecimalInput(value(column));
    if (!parsed.ok) throw new RowError("unparseable", column);
    if (parsed.value === "") {
      if (required) throw new RowError("unparseable", column);
      return "0";
    }
    return absolute ? canonicalDecimal(new ExactDecimal(parsed.value).abs()) : parsed.value;
  };
  const quantity = (): string => {
    const shares = number("shares");
    if (decimals(shares) > QUANTITY_MAX_DECIMALS || !new ExactDecimal(shares).greaterThan(0)) {
      throw new RowError("unparseable", "shares");
    }
    return shares;
  };

  const rawType = value("type");
  const rawAssetType = value("assettype");
  const type = rawType.toLowerCase();
  const assetType = rawAssetType.toLowerCase();
  const nonCash = !(assetType === "cash" && (type === "transferin" || type === "transferout"));
  let parsedInstant: number | undefined;

  try {
    const datetime = value("datetime");
    const match = ISO_INSTANT.exec(datetime);
    // V8 rolls impossible dates and hours over (2024-02-30 → 03-01); reject them.
    if (!match || !isBusinessDate(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59) {
      throw new RowError("unparseable", "datetime");
    }
    const instantDate = new Date(datetime);
    const instant = instantDate.getTime();
    if (Number.isNaN(instant)) throw new RowError("unparseable", "datetime");
    parsedInstant = instant;
    const date = businessDate(instantDate);
    dates.push(date);
    const placement: Placement = { record, position, instant, date };

    const isAsset = assetType === "security" || assetType === "crypto";
    const isCash = assetType === "cash";
    const unsupported = () => new RowError("unsupported-row", `${rawType}/${rawAssetType}`);
    const supported =
      (isAsset && ["buy", "sell", "dividend", "transferin", "transferout", "cost"].includes(type)) ||
      (isCash && ["transferin", "transferout", "cost"].includes(type));
    if (!supported) throw unsupported();

    const currency = value("currency");
    if (currency.toUpperCase() !== "EUR") throw new RowError("non-eur", currency);

    let key: string | null = null;
    if (isAsset) {
      const identifier = value("identifier");
      if (identifier === "") throw new RowError("unparseable", "identifier");
      const parsed = (assetType === "security" ? isinSchema : cryptoSymbolSchema).safeParse(identifier);
      if (!parsed.success) throw new RowError("unparseable", "identifier");
      key = parsed.data;
    }

    let result: Parsed;
    if (isCash && type !== "cost") {
      result = {
        kind: "cash",
        row: { ...placement, direction: type === "transferin" ? "in" : "out", amount: number("amount") },
      };
    } else if (type === "transferin" || type === "transferout") {
      result = {
        kind: "transfer",
        row: { ...placement, direction: type === "transferin" ? "in" : "out", key: key!, shares: quantity() },
      };
    } else if (type === "cost") {
      const amount = number("amount", { required: false });
      const fee = number("fee", { required: false });
      const tax = number("tax", { required: false, absolute: false });
      if (amount !== "0" || fee !== "0" || tax === "0") throw unsupported();
      result = {
        kind: "trade",
        row: { ...placement, type: "TAX", securityKey: key, quantity: null, price: null, amount: "0", fee: "0", tax, realizedGain: null },
      };
    } else if (type === "dividend") {
      result = {
        kind: "trade",
        row: {
          ...placement,
          type: "DIVIDEND",
          securityKey: key,
          quantity: null,
          price: null,
          amount: number("amount"),
          fee: number("fee", { required: false }),
          tax: number("tax", { required: false, absolute: false }),
          realizedGain: null,
        },
      };
    } else {
      const shares = quantity();
      const price = number("price", { absolute: false });
      const amount = number("amount");
      const fee = number("fee", { required: false });
      const tax = number("tax", { required: false, absolute: false });
      let realizedGain: string | null = null;
      if (type === "sell" && columns.has("realizedgains")) {
        const gain = number("realizedgains", { required: false, absolute: false });
        realizedGain = value("realizedgains") === "" ? null : gain;
      }
      result = {
        kind: "trade",
        row: {
          ...placement,
          type: type === "buy" ? "BUY" : "SELL",
          securityKey: key,
          quantity: shares,
          price,
          amount,
          fee,
          tax,
          realizedGain,
        },
      };
    }
    if (key) names.push({ key, name: securityName(value("holdingname")), instant, position });
    return result;
  } catch (error) {
    if (error instanceof RowError) {
      return {
        kind: "flag",
        flag: { records: [record], reason: error.reason, ...(error.detail !== undefined ? { detail: error.detail } : {}) },
        instant: parsedInstant,
        nonCash,
      };
    }
    throw error;
  }
}

function effectOf(trade: Trade): Decimal {
  return new ExactDecimal(cashEffect(trade));
}

/** Closest cash row to `effect` by |cash − |effect||; earlier (chronological) rows win ties. */
function closest(candidates: CashRow[], effect: Decimal): { row: CashRow; difference: Decimal } | null {
  let best: { row: CashRow; difference: Decimal } | null = null;
  for (const row of candidates) {
    const difference = new ExactDecimal(row.amount).minus(effect.abs()).abs();
    if (!best || difference.lessThan(best.difference)) best = { row, difference };
  }
  return best;
}

/** Aligns the trade to the cash row so its derived cash effect equals the cash row exactly (AD-6). */
function alignToCash(trade: Trade, cash: CashRow, effect: Decimal): void {
  const target = effect.isNegative() ? new ExactDecimal(cash.amount).negated() : new ExactDecimal(cash.amount);
  if (target.equals(effect)) return;
  if (trade.type === "TAX") {
    trade.originalTax = trade.tax;
    trade.tax = canonicalDecimal(target.negated());
    return;
  }
  trade.originalAmount = trade.amount;
  const fee = new ExactDecimal(trade.fee);
  const tax = new ExactDecimal(trade.tax);
  // BUY: −(amount + fee + tax) = target; SELL/DIVIDEND: amount − fee − tax = target.
  const amount = trade.type === "BUY" ? target.negated().minus(fee).minus(tax) : target.plus(fee).plus(tax);
  trade.amount = canonicalDecimal(amount);
}

export function readParqetCsv(text: string): ParqetReadResult {
  const records = parseSemicolonCsv(text);
  if (records.length === 0) return { ok: false, reason: "empty-file" };

  const [header, ...rows] = records;
  const columns = new Map<Column, number>();
  header.fields.forEach((name, index) => {
    const column = name.trim().toLowerCase() as Column;
    if (!columns.has(column)) columns.set(column, index);
  });
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) return { ok: false, reason: "missing-columns", columns: missing };
  if (rows.length === 0) return { ok: false, reason: "empty-file" };

  const flagged: FlaggedRow[] = [];
  const trades: Trade[] = [];
  const cashRows: CashRow[] = [];
  const transfers: Transfer[] = [];
  const names: Named[] = [];
  const dates: string[] = [];
  // Flags of non-cash rows (trades) by instant: their same-instant cash rows are flagged with them.
  const tradeFlags = new Map<number, FlaggedRow>();

  rows.forEach(({ fields, recordNumber }, position) => {
    if (fields.length !== header.fields.length) {
      flagged.push({ records: [recordNumber], reason: "unparseable" });
      return;
    }
    const parsed = parseRecord(fields, recordNumber, position, columns, names, dates);
    if (parsed.kind === "flag") {
      flagged.push(parsed.flag);
      if (parsed.nonCash && parsed.instant !== undefined && !tradeFlags.has(parsed.instant)) {
        tradeFlags.set(parsed.instant, parsed.flag);
      }
    }
    else if (parsed.kind === "trade") trades.push(parsed.row);
    else if (parsed.kind === "cash") cashRows.push(parsed.row);
    else transfers.push(parsed.row);
  });

  trades.sort(compareChronological);
  cashRows.sort(compareChronological);

  // Cash pairing: a trade with a non-zero cash effect takes the closest unpaired cash row with the same
  // instant and direction; within €0.01 the two collapse into one proposal.
  const usedCash = new Set<CashRow>();
  const mismatched = new Set<Trade>();
  const unpairedWithCandidates: Trade[] = [];
  const candidatesOf = (trade: Trade, effect: Decimal) => {
    const direction: Direction = effect.isNegative() ? "out" : "in";
    return cashRows.filter((cash) => !usedCash.has(cash) && cash.instant === trade.instant && cash.direction === direction);
  };
  for (const trade of trades) {
    const effect = effectOf(trade);
    if (effect.isZero()) continue;
    const best = closest(candidatesOf(trade, effect), effect);
    if (!best) continue;
    if (best.difference.lessThanOrEqualTo(PAIR_TOLERANCE)) {
      usedCash.add(best.row);
      trade.cashRecord = best.row.record;
      alignToCash(trade, best.row, effect);
    } else {
      unpairedWithCandidates.push(trade);
    }
  }
  for (const trade of unpairedWithCandidates) {
    const best = closest(candidatesOf(trade, effectOf(trade)), effectOf(trade));
    if (!best) continue;
    usedCash.add(best.row);
    mismatched.add(trade);
    flagged.push({ records: [trade.record, best.row.record].sort((a, b) => a - b), reason: "cash-pair-mismatch" });
  }

  // A leftover cash row at the instant of a flagged trade row is that trade's cash leg: flag it with it.
  for (const cash of cashRows) {
    const flag = usedCash.has(cash) ? undefined : tradeFlags.get(cash.instant);
    if (!flag) continue;
    usedCash.add(cash);
    flag.records = [...flag.records, cash.record].sort((a, b) => a - b);
  }

  // Each proposal keeps where it sits in time until it is ordered.
  const pending: { at: Placement; proposal: Omit<TransactionProposal, "sequence"> }[] = [];
  for (const trade of trades) {
    if (mismatched.has(trade)) continue;
    const proposal: Omit<TransactionProposal, "sequence"> = {
      type: trade.type,
      date: trade.date,
      securityKey: trade.securityKey,
      quantity: trade.quantity,
      price: trade.price,
      amount: trade.amount,
      fee: trade.fee,
      tax: trade.tax,
      realizedGain: trade.realizedGain,
      records: trade.cashRecord === undefined ? [trade.record] : [trade.record, trade.cashRecord].sort((a, b) => a - b),
    };
    if (trade.originalAmount !== undefined) proposal.originalAmount = trade.originalAmount;
    if (trade.originalTax !== undefined) proposal.originalTax = trade.originalTax;
    pending.push({ at: trade, proposal });
  }
  for (const cash of cashRows) {
    if (usedCash.has(cash)) continue;
    pending.push({
      at: cash,
      proposal: {
        type: cash.direction === "in" ? "DEPOSIT" : "WITHDRAWAL",
        date: cash.date,
        securityKey: null,
        quantity: null,
        price: null,
        amount: cash.amount,
        fee: "0",
        tax: "0",
        realizedGain: null,
        records: [cash.record],
      },
    });
  }
  pending.sort((a, b) => compareChronological(a.at, b.at));
  const proposals: TransactionProposal[] = pending.map(({ proposal }, index) => ({ ...proposal, sequence: index + 1 }));

  // Security transfers: exactly one TransferOut + one TransferIn of different Securities at the same
  // instant is an ISIN change; anything else at that instant is flagged (AD-7).
  const byDatetime = new Map<number, Transfer[]>();
  for (const transfer of transfers) {
    const group = byDatetime.get(transfer.instant);
    if (group) group.push(transfer);
    else byDatetime.set(transfer.instant, [transfer]);
  }
  const changes: (IsinChangeProposal & Placement)[] = [];
  for (const group of byDatetime.values()) {
    const out = group.filter((transfer) => transfer.direction === "out");
    const into = group.filter((transfer) => transfer.direction === "in");
    if (out.length === 1 && into.length === 1 && out[0].key !== into[0].key) {
      changes.push({
        ...out[0],
        oldKey: out[0].key,
        newKey: into[0].key,
        oldQuantity: out[0].shares,
        newQuantity: into[0].shares,
        records: [out[0].record, into[0].record].sort((a, b) => a - b),
      });
    } else {
      flagged.push({
        records: group.map((transfer) => transfer.record).sort((a, b) => a - b),
        reason: "unpaired-security-transfer",
      });
    }
  }
  changes.sort(compareChronological);
  const isinChanges: IsinChangeProposal[] = changes.map(({ date, oldKey, newKey, oldQuantity, newQuantity, records }) => ({
    date,
    oldKey,
    newKey,
    oldQuantity,
    newQuantity,
    records,
  }));

  flagged.sort((a, b) => a.records[0] - b.records[0]);

  // Securities referenced by proposals and ISIN changes; name from the newest row that has one.
  const keys = new Set<string>();
  for (const proposal of proposals) if (proposal.securityKey) keys.add(proposal.securityKey);
  for (const change of isinChanges) {
    keys.add(change.oldKey);
    keys.add(change.newKey);
  }
  const newestName = new Map<string, Named>();
  for (const named of names) {
    if (named.name === "") continue;
    const current = newestName.get(named.key);
    if (!current || named.instant > current.instant || (named.instant === current.instant && named.position < current.position)) {
      newestName.set(named.key, named);
    }
  }
  const securities: ParqetSecurity[] = [...keys].sort().map((key) => {
    const crypto = !isinSchema.safeParse(key).success;
    return {
      key,
      isin: crypto ? null : key,
      cryptoSymbol: crypto ? key : null,
      name: newestName.get(key)?.name ?? key,
      proposedAssetType: crypto ? "CRYPTO" : "UNCLASSIFIED",
    };
  });

  const latest = (values: Iterable<string>) => {
    let max: string | null = null;
    for (const value of values) if (max === null || value > max) max = value;
    return max;
  };
  const proposedDates = [...proposals.map((proposal) => proposal.date), ...isinChanges.map((change) => change.date)];
  const exportDate = proposedDates.length > 0 ? latest(proposedDates) : latest(dates);

  return { ok: true, proposals, isinChanges, securities, flagged, exportDate };
}
