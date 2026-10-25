import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { archiveDepot, createDepot, ensureSecurity } from "@/modules/ledger";
import { previewParqetMigration } from "./preview";

const FIXTURE = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export.csv.txt"), "utf8");

let testDb: TestDatabase;

beforeAll(() => {
  testDb = createTestDatabase();
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  const db = testDb.client;
  await db.corporateAction.deleteMany();
  await db.transaction.deleteMany();
  await db.security.deleteMany();
  await db.depot.deleteMany();
});

async function depot(name = "Hauptdepot") {
  const created = await createDepot({ name, broker: "FINANZEN_ZERO" }, testDb.client);
  if (!created.ok) throw new Error("setup failed");
  return created.depot;
}

async function rowCounts() {
  const db = testDb.client;
  return {
    depots: await db.depot.count(),
    securities: await db.security.count(),
    transactions: await db.transaction.count(),
    corporateActions: await db.corporateAction.count(),
  };
}

describe("previewParqetMigration", () => {
  it("previews the fixture: counts, ISIN change, flags, Securities and figures as of the export date", async () => {
    const target = await depot();
    const before = await rowCounts();
    const result = await previewParqetMigration(target.id, FIXTURE, testDb.client);
    if (!result.ok) throw new Error(result.reason);
    const { preview } = result;

    expect(preview.depot).toEqual({ id: target.id, name: "Hauptdepot" });
    expect(preview.exportDate).toBe("2024-06-10");
    expect(preview.counts).toEqual({ BUY: 3, SELL: 1, DIVIDEND: 1, TAX: 1, DEPOSIT: 1, WITHDRAWAL: 1 });
    expect(preview.adjustedCount).toBe(1);
    expect(preview.isinChanges).toHaveLength(1);
    expect(preview.flagged.map((flag) => flag.reason)).toEqual([
      "unsupported-row",
      "unparseable",
      "cash-pair-mismatch",
      "unpaired-security-transfer",
      "unparseable",
      "non-eur",
    ]);
    expect(preview.securities.map((s) => [s.name, s.assetType, s.existing])).toEqual([
      ["Altname Software SE", "UNCLASSIFIED", false],
      ['Apfel "Tech" Inc.; Class A', "UNCLASSIFIED", false],
      ["Bitcoin", "CRYPTO", false],
      ["Neuname Software SE", "UNCLASSIFIED", false],
    ]);
    expect(preview.figures).toEqual({
      positions: [
        { securityKey: "US0378331005", name: 'Apfel "Tech" Inc.; Class A', quantity: "5", costBasis: "62.23" },
        { securityKey: "BTC", name: "Bitcoin", quantity: "0.00012345", costBasis: "4.938" },
        { securityKey: "DE000SYN0013", name: "Neuname Software SE", quantity: "6.00172839", costBasis: "1201.335678" },
      ],
      investedCapital: "1268.503678",
      cashBalance: "9142.666322",
    });
    // Plain, serialisable data.
    expect(JSON.parse(JSON.stringify(preview))).toEqual(preview);
    // Nothing written.
    expect(await rowCounts()).toEqual(before);
  });

  it("lists an existing Security with its stored name and type", async () => {
    const target = await depot();
    const existing = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" }, testDb.client);
    expect(existing.ok).toBe(true);
    const result = await previewParqetMigration(target.id, FIXTURE, testDb.client);
    if (!result.ok) throw new Error(result.reason);
    expect(result.preview.securities.find((s) => s.key === "US0378331005")).toEqual({
      key: "US0378331005",
      isin: "US0378331005",
      cryptoSymbol: null,
      name: "Apple Inc.",
      assetType: "STOCK",
      existing: true,
    });
    expect(result.preview.figures?.positions.find((p) => p.securityKey === "US0378331005")?.name).toBe("Apple Inc.");
  });

  it("refuses an unknown or archived Depot", async () => {
    expect(await previewParqetMigration("nope", FIXTURE, testDb.client)).toEqual({ ok: false, reason: "depot-not-found" });
    const old = await depot("Alt");
    expect((await archiveDepot(old.id, testDb.client)).ok).toBe(true);
    expect(await previewParqetMigration(old.id, FIXTURE, testDb.client)).toEqual({ ok: false, reason: "depot-archived" });
  });

  it("passes the reader's file failures through", async () => {
    const target = await depot();
    expect(await previewParqetMigration(target.id, "", testDb.client)).toEqual({ ok: false, reason: "empty-file" });
    expect(await previewParqetMigration(target.id, "datetime;type", testDb.client)).toEqual({
      ok: false,
      reason: "missing-columns",
      columns: ["price", "shares", "amount", "tax", "fee", "assettype", "identifier", "currency"],
    });
  });

  it("has no figures when no row carries a date", async () => {
    const target = await depot();
    const text = "datetime;price;shares;amount;tax;fee;type;assettype;identifier;currency\ngarbage;;;1;;;TransferIn;Cash;;EUR";
    const result = await previewParqetMigration(target.id, text, testDb.client);
    if (!result.ok) throw new Error(result.reason);
    expect(result.preview.exportDate).toBeNull();
    expect(result.preview.figures).toBeNull();
    expect(result.preview.flagged).toEqual([{ records: [2], reason: "unparseable", detail: "datetime" }]);
  });
});
