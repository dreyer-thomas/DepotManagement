import { z } from "zod";
import { prisma } from "@/db";
import { Prisma } from "@/db/generated/prisma/client";
import { parseSplitRatio, type Split } from "@/core/corporate-actions";
import { isBusinessDate } from "@/core/dates";
import { firstOversell, type TradeRow } from "@/core/holdings";
import { inTransaction, type LedgerDb } from "./depots";
import type { SecuritySummary } from "./securities";

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
export type SplitLaterSellFailure = { ok: false; reason: "later-sell-exceeds-holding"; date: string };

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

/**
 * The recorded splits as core `Split`s, all or only those of `securityIds`. For the ledger's own
 * reads and guards.
 */
export async function loadSplits(db: LedgerDb, securityIds?: readonly string[]): Promise<Split[]> {
  if (securityIds && securityIds.length === 0) return [];
  return db.corporateAction.findMany({
    where: { type: "SPLIT", ...(securityIds ? { securityId: { in: [...securityIds] } } : {}) },
    select: { securityId: true, date: true, ratioOld: true, ratioNew: true },
  });
}

/** True when the Security already has a split on `date` (other than `exceptId`). */
async function splitExists(db: LedgerDb, securityId: string, date: string, exceptId?: string): Promise<boolean> {
  const existing = await db.corporateAction.findFirst({
    where: { securityId, type: "SPLIT", date, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Oversell guard across every Depot holding the Security: refused when, with the split set `after`,
 * a SELL exceeds the then-held quantity where it did not with `before`.
 */
async function checkHoldings(
  db: LedgerDb,
  securityId: string,
  before: readonly Split[],
  after: readonly Split[],
): Promise<{ ok: true } | SplitLaterSellFailure> {
  const trades = await db.transaction.findMany({
    where: { securityId, type: { in: ["BUY", "SELL"] } },
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
    const oversell = firstOversell(rows, securityId, after);
    if (oversell && !firstOversell(rows, securityId, before)) {
      if (earliest === null || oversell.date < earliest) earliest = oversell.date;
    }
  }
  return earliest === null ? { ok: true } : { ok: false, reason: "later-sell-exceeds-holding", date: earliest };
}

type StoredSplit = Split & { id: string };

/** The Security's recorded splits with their ids. */
async function storedSplits(db: LedgerDb, securityId: string): Promise<StoredSplit[]> {
  return db.corporateAction.findMany({
    where: { type: "SPLIT", securityId },
    select: { id: true, securityId: true, date: true, ratioOld: true, ratioNew: true },
  });
}

function toSplit({ securityId, date, ratioOld, ratioNew }: Split): Split {
  return { securityId, date, ratioOld, ratioNew };
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
    const before = await loadSplits(tx, [security.id]);
    const holdings = await checkHoldings(tx, security.id, before, [...before, { securityId: security.id, ...valid.value }]);
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
    const all = await storedSplits(tx, existing.securityId);
    const before = all.map(toSplit);
    const after = all.map((split) =>
      split.id === existing.id ? { securityId: split.securityId, ...valid.value } : toSplit(split),
    );
    const holdings = await checkHoldings(tx, existing.securityId, before, after);
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
    const all = await storedSplits(tx, existing.securityId);
    const before = all.map(toSplit);
    const after = all.filter((split) => split.id !== existing.id).map(toSplit);
    const holdings = await checkHoldings(tx, existing.securityId, before, after);
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
