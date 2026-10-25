import { z } from "zod";
import { prisma } from "@/db";
import { Prisma } from "@/db/generated/prisma/client";
import { type CorporateActions, type IsinChange, parseSplitRatio, type Split } from "@/core/corporate-actions";
import { isBusinessDate } from "@/core/dates";
import { canonicalDecimal, ExactDecimal, isDecimalString } from "@/core/decimal";
import { firstOversell, type TradeRow } from "@/core/holdings";
import { inTransaction, type LedgerDb } from "./depots";
import {
  ensureSecurity,
  findSecurityByKey,
  type SecurityFailureReason,
  type SecuritySummary,
  validateSecurity,
} from "./securities";

/** A recorded stock split (CorporateAction of type SPLIT) with its Security; ratio `old:new`. */
export type SplitRecord = { id: string; security: SecuritySummary; date: string; ratioOld: string; ratioNew: string };

export type SplitFailureReason =
  | "security-not-found"
  | "date-invalid"
  | "ratio-invalid"
  | "split-exists"
  | "split-not-found"
  | "later-sell-exceeds-holding";

/** The change would make the SELL on `date` (in some Depot) exceed the held quantity. */
export type SplitLaterSellFailure = LaterSellFailure;

export type SplitResult =
  | { ok: true; split: SplitRecord }
  | { ok: false; reason: Exclude<SplitFailureReason, "later-sell-exceeds-holding"> }
  | SplitLaterSellFailure;

export type RecordSplitInput = { securityId: unknown; date: unknown; ratio: unknown };
export type UpdateSplitInput = { date: unknown; ratio: unknown };

const SECURITY_SELECT = { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true } as const;
const SPLIT_INCLUDE = { security: { select: SECURITY_SELECT } } as const;

const splitSchema = z.object({
  date: z.unknown().refine(isBusinessDate, { error: "date-invalid" }),
  ratio: z.unknown().transform((value, context) => {
    const parsed = parseSplitRatio(value);
    if (!parsed) {
      context.addIssue({ code: "custom", message: "ratio-invalid" });
      return z.NEVER;
    }
    return parsed;
  }),
});

type ValidSplit = { date: string; ratioOld: string; ratioNew: string };

function validate(input: UpdateSplitInput): { ok: true; value: ValidSplit } | { ok: false; reason: "date-invalid" | "ratio-invalid" } {
  const result = splitSchema.safeParse({ date: input.date, ratio: input.ratio });
  if (!result.success) return { ok: false, reason: result.error.issues[0].message as "date-invalid" | "ratio-invalid" };
  return { ok: true, value: { date: result.data.date as string, ...result.data.ratio } };
}

function toRecord(row: {
  id: string;
  date: string;
  ratioOld: string;
  ratioNew: string;
  security: SecuritySummary;
}): SplitRecord {
  return { id: row.id, security: row.security, date: row.date, ratioOld: row.ratioOld, ratioNew: row.ratioNew };
}

type ActionRow = {
  id: string;
  type: "SPLIT" | "ISIN_CHANGE";
  securityId: string;
  newSecurityId: string | null;
  date: string;
  ratioOld: string;
  ratioNew: string;
};

/** A hypothetical change to the stored actions, for guards: drop one, change one's values, or add one. */
export type ActionOverride =
  | { exclude: string }
  | { replace: { id: string; date: string; ratioOld: string; ratioNew: string } }
  | { add: Omit<ActionRow, "id"> };

/** Sorts after every stored cuid: a not-yet-written action is the last of its date. */
const NEW_ACTION_ID = "\uffff";

/**
 * Every recorded corporate action as core `CorporateActions`: splits and ISIN changes, each ordered by
 * `(date, id)`; optionally with `override` applied (for before/after guards). For the ledger's own reads
 * and guards.
 */
export async function loadCorporateActions(db: LedgerDb, override?: ActionOverride): Promise<CorporateActions> {
  let rows: ActionRow[] = await db.corporateAction.findMany({
    select: { id: true, type: true, securityId: true, newSecurityId: true, date: true, ratioOld: true, ratioNew: true },
  });
  if (override && "exclude" in override) rows = rows.filter((row) => row.id !== override.exclude);
  if (override && "replace" in override) {
    rows = rows.map((row) => (row.id === override.replace.id ? { ...row, ...override.replace } : row));
  }
  if (override && "add" in override) rows = [...rows, { ...override.add, id: NEW_ACTION_ID }];
  rows.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const splits: Split[] = [];
  const isinChanges: IsinChange[] = [];
  for (const row of rows) {
    if (row.type === "SPLIT") {
      splits.push({ securityId: row.securityId, date: row.date, ratioOld: row.ratioOld, ratioNew: row.ratioNew });
    } else if (row.newSecurityId) {
      isinChanges.push(toIsinChange({ ...row, newSecurityId: row.newSecurityId }));
    }
  }
  return { splits, isinChanges };
}

function toIsinChange(row: { securityId: string; newSecurityId: string; date: string; ratioOld: string; ratioNew: string }): IsinChange {
  return {
    oldSecurityId: row.securityId,
    newSecurityId: row.newSecurityId,
    date: row.date,
    oldQuantity: row.ratioOld,
    newQuantity: row.ratioNew,
  };
}

/** The change would make the SELL on `date` (in some Depot) exceed the held quantity. */
export type LaterSellFailure = { ok: false; reason: "later-sell-exceeds-holding"; date: string };

/**
 * Oversell guard across every Depot: refused when, with the corporate actions `after`, a SELL exceeds
 * the then-held quantity where none did with `before` (ISIN-change lineages included). `date` is the
 * earliest such SELL's date.
 */
export async function checkActionHoldings(
  db: LedgerDb,
  before: CorporateActions,
  after: CorporateActions,
): Promise<{ ok: true } | LaterSellFailure> {
  const trades = await db.transaction.findMany({
    where: { type: { in: ["BUY", "SELL"] } },
    select: { depotId: true, securityId: true, type: true, date: true, sequence: true, quantity: true },
  });
  const byDepot = new Map<string, TradeRow[]>();
  for (const { depotId, ...row } of trades) {
    const list = byDepot.get(depotId);
    if (list) list.push(row);
    else byDepot.set(depotId, [row]);
  }
  let earliest: string | null = null;
  for (const rows of byDepot.values()) {
    const oversell = firstOversell(rows, after);
    if (oversell && !firstOversell(rows, before)) {
      if (earliest === null || oversell.date < earliest) earliest = oversell.date;
    }
  }
  return earliest === null ? { ok: true } : { ok: false, reason: "later-sell-exceeds-holding", date: earliest };
}

/** True when the Security already has a split on `date` (other than `exceptId`). */
async function splitExists(db: LedgerDb, securityId: string, date: string, exceptId?: string): Promise<boolean> {
  const existing = await db.corporateAction.findFirst({
    where: { securityId, type: "SPLIT", date, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return existing !== null;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Records a stock split of a Security (AD-7): effective `date` (`YYYY-MM-DD`, applies before every
 * Transaction of that date) and `ratio` text `old:new` (e.g. `1:4`, reverse `10:1`). Applies in every
 * Depot; no Transaction or Price is changed. At most one split per Security and date. Refused when it
 * would make a SELL in any Depot exceed the held quantity. Nothing is written on failure; one DB
 * transaction.
 */
export async function recordSplit(input: RecordSplitInput, db: LedgerDb = prisma): Promise<SplitResult> {
  const valid = validate(input);
  if (!valid.ok) return valid;
  const securityId = typeof input.securityId === "string" ? input.securityId : "";
  return inTransaction(db, async (tx): Promise<SplitResult> => {
    const security = securityId ? await tx.security.findUnique({ where: { id: securityId }, select: { id: true } }) : null;
    if (!security) return { ok: false, reason: "security-not-found" };
    if (await splitExists(tx, security.id, valid.value.date)) return { ok: false, reason: "split-exists" };
    const before = await loadCorporateActions(tx);
    const after = await loadCorporateActions(tx, {
      add: { type: "SPLIT", securityId: security.id, newSecurityId: null, ...valid.value },
    });
    const holdings = await checkActionHoldings(tx, before, after);
    if (!holdings.ok) return holdings;
    try {
      const row = await tx.corporateAction.create({
        data: { securityId: security.id, type: "SPLIT", ...valid.value },
        include: SPLIT_INCLUDE,
      });
      return { ok: true, split: toRecord(row) };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, reason: "split-exists" };
      throw error;
    }
  });
}

/**
 * Changes date and ratio of split `id` (the Security stays). Validated like `recordSplit`; refused
 * when the change would make a SELL exceed the held quantity. Nothing is written on failure.
 */
export async function updateSplit(id: string, input: UpdateSplitInput, db: LedgerDb = prisma): Promise<SplitResult> {
  return inTransaction(db, async (tx): Promise<SplitResult> => {
    const existing = await tx.corporateAction.findUnique({ where: { id: typeof id === "string" ? id : "" } });
    if (!existing || existing.type !== "SPLIT") return { ok: false, reason: "split-not-found" };
    const valid = validate(input);
    if (!valid.ok) return valid;
    if (await splitExists(tx, existing.securityId, valid.value.date, existing.id)) {
      return { ok: false, reason: "split-exists" };
    }
    const before = await loadCorporateActions(tx);
    const after = await loadCorporateActions(tx, { replace: { id: existing.id, ...valid.value } });
    const holdings = await checkActionHoldings(tx, before, after);
    if (!holdings.ok) return holdings;
    try {
      const row = await tx.corporateAction.update({ where: { id: existing.id }, data: valid.value, include: SPLIT_INCLUDE });
      return { ok: true, split: toRecord(row) };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, reason: "split-exists" };
      throw error;
    }
  });
}

export type DeleteSplitResult =
  | { ok: true; split: SplitRecord }
  | { ok: false; reason: "split-not-found" }
  | SplitLaterSellFailure;

/**
 * Deletes split `id`, unless that makes a SELL in any Depot exceed the held quantity. On success
 * `split` is the deleted row as it was. Nothing is written on failure; one DB transaction.
 */
export async function deleteSplit(id: string, db: LedgerDb = prisma): Promise<DeleteSplitResult> {
  return inTransaction(db, async (tx): Promise<DeleteSplitResult> => {
    const existing = await tx.corporateAction.findUnique({
      where: { id: typeof id === "string" ? id : "" },
      include: SPLIT_INCLUDE,
    });
    if (!existing || existing.type !== "SPLIT") return { ok: false, reason: "split-not-found" };
    const before = await loadCorporateActions(tx);
    const after = await loadCorporateActions(tx, { exclude: existing.id });
    const holdings = await checkActionHoldings(tx, before, after);
    if (!holdings.ok) return holdings;
    await tx.corporateAction.delete({ where: { id: existing.id } });
    return { ok: true, split: toRecord(existing) };
  });
}

/** All recorded splits with their Security, ordered by date. */
export async function listSplits(db: LedgerDb = prisma): Promise<SplitRecord[]> {
  const rows = await db.corporateAction.findMany({
    where: { type: "SPLIT" },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    include: SPLIT_INCLUDE,
  });
  return rows.map(toRecord);
}

/** A recorded ISIN change: `oldQuantity` units of `oldSecurity` became `newQuantity` units of `newSecurity`. */
export type IsinChangeRecord = {
  id: string;
  oldSecurity: SecuritySummary;
  newSecurity: SecuritySummary;
  date: string;
  oldQuantity: string;
  newQuantity: string;
};

export type IsinChangeFailureReason =
  | "security-not-found"
  | "same-security"
  | "date-invalid"
  | "old-quantity-invalid"
  | "new-quantity-invalid"
  | "isin-change-exists"
  | "isin-change-not-found"
  | "later-sell-exceeds-holding"
  | SecurityFailureReason;

export type IsinChangeResult =
  | { ok: true; isinChange: IsinChangeRecord }
  | { ok: false; reason: Exclude<IsinChangeFailureReason, "later-sell-exceeds-holding"> }
  | LaterSellFailure;

export type DeleteIsinChangeResult =
  | { ok: true; isinChange: IsinChangeRecord }
  | { ok: false; reason: "isin-change-not-found" }
  | LaterSellFailure;

/** The new Security: an existing one by id, or one to create (`ensureSecurity`) from ISIN/crypto symbol. */
export type IsinChangeSecurityInput =
  | { id: unknown }
  | { new: { isin: unknown; name: unknown; assetType: unknown } | { cryptoSymbol: unknown; name: unknown; assetType: unknown } };

export type RecordIsinChangeInput = {
  oldSecurityId: unknown;
  newSecurity: IsinChangeSecurityInput;
  date: unknown;
  oldQuantity: unknown;
  newQuantity: unknown;
};

export type UpdateIsinChangeInput = { date: unknown; oldQuantity: unknown; newQuantity: unknown };

/** Same limit as Transaction quantities (`transactions.ts` QUANTITY_MAX_DECIMALS). */
const ISIN_CHANGE_QUANTITY_MAX_DECIMALS = 8;

const ISIN_CHANGE_INCLUDE = {
  security: { select: SECURITY_SELECT },
  newSecurity: { select: SECURITY_SELECT },
} as const;

type ValidIsinChange = { date: string; oldQuantity: string; newQuantity: string };

function parseQuantity(value: unknown): string | null {
  if (!isDecimalString(value)) return null;
  const quantity = new ExactDecimal(value);
  if (!quantity.greaterThan(0) || quantity.decimalPlaces() > ISIN_CHANGE_QUANTITY_MAX_DECIMALS) return null;
  return canonicalDecimal(quantity);
}

function validateIsinChange(
  input: UpdateIsinChangeInput,
): { ok: true; value: ValidIsinChange } | { ok: false; reason: "date-invalid" | "old-quantity-invalid" | "new-quantity-invalid" } {
  if (!isBusinessDate(input.date)) return { ok: false, reason: "date-invalid" };
  const oldQuantity = parseQuantity(input.oldQuantity);
  if (oldQuantity === null) return { ok: false, reason: "old-quantity-invalid" };
  const newQuantity = parseQuantity(input.newQuantity);
  if (newQuantity === null) return { ok: false, reason: "new-quantity-invalid" };
  return { ok: true, value: { date: input.date as string, oldQuantity, newQuantity } };
}

function toIsinChangeRecord(row: {
  id: string;
  date: string;
  ratioOld: string;
  ratioNew: string;
  security: SecuritySummary;
  newSecurity: SecuritySummary | null;
}): IsinChangeRecord {
  return {
    id: row.id,
    oldSecurity: row.security,
    newSecurity: row.newSecurity as SecuritySummary,
    date: row.date,
    oldQuantity: row.ratioOld,
    newQuantity: row.ratioNew,
  };
}

/** True when the old Security already has an ISIN change on `date` (other than `exceptId`). */
async function isinChangeExists(db: LedgerDb, securityId: string, date: string, exceptId?: string): Promise<boolean> {
  const existing = await db.corporateAction.findFirst({
    where: { securityId, type: "ISIN_CHANGE", date, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return existing !== null;
}

/** Placeholder id of a new Security that does not exist yet (it holds nothing, so guards may use it). */
const PENDING_SECURITY_ID = "\uffffpending-security";

/**
 * Records an ISIN change (AD-7): from `date` on, `oldQuantity` units of the old Security are
 * `newQuantity` units of the new one; open FIFO lots move with their original dates and Cost Basis
 * (computed on read; no Transaction is changed). The new Security is an existing one (`{ id }`) or is
 * created via `ensureSecurity` (`{ new }`) inside the same DB transaction, after every check passed.
 * Quantities are decimals > 0 with at most 8 decimal places. At most one ISIN change per old Security
 * and date. Refused when it would make a SELL in any Depot exceed the held quantity. Nothing is written
 * on failure.
 */
export async function recordIsinChange(input: RecordIsinChangeInput, db: LedgerDb = prisma): Promise<IsinChangeResult> {
  const valid = validateIsinChange(input);
  if (!valid.ok) return valid;
  const ref = input.newSecurity;
  let newKey: { id: string } | { new: Extract<ReturnType<typeof validateSecurity>, { ok: true }>["value"] };
  if (ref && typeof ref === "object" && "new" in ref && ref.new && typeof ref.new === "object") {
    const { name, assetType, ...identifier } = ref.new as Record<string, unknown>;
    const security = validateSecurity(
      "isin" in identifier ? { isin: identifier.isin } : { cryptoSymbol: identifier.cryptoSymbol },
      { name, assetType },
    );
    if (!security.ok) return security;
    newKey = { new: security.value };
  } else if (ref && typeof ref === "object" && "id" in ref && typeof ref.id === "string" && ref.id !== "") {
    newKey = { id: ref.id };
  } else {
    return { ok: false, reason: "security-not-found" };
  }
  const oldSecurityId = typeof input.oldSecurityId === "string" ? input.oldSecurityId : "";

  return inTransaction(db, async (tx): Promise<IsinChangeResult> => {
    const old = oldSecurityId ? await tx.security.findUnique({ where: { id: oldSecurityId }, select: { id: true } }) : null;
    if (!old) return { ok: false, reason: "security-not-found" };
    let newSecurityId: string | null;
    if ("id" in newKey) {
      const found = await tx.security.findUnique({ where: { id: newKey.id }, select: { id: true } });
      if (!found) return { ok: false, reason: "security-not-found" };
      newSecurityId = found.id;
    } else {
      newSecurityId = (await findSecurityByKey(newKey.new.key, tx))?.id ?? null;
    }
    if (newSecurityId === old.id) return { ok: false, reason: "same-security" };
    if (await isinChangeExists(tx, old.id, valid.value.date)) return { ok: false, reason: "isin-change-exists" };

    const before = await loadCorporateActions(tx);
    const after = await loadCorporateActions(tx, {
      add: {
        type: "ISIN_CHANGE",
        securityId: old.id,
        newSecurityId: newSecurityId ?? PENDING_SECURITY_ID,
        date: valid.value.date,
        ratioOld: valid.value.oldQuantity,
        ratioNew: valid.value.newQuantity,
      },
    });
    const holdings = await checkActionHoldings(tx, before, after);
    if (!holdings.ok) return holdings;

    if (newSecurityId === null && "new" in newKey) {
      const { key, name, assetType } = newKey.new;
      const created = await ensureSecurity(key, { name, assetType }, tx);
      if (!created.ok) return created;
      newSecurityId = created.security.id;
    }
    try {
      const row = await tx.corporateAction.create({
        data: {
          securityId: old.id,
          newSecurityId,
          type: "ISIN_CHANGE",
          date: valid.value.date,
          ratioOld: valid.value.oldQuantity,
          ratioNew: valid.value.newQuantity,
        },
        include: ISIN_CHANGE_INCLUDE,
      });
      return { ok: true, isinChange: toIsinChangeRecord(row) };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, reason: "isin-change-exists" };
      throw error;
    }
  });
}

/**
 * Changes date and quantities of ISIN change `id` (both Securities stay). Validated like
 * `recordIsinChange`; refused when the change would make a SELL exceed the held quantity. Nothing is
 * written on failure; one DB transaction.
 */
export async function updateIsinChange(
  id: string,
  input: UpdateIsinChangeInput,
  db: LedgerDb = prisma,
): Promise<IsinChangeResult> {
  return inTransaction(db, async (tx): Promise<IsinChangeResult> => {
    const existing = await tx.corporateAction.findUnique({ where: { id: typeof id === "string" ? id : "" } });
    if (!existing || existing.type !== "ISIN_CHANGE") return { ok: false, reason: "isin-change-not-found" };
    const valid = validateIsinChange(input);
    if (!valid.ok) return valid;
    if (await isinChangeExists(tx, existing.securityId, valid.value.date, existing.id)) {
      return { ok: false, reason: "isin-change-exists" };
    }
    const data = { date: valid.value.date, ratioOld: valid.value.oldQuantity, ratioNew: valid.value.newQuantity };
    const before = await loadCorporateActions(tx);
    const after = await loadCorporateActions(tx, { replace: { id: existing.id, ...data } });
    const holdings = await checkActionHoldings(tx, before, after);
    if (!holdings.ok) return holdings;
    try {
      const row = await tx.corporateAction.update({ where: { id: existing.id }, data, include: ISIN_CHANGE_INCLUDE });
      return { ok: true, isinChange: toIsinChangeRecord(row) };
    } catch (error) {
      if (isUniqueViolation(error)) return { ok: false, reason: "isin-change-exists" };
      throw error;
    }
  });
}

/**
 * Deletes ISIN change `id`, unless that makes a SELL in any Depot exceed the held quantity. On success
 * `isinChange` is the deleted row as it was; both Securities stay. Nothing is written on failure.
 */
export async function deleteIsinChange(id: string, db: LedgerDb = prisma): Promise<DeleteIsinChangeResult> {
  return inTransaction(db, async (tx): Promise<DeleteIsinChangeResult> => {
    const existing = await tx.corporateAction.findUnique({
      where: { id: typeof id === "string" ? id : "" },
      include: ISIN_CHANGE_INCLUDE,
    });
    if (!existing || existing.type !== "ISIN_CHANGE") return { ok: false, reason: "isin-change-not-found" };
    const before = await loadCorporateActions(tx);
    const after = await loadCorporateActions(tx, { exclude: existing.id });
    const holdings = await checkActionHoldings(tx, before, after);
    if (!holdings.ok) return holdings;
    await tx.corporateAction.delete({ where: { id: existing.id } });
    return { ok: true, isinChange: toIsinChangeRecord(existing) };
  });
}

/** All recorded ISIN changes with old and new Security, ordered by date. */
export async function listIsinChanges(db: LedgerDb = prisma): Promise<IsinChangeRecord[]> {
  const rows = await db.corporateAction.findMany({
    where: { type: "ISIN_CHANGE" },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    include: ISIN_CHANGE_INCLUDE,
  });
  return rows.map(toIsinChangeRecord);
}
