import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PNG, seedFullLedger as seed, TS, writeLogo as writeLogoIn } from "../../../test/helpers/backup-seed";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { createExport, EXPORT_SCHEMA_VERSION, exportFileName, exportFileSchema, serializeExport } from "./index";


let testDb: TestDatabase;
let dataDir: string;
const db = () => testDb.client;
const deps = () => ({ env: { DATA_DIR: dataDir } });

beforeEach(() => {
  testDb = createTestDatabase();
  dataDir = mkdtempSync(join(tmpdir(), "depot-export-"));
});

const seedFullLedger = () => seed(db(), dataDir);
const writeLogo = (fileName: string) => writeLogoIn(dataDir, fileName);

afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("createExport", () => {
  it("exports every stored row with all columns as stored, sorted by stable keys", async () => {
    await seedFullLedger();
    const file = await createExport(deps(), db());
    expect(Object.keys(file)).toEqual([
      "schemaVersion",
      "depots",
      "securities",
      "providerMappings",
      "transactions",
      "corporateActions",
      "reconciliationRuns",
      "prices",
      "logos",
      "classifications",
      "taxAllowances",
      "teilfreistellungOverrides",
    ]);
    expect(file.schemaVersion).toBe(4);
    expect(file.taxAllowances).toEqual([
      { id: "fsa-1", broker: "COMDIRECT", year: 2026, amount: "801" },
      { id: "fsa-2", broker: "FINANZEN_ZERO", year: 2026, amount: "199" },
    ]);
    expect(file.teilfreistellungOverrides).toEqual([{ id: "tfs-a", securityId: "sec-a", rate: "0.15" }]);
    // Manual overrides and manual region splits only; automatic values and the rule split are a cache.
    expect(file.classifications).toEqual([
      {
        id: "cls-a",
        securityId: "sec-a",
        assetClass: null,
        sector: null,
        industry: null,
        region: null,
        country: null,
        companySize: null,
        currency: null,
        regionSplit: { USA: "60", Europa: "37.5", Sonstige: "2.5" },
      },
      {
        id: "cls-b",
        securityId: "sec-b",
        assetClass: null,
        sector: "Halbleiter",
        industry: null,
        region: "Europa",
        country: null,
        companySize: null,
        currency: "EUR",
        regionSplit: null,
      },
    ]);
    expect(file.depots).toEqual([
      { id: "depot-a", name: "Hauptdepot", broker: "COMDIRECT", archived: false },
      { id: "depot-b", name: "Zweitdepot", broker: "FINANZEN_ZERO", archived: true },
    ]);
    expect(file.securities.map((s) => s.id)).toEqual(["sec-a", "sec-b", "sec-c"]);
    expect(file.securities[2]).toEqual({ id: "sec-c", isin: null, cryptoSymbol: "BTC", name: "Bitcoin", assetType: "CRYPTO" });
    expect(file.transactions.map((t) => t.id)).toEqual(["t-1", "t-2", "t-3", "t-4", "t-5"]);
    expect(file.transactions[1]).toEqual({
      id: "t-2",
      depotId: "depot-a",
      securityId: "sec-a",
      type: "BUY",
      date: "2026-02-01",
      sequence: 0,
      quantity: "1.50000",
      price: "10.00",
      amount: "15.00",
      fee: "0.99",
      tax: "0",
      note: "erste Notiz",
    });
    expect(file.transactions[3]).toMatchObject({ type: "ADJUSTMENT", quantity: "-0.50", price: null, note: "Kontoabgleich" });
    expect(file.transactions[0]).toMatchObject({ securityId: null, quantity: null, price: null, note: null, amount: "1000.00" });
    expect(file.corporateActions).toEqual([
      { id: "ca-1", securityId: "sec-a", newSecurityId: null, type: "SPLIT", date: "2026-05-01", ratioOld: "1", ratioNew: "4" },
      { id: "ca-2", securityId: "sec-b", newSecurityId: "sec-a", type: "ISIN_CHANGE", date: "2026-04-01", ratioOld: "2.0", ratioNew: "1" },
    ]);
    expect(file.reconciliationRuns).toEqual([
      {
        id: "run-1",
        depotId: "depot-a",
        statementDate: "2026-06-30",
        status: "FINISHED",
        createdAt: TS,
        finishedAt: "2026-10-26T11:00:00.000Z",
        rows: [
          { id: "row-1", runId: "run-1", securityId: null, statementValue: "987.6500", checked: false },
          { id: "row-2", runId: "run-1", securityId: "sec-a", statementValue: "4.00", checked: true },
        ],
      },
    ]);
    expect(file.providerMappings).toEqual([
      { id: "map-a", securityId: "sec-a", provider: "YAHOO", symbol: "SYA.DE", origin: "AUTO", updatedAt: TS, historyFrom: "2026-01-15", fetchedAt: TS, fetchError: null },
      { id: "map-b", securityId: "sec-b", provider: null, symbol: null, origin: "AUTO", updatedAt: TS, historyFrom: null, fetchedAt: null, fetchError: "not-found" },
    ]);
    expect(file.prices.map((p) => [p.id, p.price])).toEqual([
      ["p-1", "10.50"],
      ["p-2", "10.1"],
      ["p-3", "11.2000"],
    ]);
    expect(file.logos).toEqual([
      { id: "logo-b", securityId: "sec-b", contentType: "image/png", fetchedAt: TS, data: PNG.toString("base64") },
    ]);
    expect(exportFileSchema.parse(file)).toEqual(file);
  });

  it("leaves out fetched logos, markers, news and import staging", async () => {
    await seedFullLedger();
    const c = db();
    writeLogo("sec-a-1.png");
    await c.securityLogo.create({
      data: { securityId: "sec-a", source: "FETCHED", provider: "LOGO_DEV", fileName: "sec-a-1.png", contentType: "image/png", fetchedAt: TS },
    });
    await c.securityLogo.create({ data: { securityId: "sec-c", source: "FETCHED", fetchedAt: TS } });
    await c.newsArticle.create({
      data: {
        securityId: "sec-a",
        url: "https://example.test/marker-news-url",
        title: "MARKER_NEWS_TITLE",
        source: "MARKER_NEWS_SOURCE",
        publishedAt: TS,
        provider: "YAHOO",
        fetchedAt: TS,
      },
    });
    await c.newsFetch.create({ data: { securityId: "sec-a", fetchedAt: "2026-10-26T09:59:59.999Z" } });
    await c.importBatch.create({
      data: {
        depotId: "depot-a",
        createdAt: TS,
        items: { create: [{ position: 0, fileName: "MARKER_IMPORT_FILE.pdf", fileHash: "MARKER_IMPORT_HASH", status: "PARSED" }] },
      },
    });
    const file = await createExport(deps(), db());
    expect(file.logos.map((logo) => logo.securityId)).toEqual(["sec-b"]);
    const json = serializeExport(file);
    for (const marker of [
      "marker-news-url",
      "MARKER_NEWS_TITLE",
      "MARKER_NEWS_SOURCE",
      "2026-10-26T09:59:59.999Z",
      "MARKER_IMPORT_FILE",
      "MARKER_IMPORT_HASH",
      "LOGO_DEV",
      "FETCHED",
      "sec-a-1.png",
      "fileName",
    ]) {
      expect(json).not.toContain(marker);
    }
  });

  it("exports an empty instance as the current schemaVersion with empty arrays", async () => {
    expect(await createExport(deps(), db())).toEqual({
      schemaVersion: EXPORT_SCHEMA_VERSION,
      depots: [],
      securities: [],
      providerMappings: [],
      transactions: [],
      corporateActions: [],
      reconciliationRuns: [],
      prices: [],
      logos: [],
      classifications: [],
      taxAllowances: [],
      teilfreistellungOverrides: [],
    });
  });

  it("omits a manual logo whose file is missing and warns without ids or data", async () => {
    await seedFullLedger();
    rmSync(join(dataDir, "logos", "sec-b-1.png"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const file = await createExport(deps(), db());
    expect(file.logos).toEqual([]);
    expect(file.transactions).toHaveLength(5);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).not.toContain("sec-b");
    expect(message).not.toContain("logo-b");
  });

  it("skips a zero-byte manual logo file with one data-free warning", async () => {
    await seedFullLedger();
    writeFileSync(join(dataDir, "logos", "sec-b-1.png"), Buffer.alloc(0));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const file = await createExport(deps(), db());
    expect(file.logos).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("unusable");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("sec-b");
  });

  it("skips manual logos with a missing or unsupported content type with one data-free warning", async () => {
    await seedFullLedger();
    await db().securityLogo.update({ where: { id: "logo-b" }, data: { contentType: "image/gif" } });
    writeLogo("sec-c-1.png");
    await db().securityLogo.create({
      data: { id: "logo-c", securityId: "sec-c", source: "MANUAL", fileName: "sec-c-1.png", contentType: null, fetchedAt: TS },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const file = await createExport(deps(), db());
    expect(file.logos).toEqual([]);
    expect(file.transactions).toHaveLength(5);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    for (const value of ["sec-b", "sec-c", "logo-b", "logo-c", "image/gif", "sec-c-1.png"]) {
      expect(message).not.toContain(value);
    }
  });

  it("sorts provider mappings and logos by securityId and reconciliation runs by id", async () => {
    const c = db();
    await c.depot.create({ data: { id: "depot-b", name: "Zweitdepot", broker: "COMDIRECT" } });
    await c.depot.create({ data: { id: "depot-a", name: "Hauptdepot", broker: "COMDIRECT" } });
    await c.security.create({ data: { id: "sec-b", isin: "DE000SYNCB08", name: "Synthetic Beta AG", assetType: "STOCK" } });
    await c.security.create({ data: { id: "sec-a", isin: "DE000SYNCA09", name: "Synthetic Alpha AG", assetType: "ETF" } });
    // Inserted in reverse key order; ids sort opposite to securityId so the id order cannot pass by accident.
    await c.providerMapping.create({ data: { id: "map-1", securityId: "sec-b", origin: "AUTO", updatedAt: TS } });
    await c.providerMapping.create({ data: { id: "map-2", securityId: "sec-a", origin: "AUTO", updatedAt: TS } });
    writeLogo("sec-b-1.png");
    writeLogo("sec-a-1.png");
    await c.securityLogo.create({ data: { id: "logo-1", securityId: "sec-b", source: "MANUAL", fileName: "sec-b-1.png", contentType: "image/png", fetchedAt: TS } });
    await c.securityLogo.create({ data: { id: "logo-2", securityId: "sec-a", source: "MANUAL", fileName: "sec-a-1.png", contentType: "image/png", fetchedAt: TS } });
    // Runs: depotId and createdAt sort opposite to id.
    await c.reconciliationRun.create({ data: { id: "run-2", depotId: "depot-a", statementDate: "2026-06-30", status: "OPEN", createdAt: "2026-10-01T00:00:00.000Z" } });
    await c.reconciliationRun.create({ data: { id: "run-1", depotId: "depot-b", statementDate: "2026-06-30", status: "OPEN", createdAt: "2026-10-02T00:00:00.000Z" } });
    const file = await createExport(deps(), db());
    expect(file.providerMappings.map((m) => [m.id, m.securityId])).toEqual([
      ["map-2", "sec-a"],
      ["map-1", "sec-b"],
    ]);
    expect(file.logos.map((logo) => [logo.id, logo.securityId])).toEqual([
      ["logo-2", "sec-a"],
      ["logo-1", "sec-b"],
    ]);
    expect(file.reconciliationRuns.map((run) => run.id)).toEqual(["run-1", "run-2"]);
  });

  it("throws on a row that breaks the schema and logs only paths and codes", async () => {
    await seedFullLedger();
    await db().transaction.update({ where: { id: "t-2" }, data: { amount: "SECRET-AMOUNT-123" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(createExport(deps(), db())).rejects.toThrow("export-invalid");
    expect(error).toHaveBeenCalledTimes(1);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain("transactions.1.amount: custom");
    expect(message).not.toContain("SECRET-AMOUNT-123");
    expect(message).not.toContain("t-2");
  });

  it("yields byte-identical JSON for the same data", async () => {
    await seedFullLedger();
    const first = serializeExport(await createExport(deps(), db()));
    const second = serializeExport(await createExport(deps(), db()));
    expect(second).toBe(first);
    expect(first).toBe(JSON.stringify(JSON.parse(first), null, 2));
    expect(first).toContain('"quantity": "1.50000"');
  });
});

describe("exportFileSchema", () => {
  it("rejects unknown keys, a wrong version and number decimals", async () => {
    await seedFullLedger();
    const file = await createExport(deps(), db());
    expect(exportFileSchema.safeParse({ ...file, schemaVersion: 1 }).success).toBe(false);
    expect(exportFileSchema.safeParse({ ...file, schemaVersion: 3 }).success).toBe(false);
    expect(exportFileSchema.safeParse({ ...file, schemaVersion: 5 }).success).toBe(false);
    expect(exportFileSchema.safeParse({ ...file, taxAllowances: [{ ...file.taxAllowances[0], amount: "-1" }] }).success).toBe(false);
    const classifications = [{ ...file.classifications[0], region: "Mars" }];
    expect(exportFileSchema.safeParse({ ...file, classifications }).success).toBe(false);
    // A region split must be canonical percentages of the split regions summing to exactly 100.
    for (const regionSplit of [{ USA: "60", Europa: "39.5" }, { USA: "100", Mars: "0" }, { USA: "60.0", Europa: "40" }, { USA: 100 }, {}]) {
      expect(exportFileSchema.safeParse({ ...file, classifications: [{ ...file.classifications[0], regionSplit }] }).success).toBe(false);
    }
    expect(exportFileSchema.safeParse({ ...file, classifications: [{ ...file.classifications[0], regionSplit: { Japan: "100" } }] }).success).toBe(true);
    expect(exportFileSchema.safeParse({ ...file, classifications: [{ ...file.classifications[0], regionSplit: undefined }] }).success).toBe(false);
    expect(exportFileSchema.safeParse({ ...file, exportedAt: TS }).success).toBe(false);
    const transactions = [{ ...file.transactions[0], amount: 1000 }];
    expect(exportFileSchema.safeParse({ ...file, transactions }).success).toBe(false);
  });
});

describe("exportFileName", () => {
  it("uses Europe/Berlin local time in winter (UTC+1) and summer (UTC+2)", () => {
    expect(exportFileName(new Date("2026-01-15T23:30:05Z"))).toBe("depotmanagement-export-20260116-003005.json");
    expect(exportFileName(new Date("2026-07-01T08:09:10Z"))).toBe("depotmanagement-export-20260701-100910.json");
    expect(exportFileName(new Date("2026-10-25T22:00:00Z"))).toBe("depotmanagement-export-20261025-230000.json");
  });
});
