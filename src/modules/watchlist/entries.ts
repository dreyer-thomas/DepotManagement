import { prisma } from "@/db";
import type { WatchlistEntrySource } from "@/db/generated/prisma/client";
import { currentSecurityId, entryFigures, type EntryFigures, isValidDateAdded, WATCHLIST_NOTE_MAX_LENGTH, watchlistHistoryStart } from "@/core/watchlist";
import {
  ensureSecurity,
  getSecurity,
  listHeldSecurities,
  listSecurities,
  type NewSecurityInput,
  type SecurityFailureReason,
  securityPriceObservations,
  type SecuritySummary,
} from "@/modules/ledger";
import { storedPriceHistory } from "@/modules/prices";
import { inTransaction, isUniqueViolation, type WatchlistDb } from "./watchlists";

export type { WatchlistEntrySource } from "@/db/generated/prisma/client";

export type WatchlistEntryFailureReason =
  | "watchlist-not-found"
  | "security-not-found"
  | "not-found"
  | "already-on-list"
  | "note-too-long"
  | "date-invalid"
  | SecurityFailureReason;

/** A stored entry (no figures). */
export type WatchlistEntryRecord = {
  id: string;
  watchlistId: string;
  securityId: string;
  note: string;
  dateAdded: string;
  position: number;
  source: WatchlistEntrySource;
  clientName: string | null;
};

export type AddWatchlistEntryInput = {
  watchlistId: unknown;
  /** An existing Security, or a new one created through `ledger.ensureSecurity` in the same DB transaction. */
  security: { id: unknown } | { new: NewSecurityInput };
  note?: unknown;
  /** Business date `YYYY-MM-DD`, ≤ today; absent or empty = today. */
  dateAdded?: unknown;
};

export type AddWatchlistEntryResult =
  | { ok: true; entry: WatchlistEntryRecord; security: SecuritySummary }
  | { ok: false; reason: WatchlistEntryFailureReason };

/** Each field absent (undefined) keeps the stored value. */
export type UpdateWatchlistEntryInput = { note?: unknown; dateAdded?: unknown; watchlistId?: unknown };

export type UpdateWatchlistEntryResult =
  | { ok: true; entry: WatchlistEntryRecord; previousDateAdded: string }
  | { ok: false; reason: WatchlistEntryFailureReason };

export type RemoveWatchlistEntryResult = { ok: true } | { ok: false; reason: "not-found" };

const ENTRY_SELECT = {
  id: true,
  watchlistId: true,
  securityId: true,
  note: true,
  dateAdded: true,
  position: true,
  source: true,
  clientName: true,
} as const;

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: WatchlistEntryFailureReason };

function parseNote(value: unknown): Parsed<string> {
  if (value === undefined || value === null) return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false, reason: "note-too-long" };
  const note = value.normalize("NFC").trim();
  return note.length > WATCHLIST_NOTE_MAX_LENGTH ? { ok: false, reason: "note-too-long" } : { ok: true, value: note };
}

function parseDateAdded(value: unknown, today: string, emptyIsToday: boolean): Parsed<string> {
  if (emptyIsToday && (value === undefined || value === null || value === "")) return { ok: true, value: today };
  return isValidDateAdded(value, today) ? { ok: true, value } : { ok: false, reason: "date-invalid" };
}

async function nextPosition(db: WatchlistDb, watchlistId: string): Promise<number> {
  const last = await db.watchlistEntry.findFirst({ where: { watchlistId }, orderBy: { position: "desc" }, select: { position: true } });
  return (last?.position ?? 0) + 1;
}

async function isOnList(db: WatchlistDb, watchlistId: string, securityId: string): Promise<boolean> {
  return (await db.watchlistEntry.findUnique({ where: { watchlistId_securityId: { watchlistId, securityId } }, select: { id: true } })) !== null;
}

async function resolveSecurity(
  security: AddWatchlistEntryInput["security"],
  db: WatchlistDb,
): Promise<{ ok: true; security: SecuritySummary } | { ok: false; reason: WatchlistEntryFailureReason }> {
  if (security && typeof security === "object" && "new" in security && security.new) {
    const input = security.new;
    const identifier = "isin" in input ? { isin: input.isin } : { cryptoSymbol: input.cryptoSymbol };
    return ensureSecurity(identifier, { name: input.name, assetType: input.assetType }, db);
  }
  const id = security && typeof security === "object" && "id" in security ? security.id : undefined;
  const found = typeof id === "string" && id !== "" ? await getSecurity(id, db) : null;
  return found ? { ok: true, security: found } : { ok: false, reason: "security-not-found" };
}

/**
 * Adds a Security to a watchlist (at its end). A new Security is created only through
 * `ledger.ensureSecurity`, in the same DB transaction as the entry (a refused entry creates nothing).
 * A Security is at most once per list (`already-on-list`).
 */
export async function addWatchlistEntry(
  input: AddWatchlistEntryInput,
  today: string,
  db: WatchlistDb = prisma,
  now: () => Date = () => new Date(),
): Promise<AddWatchlistEntryResult> {
  const note = parseNote(input.note);
  if (!note.ok) return note;
  const dateAdded = parseDateAdded(input.dateAdded, today, true);
  if (!dateAdded.ok) return dateAdded;
  const watchlistId = typeof input.watchlistId === "string" ? input.watchlistId : "";
  try {
    return await inTransaction(db, async (tx): Promise<AddWatchlistEntryResult> => {
      const list = watchlistId ? await tx.watchlist.findUnique({ where: { id: watchlistId }, select: { id: true } }) : null;
      if (!list) return { ok: false, reason: "watchlist-not-found" };
      // `ensureSecurity` validates before it writes, so a refusal here leaves nothing behind; a Security it
      // just created cannot be on the list yet, so `already-on-list` only ever concerns an existing one.
      const security = await resolveSecurity(input.security, tx);
      if (!security.ok) return security;
      if (await isOnList(tx, list.id, security.security.id)) return { ok: false, reason: "already-on-list" };
      const entry = await tx.watchlistEntry.create({
        data: {
          watchlistId: list.id,
          securityId: security.security.id,
          note: note.value,
          dateAdded: dateAdded.value,
          position: await nextPosition(tx, list.id),
          source: "APP",
          createdAt: now().toISOString(),
        },
        select: ENTRY_SELECT,
      });
      return { ok: true, entry, security: security.security };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "already-on-list" };
    throw error;
  }
}

/**
 * Changes an entry's note and date added and/or moves it to another list (at that list's end; refused
 * with `already-on-list` when the Security is there already). The Security and its Prices stay.
 */
export async function updateWatchlistEntry(
  id: unknown,
  input: UpdateWatchlistEntryInput,
  today: string,
  db: WatchlistDb = prisma,
): Promise<UpdateWatchlistEntryResult> {
  const note = input.note === undefined ? null : parseNote(input.note);
  if (note && !note.ok) return note;
  const dateAdded = input.dateAdded === undefined ? null : parseDateAdded(input.dateAdded, today, false);
  if (dateAdded && !dateAdded.ok) return dateAdded;
  if (typeof id !== "string" || id === "") return { ok: false, reason: "not-found" };
  try {
    return await inTransaction(db, async (tx): Promise<UpdateWatchlistEntryResult> => {
      const current = await tx.watchlistEntry.findUnique({ where: { id }, select: ENTRY_SELECT });
      if (!current) return { ok: false, reason: "not-found" };
      const data: { note?: string; dateAdded?: string; watchlistId?: string; position?: number } = {};
      if (note) data.note = note.value;
      if (dateAdded) data.dateAdded = dateAdded.value;
      if (input.watchlistId !== undefined && input.watchlistId !== current.watchlistId) {
        const targetId = typeof input.watchlistId === "string" ? input.watchlistId : "";
        const target = targetId ? await tx.watchlist.findUnique({ where: { id: targetId }, select: { id: true } }) : null;
        if (!target) return { ok: false, reason: "watchlist-not-found" };
        if (await isOnList(tx, target.id, current.securityId)) return { ok: false, reason: "already-on-list" };
        data.watchlistId = target.id;
        data.position = await nextPosition(tx, target.id);
      }
      const entry = await tx.watchlistEntry.update({ where: { id }, data, select: ENTRY_SELECT });
      return { ok: true, entry, previousDateAdded: current.dateAdded };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "already-on-list" };
    throw error;
  }
}

/** Removes an entry; the Security and its Prices stay. */
export async function removeWatchlistEntry(id: unknown, db: WatchlistDb = prisma): Promise<RemoveWatchlistEntryResult> {
  if (typeof id !== "string" || id === "") return { ok: false, reason: "not-found" };
  const { count } = await db.watchlistEntry.deleteMany({ where: { id } });
  return count === 0 ? { ok: false, reason: "not-found" } : { ok: true };
}

/** An entry as the watchlist surface shows it: Security, figures computed on read, held flag. */
export type WatchlistEntryView = WatchlistEntryRecord &
  EntryFigures & {
    security: SecuritySummary;
    /** True when the Security is held (`listHeldSecurities`): the "im Bestand" chip. */
    held: boolean;
  };

export type WatchlistView = { id: string; name: string; position: number; entries: WatchlistEntryView[] };

/**
 * Every watchlist in creation order with its entries (by position) and their figures as of `today`:
 * resolved Price (stored Prices and Transaction prices, split-adjusted), stale flag, change today and
 * change since added (`core/watchlist`). Read-only, no provider call.
 */
export async function watchlistView(today: string, db: WatchlistDb = prisma): Promise<WatchlistView[]> {
  const lists = await db.watchlist.findMany({
    orderBy: { position: "asc" },
    select: { id: true, name: true, position: true, entries: { select: ENTRY_SELECT, orderBy: { position: "asc" } } },
  });
  const securityIds = [...new Set(lists.flatMap((list) => list.entries.map((entry) => entry.securityId)))];
  if (securityIds.length === 0) return lists.map((list) => ({ ...list, entries: [] }));
  const [securities, held, { observations, actions }] = await Promise.all([
    listSecurities(db),
    listHeldSecurities(today, db),
    securityPriceObservations(securityIds, today, { storedPrices: (ids, asOf) => storedPriceHistory(ids, asOf, db) }, db),
  ]);
  const byId = new Map(securities.map((security) => [security.id, security]));
  const heldSet = new Set(held);
  return lists.map((list) => ({
    id: list.id,
    name: list.name,
    position: list.position,
    entries: list.entries.flatMap((entry) => {
      const security = byId.get(entry.securityId);
      if (!security) return [];
      return [
        {
          ...entry,
          ...entryFigures(observations, entry.securityId, actions, entry.dateAdded, today),
          security,
          // Held when the Security it maps to today (its ISIN-change successor, if any) is held.
          held: heldSet.has(currentSecurityId(entry.securityId, actions, today)),
        },
      ];
    }),
  }));
}

/**
 * Price targets of watched Securities for the `prices` module (wired in by the app layer): per Security
 * on any list the first date of its price history, `watchlistHistoryStart(earliest date added, today)`.
 */
export async function watchlistPriceTargets(today: string, db: WatchlistDb = prisma): Promise<ReadonlyMap<string, string>> {
  const entries = await db.watchlistEntry.findMany({ select: { securityId: true, dateAdded: true } });
  const earliest = new Map<string, string>();
  for (const { securityId, dateAdded } of entries) {
    const current = earliest.get(securityId);
    if (current === undefined || dateAdded < current) earliest.set(securityId, dateAdded);
  }
  return new Map([...earliest].map(([securityId, date]) => [securityId, watchlistHistoryStart(date, today)]));
}

/** An entry of one Security as its detail page shows it (story 9.2): list, note, date added, change since added. */
export type SecurityWatchlistEntry = {
  id: string;
  watchlistId: string;
  watchlistName: string;
  note: string;
  dateAdded: string;
  source: WatchlistEntrySource;
  clientName: string | null;
  /** Change since the date added (`entryFigures`); `null` without a Price. */
  sinceAdded: string | null;
};

/**
 * The entries of `securityId` on every watchlist, in list order, with the change since added as of
 * `today` (as `watchlistView`). Empty when the Security is on no list. Read-only, no provider call.
 */
export async function securityWatchlistEntries(
  securityId: string,
  today: string,
  db: WatchlistDb = prisma,
): Promise<SecurityWatchlistEntry[]> {
  const entries = await db.watchlistEntry.findMany({
    where: { securityId },
    select: { ...ENTRY_SELECT, watchlist: { select: { name: true, position: true } } },
  });
  if (entries.length === 0) return [];
  const { observations, actions } = await securityPriceObservations(
    [securityId],
    today,
    { storedPrices: (ids, asOf) => storedPriceHistory(ids, asOf, db) },
    db,
  );
  return entries
    .sort((a, b) => a.watchlist.position - b.watchlist.position)
    .map((entry) => ({
      id: entry.id,
      watchlistId: entry.watchlistId,
      watchlistName: entry.watchlist.name,
      note: entry.note,
      dateAdded: entry.dateAdded,
      source: entry.source,
      clientName: entry.clientName,
      sinceAdded: entryFigures(observations, securityId, actions, entry.dateAdded, today).sinceAdded,
    }));
}

/** Distinct Security ids on any watchlist: the watched part of the news set (injected into `news`). */
export async function watchedSecurityIds(db: WatchlistDb = prisma): Promise<string[]> {
  const rows = await db.watchlistEntry.findMany({ distinct: ["securityId"], select: { securityId: true } });
  return rows.map((row) => row.securityId);
}
