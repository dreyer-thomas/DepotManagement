import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PNG, seedFullLedger, TS, writeLogo } from "../../../test/helpers/backup-seed";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import type { PrismaClient } from "@/db/generated/prisma/client";
import { depotValuation, listDepots, listPositions, portfolioValuation } from "@/modules/ledger";
import { storedPriceHistory } from "@/modules/prices";
import { backupDir, createExport, exportFileName, RESTORE_MAX_FILE_BYTES, restoreExport, serializeExport } from "./index";

const NOW = new Date("2026-10-26T12:00:00Z");
const BACKUP_NAME = exportFileName(NOW);
const TODAY = "2026-10-26";
const MAX = { kind: "preset", preset: "MAX" } as const;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

type Instance = { testDb: TestDatabase; dataDir: string; backupDir: string };

let source: Instance;
let target: Instance;
const scratch: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

function instance(): Instance {
  return { testDb: createTestDatabase(), dataDir: tempDir("depot-restore-data-"), backupDir: join(tempDir("depot-restore-backup-"), "backups") };
}

const env = (i: Instance) => ({ DATA_DIR: i.dataDir, BACKUP_DIR: i.backupDir });
const exportOf = async (i: Instance) => serializeExport(await createExport({ env: env(i) }, i.testDb.client));
const restoreInto = (i: Instance, text: string) => restoreExport(text, { env: env(i), now: () => NOW }, i.testDb.client);

/** Every file below `dir` (relative path → content as base64); a missing dir is empty. */
function filesBelow(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(dir, path)] = readFileSync(path).toString("base64");
    }
  };
  walk(dir);
  return files;
}

/** Everything a restore may change: the full export, staging and news rows, data files and backups. */
async function snapshot(i: Instance) {
  const c = i.testDb.client;
  return {
    export: await exportOf(i),
    logoRows: await c.securityLogo.findMany({ orderBy: { securityId: "asc" } }),
    batches: await c.importBatch.count(),
    items: await c.importItem.count(),
    news: await c.newsArticle.count(),
    newsFetches: await c.newsFetch.count(),
    data: filesBelow(i.dataDir),
  };
}

/** The target's prior state: other data, an OPEN import batch with a PDF, news and a fetched logo. */
async function seedOtherData(i: Instance): Promise<void> {
  const c = i.testDb.client;
  await c.depot.create({ data: { id: "other-depot", name: "Altdepot", broker: "DEUTSCHE_BANK" } });
  await c.security.create({ data: { id: "other-sec", isin: "DE000SYNCZ00", name: "Synthetic Zeta AG", assetType: "STOCK" } });
  await c.transaction.create({
    data: { id: "other-t", depotId: "other-depot", securityId: "other-sec", type: "BUY", date: "2025-05-05", sequence: 0, quantity: "3", price: "7", amount: "21", fee: "0", tax: "0" },
  });
  await c.price.create({ data: { securityId: "other-sec", date: "2025-05-06", source: "MANUAL", price: "8", fetchedAt: TS } });
  writeLogo(i.dataDir, "other-sec-5.png");
  await c.securityLogo.create({
    data: { securityId: "other-sec", source: "FETCHED", provider: "LOGO_DEV", fileName: "other-sec-5.png", contentType: "image/png", fetchedAt: TS },
  });
  await c.newsArticle.create({
    data: { securityId: "other-sec", url: "https://example.test/n", title: "Titel", source: "Quelle", publishedAt: TS, provider: "YAHOO", fetchedAt: TS },
  });
  await c.newsFetch.create({ data: { securityId: "other-sec", fetchedAt: TS } });
  await c.taxAllowance.create({ data: { id: "other-fsa", broker: "DEUTSCHE_BANK", year: 2025, amount: "500", updatedAt: TS } });
  await c.teilfreistellungOverride.create({ data: { id: "other-tfs", securityId: "other-sec", rate: "0.6", updatedAt: TS } });
  await c.targetAllocation.create({ data: { id: "other-ta", scope: "other-depot", weights: '{"bonds":"100"}', threshold: "2", updatedAt: TS } });
  const batch = await c.importBatch.create({
    data: {
      id: "batch1",
      depotId: "other-depot",
      createdAt: TS,
      items: { create: [{ id: "item1", position: 0, fileName: "beleg.pdf", fileHash: "abc", status: "PARSED", storedFile: "item1.pdf" }] },
    },
  });
  mkdirSync(join(i.dataDir, "imports", batch.id), { recursive: true });
  writeFileSync(join(i.dataDir, "imports", batch.id, "item1.pdf"), "%PDF-1.4 synthetic");
}

/** Adds prices on several dates so the valuation series resolves stored prices day by day. */
async function seedMorePrices(c: PrismaClient): Promise<void> {
  await c.price.create({ data: { id: "p-4", securityId: "sec-a", date: "2026-03-15", source: "PROVIDER", price: "13.05", fetchedAt: TS } });
  await c.price.create({ data: { id: "p-5", securityId: "sec-a", date: "2026-06-30", source: "PROVIDER", price: "14.000", fetchedAt: TS } });
  await c.price.create({ data: { id: "p-6", securityId: "sec-a", date: "2026-09-01", source: "MANUAL", price: "15.5", fetchedAt: TS } });
  await c.price.create({ data: { id: "p-7", securityId: "sec-c", date: "2026-02-01", source: "PROVIDER", price: "50000", fetchedAt: TS } });
}

async function evaluations(c: PrismaClient) {
  const storedPrices = (ids: string[], asOf: string) => storedPriceHistory(ids, asOf, c);
  const depots = await listDepots(c);
  return {
    depots,
    positions: await Promise.all(depots.map((depot) => listPositions(depot.id, TODAY, c, { storedPrices }))),
    valuations: await Promise.all(depots.map((depot) => depotValuation(depot.id, MAX, TODAY, c, { storedPrices }))),
    portfolio: await portfolioValuation(MAX, TODAY, c, { storedPrices }),
  };
}

beforeEach(() => {
  source = instance();
  target = instance();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await source.testDb.cleanup();
  await target.testDb.cleanup();
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type ClassificationRecord = Record<string, unknown> & { regionSplit?: unknown };

/** Classification records as a version-3 file has them (no `regionSplit` key). */
function withoutRegionSplits(records: ClassificationRecord[]): ClassificationRecord[] {
  return records.map((record) => Object.fromEntries(Object.entries(record).filter(([key]) => key !== "regionSplit")));
}

/** The records that still have a manual dimension value once their region splits are gone. */
function onlyOverrides(records: ClassificationRecord[]): ClassificationRecord[] {
  return records
    .map((record) => ({ ...record, regionSplit: null }))
    .filter((record) => Object.entries(record).some(([key, value]) => !["id", "securityId", "regionSplit"].includes(key) && value !== null));
}

describe("restoreExport", () => {
  it("restores over a watchlist entry: the entry goes with its Security (until story 9.3), the list stays", async () => {
    await seedFullLedger(source.testDb.client, source.dataDir);
    const text = await exportOf(source);
    await seedOtherData(target);
    const c = target.testDb.client;
    await c.watchlist.create({ data: { id: "wl-1", name: "Ideen", position: 1, createdAt: TS } });
    await c.watchlistEntry.create({
      data: { watchlistId: "wl-1", securityId: "other-sec", dateAdded: "2025-05-06", position: 1, createdAt: TS },
    });

    expect(await restoreInto(target, text)).toEqual({ ok: true, backupFileName: BACKUP_NAME });
    expect(await c.watchlistEntry.count()).toBe(0);
    expect(await c.watchlist.count()).toBe(1);
  });

  it("round-trips: restoring into an empty instance yields a byte-identical export and equal evaluations", async () => {
    await seedFullLedger(source.testDb.client, source.dataDir);
    await seedMorePrices(source.testDb.client);
    // A second Security held in the other Depot, so the Portfolio sums more than one Position.
    await source.testDb.client.depot.update({ where: { id: "depot-b" }, data: { archived: false } });
    await source.testDb.client.transaction.create({
      data: { id: "t-6", depotId: "depot-b", securityId: "sec-c", type: "BUY", date: "2026-01-20", sequence: 0, quantity: "0.002", price: "40000", amount: "80", fee: "1", tax: "0" },
    });
    await source.testDb.client.transaction.create({
      data: { id: "t-7", depotId: "depot-a", securityId: "sec-a", type: "BUY", date: "2026-03-02", sequence: 0, quantity: "2", price: "12.5", amount: "25", fee: "0.5", tax: "0" },
    });
    const text = await exportOf(source);
    const before = await evaluations(source.testDb.client);
    expect(before.positions.flat()).toHaveLength(2);
    expect(before.portfolio.series.length).toBeGreaterThan(200);
    expect(before.portfolio.performance).toBeDefined();

    const result = await restoreInto(target, text);
    expect(result).toEqual({ ok: true, backupFileName: BACKUP_NAME });
    expect(await exportOf(target)).toBe(text);
    expect(await evaluations(target.testDb.client)).toEqual(before);
    // The restored logo is the same image under a new file name.
    const logo = await target.testDb.client.securityLogo.findUniqueOrThrow({ where: { securityId: "sec-b" } });
    expect(logo).toMatchObject({ id: "logo-b", source: "MANUAL", provider: null, contentType: "image/png", fetchedAt: TS });
    expect(readFileSync(join(target.dataDir, "logos", logo.fileName as string))).toEqual(PNG);
    // Manual classification overrides are back; their automatic layer waits for the next refresh.
    // The manual region split is back too; the rule split cache is not.
    expect(await target.testDb.client.securityClassification.findMany({ orderBy: { id: "asc" } })).toEqual([
      expect.objectContaining({
        id: "cls-a",
        securityId: "sec-a",
        regionSplitManual: '{"USA":"60","Europa":"37.5","Sonstige":"2.5"}',
        regionSplit: null,
        regionSplitIndex: null,
        region: null,
      }),
      expect.objectContaining({ id: "cls-b", securityId: "sec-b", sectorManual: "Halbleiter", sector: null, providerSymbol: null, regionSplitManual: null }),
    ]);
    // Tax settings are back.
    expect(await target.testDb.client.taxAllowance.findMany({ orderBy: { id: "asc" } })).toEqual([
      expect.objectContaining({ id: "fsa-1", broker: "COMDIRECT", year: 2026, amount: "801" }),
      expect.objectContaining({ id: "fsa-2", broker: "FINANZEN_ZERO", year: 2026, amount: "199" }),
    ]);
    expect(await target.testDb.client.teilfreistellungOverride.findMany()).toEqual([
      expect.objectContaining({ id: "tfs-a", securityId: "sec-a", rate: "0.15" }),
    ]);
    // Target allocations are back (the deleted Depot's row was not exported).
    expect(await target.testDb.client.targetAllocation.findMany({ orderBy: { id: "asc" } })).toEqual([
      expect.objectContaining({ id: "ta-a", scope: "depot-a", weights: '{"cash":"100"}', threshold: "0.5" }),
      expect.objectContaining({ id: "ta-p", scope: "portfolio", weights: '{"equityUsa":"60","bonds":"37.5","cash":"2.5"}', threshold: "2" }),
    ]);
    // The automatic export of the (empty) target was written first.
    expect(readdirSync(target.backupDir)).toEqual([BACKUP_NAME]);
    expect(JSON.parse(readFileSync(join(target.backupDir, BACKUP_NAME), "utf8"))).toMatchObject({
      schemaVersion: 5,
      depots: [],
      classifications: [],
      taxAllowances: [],
      teilfreistellungOverrides: [],
      targetAllocations: [],
    });
  });

  it("replaces everything instead of merging and clears staging, news and fetched logos", async () => {
    await seedFullLedger(source.testDb.client, source.dataDir);
    const text = await exportOf(source);
    await seedOtherData(target);
    // A previous manual logo of a Security the file also has: its old file must go.
    await target.testDb.client.security.create({ data: { id: "sec-b", isin: "DE000SYNCX01", name: "Alt", assetType: "STOCK" } });
    writeLogo(target.dataDir, "sec-b-7.png");
    await target.testDb.client.securityLogo.create({
      data: { securityId: "sec-b", source: "MANUAL", fileName: "sec-b-7.png", contentType: "image/png", fetchedAt: TS },
    });
    const previousExport = await exportOf(target);

    expect(await restoreInto(target, text)).toEqual({ ok: true, backupFileName: BACKUP_NAME });

    expect(await exportOf(target)).toBe(text);
    const c = target.testDb.client;
    expect(await c.importBatch.count()).toBe(0);
    expect(await c.importItem.count()).toBe(0);
    expect(await c.newsArticle.count()).toBe(0);
    expect(await c.newsFetch.count()).toBe(0);
    expect(await c.securityLogo.findMany({ where: { source: "FETCHED" } })).toEqual([]);
    expect(await c.depot.findUnique({ where: { id: "other-depot" } })).toBeNull();
    expect(await c.taxAllowance.findUnique({ where: { id: "other-fsa" } })).toBeNull();
    expect(await c.targetAllocation.findUnique({ where: { id: "other-ta" } })).toBeNull();
    expect(await c.teilfreistellungOverride.count()).toBe(1);
    const logo = await c.securityLogo.findUniqueOrThrow({ where: { securityId: "sec-b" } });
    expect(readdirSync(join(target.dataDir, "logos"))).toEqual([logo.fileName]);
    expect(readdirSync(join(target.dataDir, "imports"))).toEqual([]);
    expect(readFileSync(join(target.backupDir, BACKUP_NAME), "utf8")).toBe(previousExport);
  });

  it("restores a version-2 file with no tax settings, replacing the previous ones", async () => {
    await seedFullLedger(source.testDb.client, source.dataDir);
    const current = JSON.parse(await exportOf(source));
    const version3Classifications = withoutRegionSplits(current.classifications);
    const version2 = { ...current, schemaVersion: 2, classifications: version3Classifications };
    delete version2.taxAllowances;
    delete version2.teilfreistellungOverrides;
    delete version2.targetAllocations;
    await target.testDb.client.taxAllowance.create({ data: { broker: "COMDIRECT", year: 2024, amount: "100", updatedAt: TS } });

    expect(await restoreInto(target, JSON.stringify(version2))).toEqual({ ok: true, backupFileName: BACKUP_NAME });
    expect(await target.testDb.client.taxAllowance.count()).toBe(0);
    expect(await target.testDb.client.teilfreistellungOverride.count()).toBe(0);
    expect(JSON.parse(await exportOf(target))).toEqual({
      ...current,
      classifications: onlyOverrides(current.classifications),
      taxAllowances: [],
      teilfreistellungOverrides: [],
      targetAllocations: [],
    });
  });

  it("restores a version-3 file with no manual region splits, replacing the previous ones", async () => {
    await seedFullLedger(source.testDb.client, source.dataDir);
    const current = JSON.parse(await exportOf(source));
    const version3 = { ...current, schemaVersion: 3, classifications: withoutRegionSplits(current.classifications) };
    delete version3.targetAllocations;
    await seedFullLedger(target.testDb.client, target.dataDir);

    expect(await restoreInto(target, JSON.stringify(version3))).toEqual({ ok: true, backupFileName: expect.any(String) });
    expect(await target.testDb.client.securityClassification.count({ where: { regionSplitManual: { not: null } } })).toBe(0);
    expect(JSON.parse(await exportOf(target))).toEqual({ ...current, classifications: onlyOverrides(current.classifications), targetAllocations: [] });
  });

  it("restores a version-4 file with no target allocations, replacing the previous ones", async () => {
    await seedFullLedger(source.testDb.client, source.dataDir);
    const current = JSON.parse(await exportOf(source));
    const version4 = { ...current, schemaVersion: 4 };
    delete version4.targetAllocations;
    await seedFullLedger(target.testDb.client, target.dataDir);

    expect(await restoreInto(target, JSON.stringify(version4))).toEqual({ ok: true, backupFileName: expect.any(String) });
    expect(await target.testDb.client.targetAllocation.count()).toBe(0);
    expect(JSON.parse(await exportOf(target))).toEqual({ ...current, targetAllocations: [] });
  });

  it("accepts a file with a UTF-8 byte order mark", async () => {
    await seedFullLedger(source.testDb.client, source.dataDir);
    const text = await exportOf(source);
    expect(await restoreInto(target, `\uFEFF${text}`)).toEqual({ ok: true, backupFileName: BACKUP_NAME });
    expect(await exportOf(target)).toBe(text);
  });

  it("writes the automatic export readable by the owner only", async () => {
    await seedFullLedger(source.testDb.client, source.dataDir);
    expect((await restoreInto(target, await exportOf(source))).ok).toBe(true);
    expect(statSync(join(target.backupDir, BACKUP_NAME)).mode & 0o777).toBe(0o600);
  });

  describe("rejects without changing anything", () => {
    let file: ReturnType<typeof JSON.parse>;

    beforeEach(async () => {
      await seedFullLedger(source.testDb.client, source.dataDir);
      file = JSON.parse(await exportOf(source));
      await seedOtherData(target);
    });

    async function expectRejected(text: string, expected: object, options: { backup?: boolean } = {}) {
      const before = await snapshot(target);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await restoreInto(target, text)).toEqual(expected);
      expect(await snapshot(target)).toEqual(before);
      if (!options.backup) expect(filesBelow(target.backupDir)).toEqual({});
      // Logs carry codes and paths only.
      const logged = [...warn.mock.calls, ...error.mock.calls].map((call) => String(call[0])).join("\n");
      for (const value of ["depot-a", "Hauptdepot", "1000.00", "sec-a"]) expect(logged).not.toContain(value);
    }

    it.each([
      ["empty text", "", { ok: false, reason: "file-missing" }],
      ["not JSON", "abc", { ok: false, reason: "not-json" }],
      ["a JSON string", '"abc"', { ok: false, reason: "schema-invalid" }],
      ["an empty object", "{}", { ok: false, reason: "schema-invalid", detail: "schemaVersion" }],
    ])("%s", async (_label, text, expected) => {
      await expectRejected(text, expected);
    });

    it("an unknown top-level key", async () => {
      await expectRejected(JSON.stringify({ ...file, exportedAt: TS }), { ok: false, reason: "schema-invalid", detail: "exportedAt" });
    });

    it("a number decimal", async () => {
      file.transactions[0].amount = 12.5;
      await expectRejected(JSON.stringify(file), { ok: false, reason: "schema-invalid", detail: "transactions.0.amount" });
    });

    it("a newer schema version", async () => {
      await expectRejected(JSON.stringify({ ...file, schemaVersion: 6 }), { ok: false, reason: "version-unsupported" });
    });

    it("a dangling reference", async () => {
      file.transactions[3].depotId = "unknown";
      await expectRejected(JSON.stringify(file), { ok: false, reason: "inconsistent", detail: "transactions.3.depotId" });
    });

    it("a duplicate unique key", async () => {
      file.depots[1].name = file.depots[0].name;
      await expectRejected(JSON.stringify(file), { ok: false, reason: "inconsistent", detail: "depots.1.name" });
    });

    it("a logo whose bytes do not match its content type", async () => {
      file.logos[0].data = JPEG.toString("base64");
      await expectRejected(JSON.stringify(file), { ok: false, reason: "logo-invalid", detail: "logos.0" });
    });

    it("a logo whose securityId is not usable in a file name", async () => {
      // Rename sec-b (the logo's Security) and every reference to it, so only the file-name check fails.
      const rename = (id: string | null) => (id === "sec-b" ? "sec.b" : id);
      file.securities = file.securities.map((s: { id: string }) => ({ ...s, id: rename(s.id) }));
      file.corporateActions = file.corporateActions.map((a: { securityId: string; newSecurityId: string | null }) => ({
        ...a,
        securityId: rename(a.securityId),
        newSecurityId: rename(a.newSecurityId),
      }));
      for (const key of ["transactions", "providerMappings", "prices", "logos", "classifications", "teilfreistellungOverrides"]) {
        file[key] = file[key].map((r: { securityId: string | null }) => ({ ...r, securityId: rename(r.securityId) }));
      }
      for (const run of file.reconciliationRuns) {
        run.rows = run.rows.map((r: { securityId: string | null }) => ({ ...r, securityId: rename(r.securityId) }));
      }
      expect(file.logos[0].securityId).toBe("sec.b");
      await expectRejected(JSON.stringify(file), { ok: false, reason: "logo-invalid", detail: "logos.0" });
    });

    it("a logo larger than the upload limit", async () => {
      file.logos[0].data = Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]).toString("base64");
      await expectRejected(JSON.stringify(file), { ok: false, reason: "logo-invalid", detail: "logos.0" });
    });

    it("a file over the size limit", async () => {
      await expectRejected(" ".repeat(RESTORE_MAX_FILE_BYTES + 1), { ok: false, reason: "file-too-large" });
    });

    it("an unwritable backup directory", async () => {
      writeFileSync(join(target.backupDir, "..", "blocker"), "");
      target.backupDir = join(target.backupDir, "..", "blocker");
      await expectRejected(JSON.stringify(file), { ok: false, reason: "backup-failed" }, { backup: true });
    });

    it("an existing backup file of the same name (never overwritten)", async () => {
      mkdirSync(target.backupDir, { recursive: true });
      writeFileSync(join(target.backupDir, BACKUP_NAME), "older");
      await expectRejected(JSON.stringify(file), { ok: false, reason: "backup-failed" }, { backup: true });
      expect(readFileSync(join(target.backupDir, BACKUP_NAME), "utf8")).toBe("older");
    });

    it("a database failure in the prices step (rolled back, name-only log)", async () => {
      await target.testDb.client.$executeRawUnsafe(
        `CREATE TRIGGER fail_price BEFORE INSERT ON "Price" BEGIN SELECT RAISE(ABORT, 'injected'); END;`,
      );
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      await expectRejected(JSON.stringify(file), { ok: false, reason: "restore-failed" }, { backup: true });
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).toMatch(/^Restore: replacing the data failed \(\w+\)$/);
      // The automatic export was written before the transaction and stays.
      expect(readdirSync(target.backupDir)).toEqual([BACKUP_NAME]);
    });

    it("a database failure in the logos step removes the new logo files", async () => {
      await target.testDb.client.$executeRawUnsafe(
        `CREATE TRIGGER fail_logo BEFORE INSERT ON "SecurityLogo" BEGIN SELECT RAISE(ABORT, 'injected'); END;`,
      );
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await expectRejected(JSON.stringify(file), { ok: false, reason: "restore-failed" }, { backup: true });
    });
  });
});

describe("backupDir", () => {
  it("uses BACKUP_DIR and defaults to ~/.depotmanagement/backups", () => {
    expect(backupDir({ BACKUP_DIR: "/srv/backups" })).toBe("/srv/backups");
    expect(backupDir({ BACKUP_DIR: "  " })).toMatch(/\.depotmanagement[/\\]backups$/);
    expect(backupDir({})).toMatch(/\.depotmanagement[/\\]backups$/);
  });
});
