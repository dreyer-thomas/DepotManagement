/**
 * The user's decisions on a Parqet preview (stories 2.4, 2.5). Pure and client-safe: no Prisma, no I/O —
 * the wizard and the server share the schema and the "open decisions" rule.
 *
 * Decisions are keyed by `itemKey` (a flag's or proposal's records joined by "-") and, for
 * classifications, by Security key (ISIN). Classifications override the estimated type; a flag without
 * a decision is skipped. Open (blocking) is only a duplicate without skip/book.
 */
import { z } from "zod";
import { businessDate, isBusinessDate } from "@/core/dates";
import { ExactDecimal } from "@/core/decimal";
import { parseDecimalInput } from "@/core/decimal-input";
import type { FlaggedRow, RawRow } from "./parqet-reader";
import type { ParqetPreview, PreviewSecurity } from "./preview";

/** Types a new Parqet `Security` can be classified as (crypto comes classified). */
export const CLASSIFICATION_TYPES = ["STOCK", "ETF", "FUND", "CERTIFICATE"] as const;
export type ClassificationType = (typeof CLASSIFICATION_TYPES)[number];

/** Transaction types a flagged row can be corrected to. */
export const CORRECTION_TYPES = ["BUY", "SELL", "DIVIDEND", "TAX", "DEPOSIT", "WITHDRAWAL"] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

/** Correction types that carry a Security (optional for TAX). */
export const SECURITY_CORRECTION_TYPES: readonly CorrectionType[] = ["BUY", "SELL", "DIVIDEND", "TAX"];

/** Asset types a correction may give a Security that is neither in the file nor in the ledger. */
export const CORRECTION_ASSET_TYPES = ["STOCK", "ETF", "FUND", "CERTIFICATE", "CRYPTO"] as const;

const text = (max: number) => z.string().max(max);

/** A corrected flagged row: German decimal input as typed (parsed with `parseDecimalInput` on confirm). */
export const correctionSchema = z.object({
  type: z.enum(CORRECTION_TYPES),
  date: text(20),
  securityKey: text(20),
  securityName: text(200),
  assetType: z.union([z.enum(CORRECTION_ASSET_TYPES), z.literal("")]),
  quantity: text(40),
  price: text(40),
  amount: text(40),
  fee: text(40),
  tax: text(40),
});
export type Correction = z.infer<typeof correctionSchema>;

export type CorrectionField = "quantity" | "price" | "amount" | "fee" | "tax";

/** The figure fields a corrected type shows and books; the others are ignored. */
export function correctionFields(type: CorrectionType): CorrectionField[] {
  if (type === "BUY" || type === "SELL") return ["quantity", "price", "amount", "fee", "tax"];
  if (type === "DIVIDEND") return ["amount", "fee", "tax"];
  if (type === "TAX") return ["tax"];
  return ["amount"];
}

export const flagDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("skip") }),
  z.object({ action: z.literal("book"), correction: correctionSchema }),
]);
export type FlagDecision = z.infer<typeof flagDecisionSchema>;

export const DUPLICATE_DECISIONS = ["skip", "book"] as const;
export type DuplicateDecision = (typeof DUPLICATE_DECISIONS)[number];

export const decisionsSchema = z.object({
  classifications: z.record(z.string(), z.enum(CLASSIFICATION_TYPES)),
  flags: z.record(z.string(), flagDecisionSchema),
  duplicates: z.record(z.string(), z.enum(DUPLICATE_DECISIONS)),
});
export type MigrationDecisions = z.infer<typeof decisionsSchema>;

export const EMPTY_DECISIONS: MigrationDecisions = { classifications: {}, flags: {}, duplicates: {} };

/**
 * The key of a proposal or flag: its CSV record numbers joined by "-"; a delivery's DEPOSIT (same record
 * as its BUY) gets a trailing "d".
 */
export function itemKey(item: { records: readonly number[]; delivery?: "buy" | "deposit" }): string {
  return item.records.join("-") + (item.delivery === "deposit" ? "d" : "");
}

/** True for a Security that is not in the ledger yet and is identified by an ISIN: its estimated type can be overridden. */
export function isClassifiable(security: Pick<PreviewSecurity, "existing" | "cryptoSymbol">): boolean {
  return !security.existing && security.cryptoSymbol === null;
}

export type OpenDecision = { kind: "duplicate"; key: string };

type DecisionPreview = Pick<ParqetPreview, "securities" | "flagged" | "duplicates">;

/** Every decision still open (a duplicate without skip/book); confirmation is possible only when this is empty. */
export function openDecisions(preview: Pick<ParqetPreview, "duplicates">, decisions: MigrationDecisions): OpenDecision[] {
  const open: OpenDecision[] = [];
  for (const duplicate of preview.duplicates) {
    if (!decisions.duplicates[duplicate.key]) open.push({ kind: "duplicate", key: duplicate.key });
  }
  return open;
}

/** Decisions a fresh preview starts with: every duplicate pre-set to "skip". */
export function initialDecisions(preview: DecisionPreview): MigrationDecisions {
  return {
    classifications: {},
    flags: {},
    duplicates: Object.fromEntries(preview.duplicates.map((duplicate) => [duplicate.key, "skip" as const])),
  };
}

/** `previous` decisions whose keys still exist in `preview`, on top of its initial decisions. */
export function carryDecisions(preview: DecisionPreview, previous: MigrationDecisions): MigrationDecisions {
  const initial = initialDecisions(preview);
  const securityKeys = new Set(preview.securities.filter(isClassifiable).map((security) => security.key));
  const flagKeys = new Set(preview.flagged.map(itemKey));
  const keep = <T>(record: Record<string, T>, keys: Set<string>) =>
    Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
  return {
    classifications: keep(previous.classifications, securityKeys),
    flags: keep(previous.flags, flagKeys),
    duplicates: { ...initial.duplicates, ...keep(previous.duplicates, new Set(Object.keys(initial.duplicates))) },
  };
}

const unsigned = (value: string) => value.replace(/^-/, "");

/** The Europe/Berlin business date of a raw ISO datetime, or "" when it does not parse. */
function rawDate(datetime: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(datetime)) return "";
  const instant = new Date(datetime);
  return Number.isNaN(instant.getTime()) ? "" : businessDate(instant);
}

function draftType(row: RawRow, isCash: boolean): CorrectionType {
  switch (row.type.toLowerCase()) {
    case "buy":
      return "BUY";
    case "sell":
      return "SELL";
    case "dividend":
      return "DIVIDEND";
    case "cost":
      return "TAX";
    case "transferin":
      return isCash ? "DEPOSIT" : "BUY";
    case "transferout":
      return isCash ? "WITHDRAWAL" : "SELL";
    default:
      return isCash ? "DEPOSIT" : "BUY";
  }
}

/**
 * A correction prefilled from the flag's raw rows: the Security row (else the first row) gives type,
 * date, Security and figures. Quantity, amount and fee drop a minus sign (Parqet values are unsigned in
 * the ledger); tax keeps it (negative = refund).
 */
export function correctionDraft(flag: Pick<FlaggedRow, "rows">): Correction {
  const row = flag.rows.find((candidate) => candidate.assettype.toLowerCase() !== "cash") ?? flag.rows[0];
  if (!row) {
    return { type: "BUY", date: "", securityKey: "", securityName: "", assetType: "", quantity: "", price: "", amount: "", fee: "", tax: "" };
  }
  const isCash = row.assettype.toLowerCase() === "cash";
  return {
    type: draftType(row, isCash),
    date: rawDate(row.datetime),
    securityKey: isCash ? "" : row.identifier.toUpperCase(),
    securityName: isCash ? "" : row.holdingname,
    assetType: row.assettype.toLowerCase() === "crypto" ? "CRYPTO" : "",
    quantity: unsigned(row.shares),
    price: row.price,
    amount: unsigned(row.amount),
    fee: unsigned(row.fee),
    tax: row.tax,
  };
}

/** The ledger's `QUANTITY_MAX_DECIMALS` (not imported: this file stays client-safe). */
const QUANTITY_MAX_DECIMALS = 8;

const isEur = (row: RawRow) => row.currency.trim().toUpperCase() === "EUR";

/** The parsed figure, `null` when it does not parse; empty input gives `""`. */
function figureOf(text: string): string | null {
  const parsed = parseDecimalInput(text);
  return parsed.ok ? parsed.value : null;
}

/** Figures of a draft that satisfy the ledger's rules for its type (see `ledger.recordTransaction`). */
function figuresBookable(draft: Correction): boolean {
  const quantity = figureOf(draft.quantity);
  const price = figureOf(draft.price);
  const amount = figureOf(draft.amount);
  const fee = figureOf(draft.fee);
  const tax = figureOf(draft.tax);
  const atLeastZero = (value: string | null, required: boolean) =>
    value !== null && (value === "" ? !required : !new ExactDecimal(value).isNegative());
  const positive = (value: string | null) => value !== null && value !== "" && new ExactDecimal(value).greaterThan(0);
  switch (draft.type) {
    case "BUY":
    case "SELL": {
      if (!positive(quantity) || new ExactDecimal(quantity!).decimalPlaces() > QUANTITY_MAX_DECIMALS) return false;
      return atLeastZero(price, true) && atLeastZero(amount, false) && atLeastZero(fee, false) && tax !== null;
    }
    case "DIVIDEND":
      return positive(amount) && atLeastZero(fee, false) && tax !== null;
    case "TAX":
      return tax !== null && tax !== "" && !new ExactDecimal(tax).isZero();
    case "DEPOSIT":
    case "WITHDRAWAL":
      return positive(amount);
  }
}

/**
 * True when `draft` (the flag's prefilled correction) can be booked as-is: every raw row is in EUR, the
 * date is a business date, the figures satisfy the ledger's rules for the type, and BUY/SELL/DIVIDEND name
 * a Security of the preview (`securityKeys`; TAX: none or such a Security).
 */
export function bookableCorrection(
  flag: Pick<FlaggedRow, "rows">,
  draft: Correction,
  securityKeys: ReadonlySet<string>,
): boolean {
  if (flag.rows.length === 0 || !flag.rows.every(isEur)) return false;
  // The draft books one Security row; a flag of several (e.g. an unsupported split pair) is not as-is bookable.
  if (flag.rows.filter((row) => row.assettype.toLowerCase() !== "cash").length > 1) return false;
  if (!isBusinessDate(draft.date)) return false;
  if (!figuresBookable(draft)) return false;
  const key = draft.securityKey.trim().toUpperCase();
  if (draft.type === "BUY" || draft.type === "SELL" || draft.type === "DIVIDEND") return securityKeys.has(key);
  if (draft.type === "TAX") return key === "" || securityKeys.has(key);
  return true;
}

/**
 * "Alle wie in Parqet übernehmen": `decisions` with every flag decided — booked with its prefilled
 * correction when that is bookable, else skipped.
 */
export function parqetAsIsDecisions(
  preview: Pick<ParqetPreview, "securities" | "flagged">,
  decisions: MigrationDecisions,
): MigrationDecisions {
  const securityKeys = new Set(preview.securities.map((security) => security.key));
  const flags: Record<string, FlagDecision> = {};
  for (const flag of preview.flagged) {
    const draft = correctionDraft(flag);
    flags[itemKey(flag)] = bookableCorrection(flag, draft, securityKeys)
      ? { action: "book", correction: draft }
      : { action: "skip" };
  }
  return { ...decisions, flags };
}

/** The decisions "Übernehmen" sends: as-is (`parqetAsIsDecisions`) for "Alle wie in Parqet übernehmen", else unchanged. */
export function submittedDecisions(
  preview: Pick<ParqetPreview, "securities" | "flagged">,
  decisions: MigrationDecisions,
  asIs: boolean,
): MigrationDecisions {
  return asIs ? parqetAsIsDecisions(preview, decisions) : decisions;
}
