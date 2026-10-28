import { z } from "zod";
import { prisma } from "@/db";
import { Prisma } from "@/db/generated/prisma/client";
import { WATCHLIST_NAME_MAX_LENGTH } from "@/core/watchlist";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type WatchlistDb = Prisma.TransactionClient;

export type WatchlistSummary = {
  id: string;
  name: string;
  /** Creation order (max + 1); lists are shown in this order. */
  position: number;
  /** Number of entries on the list. */
  entryCount: number;
};

export type WatchlistFailureReason = "name-empty" | "name-too-long" | "name-taken" | "not-found";

export type WatchlistResult = { ok: true; watchlist: WatchlistSummary } | { ok: false; reason: WatchlistFailureReason };

export type DeleteWatchlistResult = { ok: true; deleted: { entries: number } } | { ok: false; reason: "not-found" };

export const watchlistNameSchema = z
  .string({ error: "name-empty" })
  .normalize("NFC")
  .trim()
  .min(1, { error: "name-empty" })
  .max(WATCHLIST_NAME_MAX_LENGTH, { error: "name-too-long" });

/** Runs `write` in one DB transaction: its own, unless `db` already is one. */
export async function inTransaction<T>(db: WatchlistDb, write: (tx: WatchlistDb) => Promise<T>): Promise<T> {
  const client = db as WatchlistDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") return client.$transaction((tx) => write(tx));
  return write(db);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function nameKey(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("de-DE");
}

/** True when another list (other than `exceptId`) already has this name, ignoring case. */
async function isNameTaken(db: WatchlistDb, name: string, exceptId?: string): Promise<boolean> {
  const key = nameKey(name);
  const existing = await db.watchlist.findMany({ select: { id: true, name: true } });
  return existing.some((list) => list.id !== exceptId && nameKey(list.name) === key);
}

function parseName(value: unknown): { ok: true; value: string } | { ok: false; reason: WatchlistFailureReason } {
  const result = watchlistNameSchema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, reason: result.error.issues[0].message as WatchlistFailureReason };
}

const SUMMARY_SELECT = { id: true, name: true, position: true, _count: { select: { entries: true } } } as const;

function toSummary(row: { id: string; name: string; position: number; _count: { entries: number } }): WatchlistSummary {
  return { id: row.id, name: row.name, position: row.position, entryCount: row._count.entries };
}

/** Every watchlist in creation order, with its entry count. */
export async function listWatchlists(db: WatchlistDb = prisma): Promise<WatchlistSummary[]> {
  const rows = await db.watchlist.findMany({ select: SUMMARY_SELECT, orderBy: { position: "asc" } });
  return rows.map(toSummary);
}

/** One watchlist, or null when the id is unknown. */
export async function getWatchlist(id: string, db: WatchlistDb = prisma): Promise<WatchlistSummary | null> {
  const row = await db.watchlist.findUnique({ where: { id }, select: SUMMARY_SELECT });
  return row ? toSummary(row) : null;
}

/** Creates a watchlist at the end; the name is trimmed (NFC) and must be unique (case-insensitive). */
export async function createWatchlist(
  input: { name: unknown },
  db: WatchlistDb = prisma,
  now: () => Date = () => new Date(),
): Promise<WatchlistResult> {
  const name = parseName(input.name);
  if (!name.ok) return name;
  try {
    return await inTransaction(db, async (tx): Promise<WatchlistResult> => {
      if (await isNameTaken(tx, name.value)) return { ok: false, reason: "name-taken" };
      const last = await tx.watchlist.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
      const row = await tx.watchlist.create({
        data: { name: name.value, position: (last?.position ?? 0) + 1, createdAt: now().toISOString() },
        select: SUMMARY_SELECT,
      });
      return { ok: true, watchlist: toSummary(row) };
    });
  } catch (error) {
    if (isUniqueViolation(error) && (await isNameTaken(db, name.value))) return { ok: false, reason: "name-taken" };
    throw error;
  }
}

/** Renames a watchlist; renaming to its own name in any case is allowed. */
export async function renameWatchlist(id: unknown, input: { name: unknown }, db: WatchlistDb = prisma): Promise<WatchlistResult> {
  const name = parseName(input.name);
  if (!name.ok) return name;
  if (typeof id !== "string" || id === "") return { ok: false, reason: "not-found" };
  try {
    return await inTransaction(db, async (tx): Promise<WatchlistResult> => {
      if (!(await tx.watchlist.findUnique({ where: { id }, select: { id: true } }))) return { ok: false, reason: "not-found" };
      if (await isNameTaken(tx, name.value, id)) return { ok: false, reason: "name-taken" };
      const row = await tx.watchlist.update({ where: { id }, data: { name: name.value }, select: SUMMARY_SELECT });
      return { ok: true, watchlist: toSummary(row) };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "name-taken" };
    throw error;
  }
}

/** Deletes a watchlist with its entries; Securities and their Prices stay. Returns the deleted entry count. */
export async function deleteWatchlist(id: unknown, db: WatchlistDb = prisma): Promise<DeleteWatchlistResult> {
  if (typeof id !== "string" || id === "") return { ok: false, reason: "not-found" };
  return inTransaction(db, async (tx): Promise<DeleteWatchlistResult> => {
    if (!(await tx.watchlist.findUnique({ where: { id }, select: { id: true } }))) return { ok: false, reason: "not-found" };
    const { count } = await tx.watchlistEntry.deleteMany({ where: { watchlistId: id } });
    await tx.watchlist.delete({ where: { id } });
    return { ok: true, deleted: { entries: count } };
  });
}
