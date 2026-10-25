import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { archiveDepot, createDepot, ensureSecurity, recordIsinChange, recordSplit, recordTransaction } from "@/modules/ledger";
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
    expect(preview.exportDate).toBe("2024-07-03");
    expect(preview.counts).toEqual({ BUY: 4, SELL: 1, DIVIDEND: 1, TAX: 1, DEPOSIT: 2, WITHDRAWAL: 1 });
    expect(preview.adjustedCount).toBe(1);
    expect(preview.splits).toEqual([]);
    expect(preview.isinChanges).toEqual([expect.objectContaining({ oldKey: "DE0007164600", recorded: false })]);
    expect(preview.deliveries).toEqual([
      expect.objectContaining({ type: "BUY", securityKey: "IE00B4L5Y983", quantity: "3", amount: "300", delivery: "buy", records: [6] }),
    ]);
    expect(preview.duplicates).toEqual([]);
    expect(preview.hasCashRows).toBe(true);
    expect(preview.flagged[0].rows[0]).toMatchObject({ type: "Buy", assettype: "Cash" });
    expect(preview.flagged.map((flag) => flag.reason)).toEqual([
      "unsupported-row",
      "unparseable",
      "cash-pair-mismatch",
      "unparseable",
      "non-eur",
    ]);
    expect(preview.securities.map((s) => [s.name, s.assetType, s.existing, s.estimated])).toEqual([
      ["Altname Software SE", "STOCK", false, true],
      ['Apfel "Tech" Inc.; Class A', "STOCK", false, true],
      ["Bitcoin", "CRYPTO", false, false],
      ["Neuname Software SE", "STOCK", false, true],
      ["Welt ETF", "ETF", false, true],
    ]);
    expect(preview.figures).toEqual({
      positions: [
        { securityKey: "US0378331005", name: 'Apfel "Tech" Inc.; Class A', quantity: "5", costBasis: "62.23" },
        { securityKey: "BTC", name: "Bitcoin", quantity: "0.00012345", costBasis: "4.938" },
        { securityKey: "DE000SYN0013", name: "Neuname Software SE", quantity: "6.00172839", costBasis: "1201.335678" },
        { securityKey: "IE00B4L5Y983", name: "Welt ETF", quantity: "3", costBasis: "300" },
      ],
      investedCapital: "1568.503678",
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
      estimated: false,
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
    expect(result.preview.flagged).toEqual([
      expect.objectContaining({ records: [2], reason: "unparseable", detail: "datetime" }),
    ]);
  });
});

describe("previewParqetMigration — against the existing ledger", () => {
  it("lists proposals matching the Depot's rows as duplicates (only that Depot, never within the file)", async () => {
    const target = await depot();
    const other = await depot("Zweitdepot");
    const apple = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple Inc.", assetType: "STOCK" }, testDb.client);
    if (!apple.ok) throw new Error("setup failed");
    const deposit = { type: "DEPOSIT", date: "2024-01-02", amount: "10000" } as const;
    expect((await recordTransaction({ depotId: target.id, ...deposit }, testDb.client)).ok).toBe(true);
    // Two identical dividends → the proposal is ambiguous.
    for (let i = 0; i < 2; i++) {
      const dividend = { depotId: target.id, type: "DIVIDEND", date: "2024-03-01", amount: "30.005", tax: "4.5", security: { id: apple.security.id }, allowDuplicate: true };
      expect((await recordTransaction(dividend, testDb.client)).ok).toBe(true);
    }
    expect((await recordTransaction({ depotId: other.id, type: "WITHDRAWAL", date: "2024-06-10", amount: "50" }, testDb.client)).ok).toBe(true);

    const result = await previewParqetMigration(target.id, FIXTURE, testDb.client);
    if (!result.ok) throw new Error(result.reason);
    expect(result.preview.duplicates.map((d) => [d.key, d.proposal.type, d.status, d.matches.length])).toEqual([
      ["24", "DEPOSIT", "duplicate", 1],
      ["18-19", "DIVIDEND", "ambiguous", 2],
    ]);
    expect(result.preview.duplicates[0].matches[0]).toMatchObject({ type: "DEPOSIT", amount: "10000", date: "2024-01-02" });
  });

  it("marks an ISIN change whose old Security already has one on that date as recorded", async () => {
    const target = await depot();
    const old = await ensureSecurity({ isin: "DE0007164600" }, { name: "Alt", assetType: "STOCK" }, testDb.client);
    if (!old.ok) throw new Error("setup failed");
    const changed = await recordIsinChange(
      { oldSecurityId: old.security.id, newSecurity: { new: { isin: "DE000SYN0013", name: "Neu", assetType: "STOCK" } }, date: "2024-05-02", oldQuantity: "2", newQuantity: "1" },
      testDb.client,
    );
    expect(changed.ok).toBe(true);
    const result = await previewParqetMigration(target.id, FIXTURE, testDb.client);
    if (!result.ok) throw new Error(result.reason);
    expect(result.preview.isinChanges[0].recorded).toBe(true);
  });

  it("lists file splits, applies them to the figures and marks one already recorded", async () => {
    const target = await depot();
    const text = [
      "datetime;price;shares;amount;tax;fee;type;assettype;identifier;currency;holdingname",
      "2024-06-01T00:00:00Z;;40;;;;TransferIn;Security;US0378331005;EUR;Apfel",
      "2024-06-01T00:00:00Z;;10;;;;TransferOut;Security;US0378331005;EUR;Apfel",
      "2024-05-06T09:00:00Z;40;10;400;0;0;Buy;Security;US0378331005;EUR;Apfel",
    ].join("\n");
    const fresh = await previewParqetMigration(target.id, text, testDb.client);
    if (!fresh.ok) throw new Error(fresh.reason);
    expect(fresh.preview.splits).toEqual([
      { date: "2024-06-01", key: "US0378331005", oldQuantity: "10", newQuantity: "40", ratioOld: "1", ratioNew: "4", records: [2, 3], recorded: false },
    ]);
    expect(fresh.preview.figures?.positions).toEqual([
      { securityKey: "US0378331005", name: "Apfel", quantity: "40", costBasis: "400" },
    ]);

    const apple = await ensureSecurity({ isin: "US0378331005" }, { name: "Apfel", assetType: "STOCK" }, testDb.client);
    if (!apple.ok) throw new Error("setup failed");
    expect((await recordSplit({ securityId: apple.security.id, date: "2024-06-01", ratio: "1:4" }, testDb.client)).ok).toBe(true);
    const again = await previewParqetMigration(target.id, text, testDb.client);
    if (!again.ok) throw new Error(again.reason);
    expect(again.preview.splits[0].recorded).toBe(true);

    // A recorded split of another ratio on that date is not this one: it is booked (and fails loudly).
    const reverse = text.replace(";40;;;;TransferIn", ";5;;;;TransferIn");
    const other = await previewParqetMigration(target.id, reverse, testDb.client);
    if (!other.ok) throw new Error(other.reason);
    expect(other.preview.splits[0]).toMatchObject({ ratioOld: "2", ratioNew: "1", recorded: false });
  });
});
