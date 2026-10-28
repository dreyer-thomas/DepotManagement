// Export reader and restore writer of the watchlists (AD-12, story 9.3): lists with their entries are user
// data and travel with the export. Stored strings are kept verbatim; entries reference Securities only by id,
// so the restore writes them after the ledger. OAuth data is never part of it (connected apps reconnect).
import type { WatchlistEntrySource } from "./entries";
import type { WatchlistDb } from "./watchlists";

export type WatchlistEntryExport = {
  id: string;
  securityId: string;
  note: string;
  dateAdded: string;
  position: number;
  source: WatchlistEntrySource;
  clientName: string | null;
  createdAt: string;
};

export type WatchlistExport = { id: string; name: string; position: number; createdAt: string; entries: WatchlistEntryExport[] };

/** Every watchlist sorted by position, its entries by position then id. */
export async function exportWatchlists(db: WatchlistDb): Promise<WatchlistExport[]> {
  const rows = await db.watchlist.findMany({
    select: {
      id: true,
      name: true,
      position: true,
      createdAt: true,
      entries: {
        select: { id: true, securityId: true, note: true, dateAdded: true, position: true, source: true, clientName: true, createdAt: true },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      },
    },
    orderBy: { position: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    createdAt: row.createdAt,
    entries: row.entries.map((entry) => ({
      id: entry.id,
      securityId: entry.securityId,
      note: entry.note,
      dateAdded: entry.dateAdded,
      position: entry.position,
      source: entry.source,
      clientName: entry.clientName,
      createdAt: entry.createdAt,
    })),
  }));
}

/**
 * Deletes every watchlist entry and list and creates the given (validated, consistent) records with their ids.
 * Must run after the ledger restore: entries reference the restored Securities.
 */
export async function replaceAllWatchlists(records: readonly WatchlistExport[], db: WatchlistDb): Promise<void> {
  await db.watchlistEntry.deleteMany();
  await db.watchlist.deleteMany();
  if (records.length === 0) return;
  await db.watchlist.createMany({
    data: records.map((record) => ({ id: record.id, name: record.name, position: record.position, createdAt: record.createdAt })),
  });
  const entries = records.flatMap((record) =>
    record.entries.map((entry) => ({
      id: entry.id,
      watchlistId: record.id,
      securityId: entry.securityId,
      note: entry.note,
      dateAdded: entry.dateAdded,
      position: entry.position,
      source: entry.source,
      clientName: entry.clientName,
      createdAt: entry.createdAt,
    })),
  );
  if (entries.length > 0) await db.watchlistEntry.createMany({ data: entries });
}
