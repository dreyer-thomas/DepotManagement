// Synthetic full ledger for the backup tests (stories 6.1 and 6.2). Anonymised data only.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/db/generated/prisma/client";

export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
export const TS = "2026-10-26T10:00:00.000Z";

/** Writes the synthetic PNG as `<dataDir>/logos/<fileName>`. */
export function writeLogo(dataDir: string, fileName: string): void {
  mkdirSync(join(dataDir, "logos"), { recursive: true });
  writeFileSync(join(dataDir, "logos", fileName), PNG);
}

/** Synthetic full ledger; rows are inserted out of sort order with non-canonical decimals. */
export async function seedFullLedger(c: PrismaClient, dataDir: string): Promise<void> {
  await c.depot.create({ data: { id: "depot-b", name: "Zweitdepot", broker: "FINANZEN_ZERO", archived: true } });
  await c.depot.create({ data: { id: "depot-a", name: "Hauptdepot", broker: "COMDIRECT" } });
  await c.security.create({ data: { id: "sec-c", cryptoSymbol: "BTC", name: "Bitcoin", assetType: "CRYPTO" } });
  await c.security.create({ data: { id: "sec-b", isin: "DE000SYNCB08", name: "Synthetic Beta AG", assetType: "STOCK" } });
  await c.security.create({ data: { id: "sec-a", isin: "DE000SYNCA09", name: "Synthetic Alpha AG", assetType: "ETF" } });
  const tx = (id: string, depotId: string, date: string, sequence: number, extra: Record<string, unknown>) =>
    c.transaction.create({ data: { id, depotId, date, sequence, amount: "0", fee: "0", tax: "0", type: "DEPOSIT", ...extra } as never });
  await tx("t-5", "depot-b", "2026-01-01", 0, { amount: "100.00" });
  await tx("t-4", "depot-a", "2026-03-01", 0, { type: "ADJUSTMENT", securityId: "sec-a", quantity: "-0.50", price: null, note: "Kontoabgleich" });
  await tx("t-3", "depot-a", "2026-02-01", 1, { type: "SELL", securityId: "sec-a", quantity: "1.0", price: "12.3400", amount: "12.34", fee: "1.00", tax: "0.10" });
  await tx("t-2", "depot-a", "2026-02-01", 0, { type: "BUY", securityId: "sec-a", quantity: "1.50000", price: "10.00", amount: "15.00", fee: "0.99", note: "erste Notiz" });
  await tx("t-1", "depot-a", "2026-01-15", 0, { amount: "1000.00" });
  await c.corporateAction.create({ data: { id: "ca-2", securityId: "sec-b", newSecurityId: "sec-a", type: "ISIN_CHANGE", date: "2026-04-01", ratioOld: "2.0", ratioNew: "1" } });
  await c.corporateAction.create({ data: { id: "ca-1", securityId: "sec-a", type: "SPLIT", date: "2026-05-01", ratioOld: "1", ratioNew: "4" } });
  await c.reconciliationRun.create({
    data: {
      id: "run-1",
      depotId: "depot-a",
      statementDate: "2026-06-30",
      status: "FINISHED",
      createdAt: TS,
      finishedAt: "2026-10-26T11:00:00.000Z",
      rows: {
        create: [
          { id: "row-2", securityId: "sec-a", statementValue: "4.00", checked: true },
          { id: "row-1", securityId: null, statementValue: "987.6500", checked: false },
        ],
      },
    },
  });
  await c.providerMapping.create({
    data: { id: "map-a", securityId: "sec-a", provider: "YAHOO", symbol: "SYA.DE", origin: "AUTO", updatedAt: TS, historyFrom: "2026-01-15", fetchedAt: TS },
  });
  await c.providerMapping.create({ data: { id: "map-b", securityId: "sec-b", origin: "AUTO", updatedAt: TS, fetchError: "not-found" } });
  await c.price.create({ data: { id: "p-3", securityId: "sec-a", date: "2026-02-02", source: "PROVIDER", price: "11.2000", fetchedAt: TS } });
  await c.price.create({ data: { id: "p-2", securityId: "sec-a", date: "2026-02-01", source: "PROVIDER", price: "10.1", fetchedAt: TS } });
  await c.price.create({ data: { id: "p-1", securityId: "sec-a", date: "2026-02-01", source: "MANUAL", price: "10.50", fetchedAt: TS } });
  writeLogo(dataDir, "sec-b-1.png");
  await c.securityLogo.create({ data: { id: "logo-b", securityId: "sec-b", source: "MANUAL", fileName: "sec-b-1.png", contentType: "image/png", fetchedAt: TS } });
  // Classification: manual overrides of sec-b (exported); sec-a has automatic values and a rule split (a cache, not
  // exported) plus a manual region split (exported).
  await c.securityClassification.create({
    data: {
      id: "cls-b",
      securityId: "sec-b",
      assetClass: "Aktien",
      assetClassSource: "RULE",
      sector: "Technologie",
      sectorSource: "PROVIDER",
      sectorManual: "Halbleiter",
      regionManual: "Europa",
      currencyManual: "EUR",
      providerSymbol: "SYB.DE",
      providerFetchedAt: TS,
      updatedAt: TS,
    },
  });
  await c.securityClassification.create({
    data: {
      id: "cls-a",
      securityId: "sec-a",
      assetClass: "Aktien",
      assetClassSource: "RULE",
      region: "Welt",
      regionSource: "RULE",
      // Rule split (a cache, not exported) and a manual region split (story 8.4, exported).
      regionSplit: '{"USA":"72","Europa":"15","Japan":"6","Pazifik ohne Japan":"4","Sonstige":"3"}',
      regionSplitSource: "RULE",
      regionSplitAsOf: "2026-09-30",
      regionSplitIndex: "MSCI World",
      regionSplitManual: '{"USA":"60","Europa":"37.5","Sonstige":"2.5"}',
      updatedAt: TS,
    },
  });
  // Tax settings (story 8.3): Freistellungsaufträge and a Teilfreistellung override.
  await c.taxAllowance.create({ data: { id: "fsa-2", broker: "FINANZEN_ZERO", year: 2026, amount: "199", updatedAt: TS } });
  await c.taxAllowance.create({ data: { id: "fsa-1", broker: "COMDIRECT", year: 2026, amount: "801", updatedAt: TS } });
  await c.teilfreistellungOverride.create({ data: { id: "tfs-a", securityId: "sec-a", rate: "0.15", updatedAt: TS } });
  // Target allocations (story 8.5): the Portfolio and a Depot (exported); a deleted Depot's row (not exported).
  await c.targetAllocation.create({ data: { id: "ta-p", scope: "portfolio", weights: '{"equityUsa":"60","bonds":"37.5","cash":"2.5"}', threshold: "2", updatedAt: TS } });
  await c.targetAllocation.create({ data: { id: "ta-a", scope: "depot-a", weights: '{"cash":"100"}', threshold: "0.5", updatedAt: TS } });
  await c.targetAllocation.create({ data: { id: "ta-x", scope: "gone-depot", weights: '{"cash":"100"}', threshold: "2", updatedAt: TS } });
}

/**
 * Watchlists (story 9.3) on top of `seedFullLedger`: two lists inserted out of position order, a watchlist-only
 * Security `sec-d` with its Price, an MCP entry with a client name and entries out of position order.
 */
export async function seedWatchlists(c: PrismaClient): Promise<void> {
  await c.security.create({ data: { id: "sec-d", isin: "DE000SYNCD06", name: "Synthetic Delta AG", assetType: "STOCK" } });
  await c.price.create({ data: { id: "p-d", securityId: "sec-d", date: "2026-10-20", source: "PROVIDER", price: "42.10", fetchedAt: TS } });
  await c.watchlist.create({ data: { id: "wl-2", name: "Dividenden", position: 3, createdAt: "2026-10-02T08:00:00.000Z" } });
  await c.watchlist.create({ data: { id: "wl-1", name: "Ideen", position: 1, createdAt: TS } });
  await c.watchlistEntry.create({
    data: { id: "we-3", watchlistId: "wl-1", securityId: "sec-d", note: "Idee aus der Recherche", dateAdded: "2026-10-01", position: 2, source: "MCP", clientName: "Claude", createdAt: TS },
  });
  await c.watchlistEntry.create({
    data: { id: "we-2", watchlistId: "wl-1", securityId: "sec-a", note: "", dateAdded: "2026-09-15", position: 1, createdAt: TS },
  });
  await c.watchlistEntry.create({
    data: { id: "we-1", watchlistId: "wl-2", securityId: "sec-d", note: "Dividende prüfen", dateAdded: "2026-10-05", position: 1, createdAt: TS },
  });
}
