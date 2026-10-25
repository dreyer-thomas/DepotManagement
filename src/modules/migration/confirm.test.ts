import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import {
  archiveDepot,
  createDepot,
  ensureSecurity,
  listIsinChanges,
  listTransactions,
  recordTransaction,
} from "@/modules/ledger";
import { confirmParqetMigration, type ConfirmResult, recordOpeningBalance } from "./confirm";
import { type Correction, initialDecisions, type MigrationDecisions } from "./decisions";
import { previewParqetMigration } from "./preview";

const FIXTURE = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export.csv.txt"), "utf8");
const NO_CASH = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export-no-cash.csv.txt"), "utf8");

const OLD = "DE0007164600";
const NEW = "DE000SYN0013";
const APFEL = "US0378331005";
const WELT = "IE00B4L5Y983";
const FLAG_KEYS = ["2", "3", "4-5", "6", "7", "8"];

/** Every decision of the fixture: classify the three ISINs, skip every flag. */
const DECIDED: MigrationDecisions = {
  classifications: { [OLD]: "STOCK", [NEW]: "STOCK", [APFEL]: "STOCK" },
  flags: Object.fromEntries(FLAG_KEYS.map((key) => [key, { action: "skip" as const }])),
  duplicates: {},
};

const withFlag = (key: string, correction: Partial<Correction>): MigrationDecisions => ({
  ...DECIDED,
  flags: {
    ...DECIDED.flags,
    [key]: {
      action: "book",
      correction: {
        type: "BUY",
        date: "2024-06-03",
        securityKey: WELT,
        securityName: "Welt ETF",
        assetType: "ETF",
        quantity: "10",
        price: "5",
        amount: "",
        fee: "",
        tax: "",
        ...correction,
      },
    },
  },
});

let testDb: TestDatabase;
const db = () => testDb.client;

beforeAll(() => {
  testDb = createTestDatabase();
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await db().corporateAction.deleteMany();
  await db().transaction.deleteMany();
  await db().security.deleteMany();
  await db().depot.deleteMany();
});

async function depot(name = "Hauptdepot") {
  const created = await createDepot({ name, broker: "FINANZEN_ZERO" }, db());
  if (!created.ok) throw new Error("setup failed");
  return created.depot.id;
}

async function counts() {
  return {
    securities: await db().security.count(),
    transactions: await db().transaction.count(),
    corporateActions: await db().corporateAction.count(),
  };
}

function ok(result: ConfirmResult) {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.summary;
}

/** Decisions for a re-run: the fixture's flags skipped and the preview's duplicates pre-set to skip. */
async function rerunDecisions(depotId: string, text = FIXTURE): Promise<MigrationDecisions> {
  const preview = await previewParqetMigration(depotId, text, db());
  if (!preview.ok) throw new Error(preview.reason);
  return { ...DECIDED, duplicates: initialDecisions(preview.preview).duplicates };
}

const HEADER = "datetime;price;shares;amount;tax;fee;realizedgains;type;assettype;identifier;currency;holdingname";

describe("confirmParqetMigration", () => {
  it("books a first migration atomically and reconciles everything without a difference", async () => {
    const depotId = await depot();
    const summary = ok(await confirmParqetMigration(depotId, FIXTURE, DECIDED, db()));

    expect(summary.depot.name).toBe("Hauptdepot");
    expect(summary.exportDate).toBe("2024-06-10");
    expect(summary.booked).toEqual({ transactions: 8, isinChanges: 1, securities: 4 });
    expect(summary.skipped).toEqual({ duplicates: 0, flags: 6, isinChanges: 0 });
    const comparison = summary.comparison!;
    expect(comparison.positions.map((p) => [p.key, p.quantity.ledger, p.costBasis.ledger, p.mismatch])).toEqual([
      [APFEL, "5", "62.23", false],
      ["BTC", "0.00012345", "4.938", false],
      [NEW, "6.00172839", "1201.335678", false],
    ]);
    expect(comparison.investedCapital).toEqual({ ledger: "1268.503678", file: "1268.503678", mismatch: false });
    expect(comparison.cash).toEqual({ ledger: "9142.666322", file: "9142.666322", mismatch: false });
    expect(comparison.sales).toEqual([
      {
        key: "10-11",
        securityKey: APFEL,
        name: 'Apfel "Tech" Inc.; Class A',
        date: "2024-06-03",
        gain: { ledger: "436.77", file: "436.77", mismatch: false },
      },
    ]);
    expect(summary.openingBalance).toBeNull();

    const rows = await listTransactions(depotId, db());
    expect(rows).toHaveLength(8);
    expect(rows.find((row) => row.type === "BUY" && row.security?.isin === OLD)?.security?.assetType).toBe("STOCK");
    expect(await listIsinChanges(db())).toEqual([
      expect.objectContaining({ date: "2024-05-02", oldQuantity: "12.00345678", newQuantity: "6.00172839" }),
    ]);
  });

  it("books nothing when the same file runs again for the same Depot", async () => {
    const depotId = await depot();
    ok(await confirmParqetMigration(depotId, FIXTURE, DECIDED, db()));
    const before = await counts();

    const preview = await previewParqetMigration(depotId, FIXTURE, db());
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.preview.duplicates.map((d) => d.status)).toEqual(Array(8).fill("duplicate"));
    expect(preview.preview.isinChanges[0].recorded).toBe(true);

    const summary = ok(await confirmParqetMigration(depotId, FIXTURE, await rerunDecisions(depotId), db()));
    expect(summary.booked).toEqual({ transactions: 0, isinChanges: 0, securities: 0 });
    expect(summary.skipped).toEqual({ duplicates: 8, flags: 6, isinChanges: 1 });
    // The skipped SELL is still reconciled through its single match.
    expect(summary.comparison?.sales.map((sale) => sale.gain.mismatch)).toEqual([false]);
    expect(summary.comparison?.positions.some((p) => p.mismatch)).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it("books the same file normally for another Depot (the recorded ISIN change is not booked again)", async () => {
    ok(await confirmParqetMigration(await depot(), FIXTURE, DECIDED, db()));
    const second = await depot("Zweitdepot");
    const summary = ok(await confirmParqetMigration(second, FIXTURE, await rerunDecisions(second), db()));
    expect(summary.booked).toEqual({ transactions: 8, isinChanges: 0, securities: 0 });
    expect(summary.skipped.isinChanges).toBe(1);
    expect(summary.comparison?.positions.some((p) => p.mismatch)).toBe(false);
    expect(summary.comparison?.cash?.mismatch).toBe(false);
  });

  it("returns decisions-open with a fresh preview and writes nothing while a decision is open", async () => {
    const depotId = await depot();
    const classifications = { ...DECIDED.classifications };
    delete classifications[APFEL];
    const result = await confirmParqetMigration(depotId, FIXTURE, { ...DECIDED, classifications }, db());
    expect(result).toMatchObject({ ok: false, reason: "decisions-open", open: [{ kind: "classification", key: APFEL }] });
    expect(result.ok === false && result.reason === "decisions-open" && result.preview.depot.id).toBe(depotId);
    expect(await counts()).toEqual({ securities: 0, transactions: 0, corporateActions: 0 });

    // A duplicate that appeared since the preview is open too.
    expect((await recordTransaction({ depotId, type: "DEPOSIT", date: "2024-01-02", amount: "10000" }, db())).ok).toBe(true);
    expect(await confirmParqetMigration(depotId, FIXTURE, DECIDED, db())).toMatchObject({
      reason: "decisions-open",
      open: [{ kind: "duplicate", key: "24" }],
    });
  });

  it("books a corrected flag after that date's proposals", async () => {
    const depotId = await depot();
    const summary = ok(await confirmParqetMigration(depotId, FIXTURE, withFlag("6", {}), db()));
    expect(summary.booked.transactions).toBe(9);
    expect(summary.skipped.flags).toBe(5);
    const rows = await listTransactions(depotId, db());
    const onDate = rows.filter((row) => row.date === "2024-06-03").sort((a, b) => a.sequence - b.sequence);
    expect(onDate.map((row) => [row.type, row.sequence])).toEqual([
      ["SELL", 1],
      ["BUY", 2],
    ]);
    expect(onDate[1]).toMatchObject({ quantity: "10", price: "5", amount: "50", security: { isin: WELT, name: "Welt ETF", assetType: "ETF" } });
    // The file's figures never include flagged rows: the corrected BUY shows as a difference.
    expect(summary.comparison?.positions.find((p) => p.key === WELT)).toMatchObject({
      quantity: { ledger: "10", file: "0", mismatch: true },
      mismatch: true,
    });
  });

  it("books a duplicate decided 'Trotzdem buchen'", async () => {
    const depotId = await depot();
    ok(await confirmParqetMigration(depotId, FIXTURE, DECIDED, db()));
    const decisions = await rerunDecisions(depotId);
    const summary = ok(await confirmParqetMigration(depotId, FIXTURE, { ...decisions, duplicates: { ...decisions.duplicates, 24: "book" } }, db()));
    expect(summary.booked.transactions).toBe(1);
    expect(summary.skipped.duplicates).toBe(7);
    const deposits = (await listTransactions(depotId, db())).filter((row) => row.type === "DEPOSIT" && row.date === "2024-01-02");
    expect(deposits).toHaveLength(2);
    expect(await db().transaction.count()).toBe(9);
  });

  it("books a TAX correction with only its tax and a DEPOSIT correction without Security", async () => {
    const depotId = await depot();
    const tax = withFlag("6", { type: "TAX", securityKey: APFEL, amount: "300", tax: "3,5" });
    const decisions = withFlag("7", { type: "DEPOSIT", amount: "20", securityKey: WELT, quantity: "1", price: "1" });
    const summary = ok(
      await confirmParqetMigration(depotId, FIXTURE, { ...decisions, flags: { ...decisions.flags, 6: tax.flags["6"] } }, db()),
    );
    expect(summary.booked.transactions).toBe(10);
    const rows = (await listTransactions(depotId, db())).filter((row) => row.date === "2024-06-03");
    expect(rows.find((row) => row.type === "TAX")).toMatchObject({
      amount: "0",
      fee: "0",
      tax: "3.5",
      quantity: null,
      price: null,
      security: { isin: APFEL },
    });
    expect(rows.find((row) => row.type === "DEPOSIT")).toMatchObject({ amount: "20", quantity: null, price: null, security: null });
  });

  it("uses the file's classification for a correction naming a file Security", async () => {
    const depotId = await depot();
    ok(await confirmParqetMigration(depotId, FIXTURE, withFlag("6", { securityKey: APFEL.toLowerCase(), securityName: "", assetType: "" }), db()));
    const rows = await listTransactions(depotId, db());
    expect(rows.filter((row) => row.date === "2024-06-03" && row.type === "BUY")[0].security).toMatchObject({ isin: APFEL, assetType: "STOCK" });
  });

  it("fails a bad correction with the ledger's reason for that flag and writes nothing", async () => {
    const depotId = await depot();
    expect(await confirmParqetMigration(depotId, FIXTURE, withFlag("6", { amount: "abc" }), db())).toEqual({
      ok: false,
      reason: "booking-failed",
      item: { kind: "flag", key: "6", records: [6], date: "2024-06-03", type: "BUY" },
      failure: { ok: false, reason: "amount-invalid" },
    });
    expect(await confirmParqetMigration(depotId, FIXTURE, withFlag("6", { securityName: "" }), db())).toMatchObject({
      reason: "booking-failed",
      item: { kind: "flag", key: "6" },
      failure: { reason: "security-name-invalid" },
    });
    expect(await confirmParqetMigration(depotId, FIXTURE, withFlag("6", { date: "2024-02-30" }), db())).toMatchObject({
      reason: "booking-failed",
      item: { kind: "flag", key: "6" },
      failure: { reason: "date-invalid" },
    });
    expect(await counts()).toEqual({ securities: 0, transactions: 0, corporateActions: 0 });
  });

  it("rolls everything back when a SELL exceeds the holding because its BUY was skipped", async () => {
    const depotId = await depot();
    const welt = await ensureSecurity({ isin: WELT }, { name: "Welt ETF", assetType: "ETF" }, db());
    if (!welt.ok) throw new Error("setup failed");
    for (const [type, date] of [["BUY", "2024-02-01"], ["SELL", "2024-02-02"]] as const) {
      const booked = await recordTransaction({ depotId, type, date, quantity: "10", price: "100", security: { id: welt.security.id } }, db());
      expect(booked.ok).toBe(true);
    }
    const text = [
      HEADER,
      `2024-03-01T09:00:00.000Z;100;5;500;0;0;;Sell;Security;${WELT};EUR;Welt ETF`,
      `2024-02-01T09:00:00.000Z;100;10;1000;0;0;;Buy;Security;${WELT};EUR;Welt ETF`,
      "2024-01-01T09:00:00.000Z;;;2000;;;;TransferIn;Cash;;EUR;Konto",
    ].join("\n");
    const before = await counts();
    const decisions = await rerunDecisions(depotId, text);
    expect(decisions.duplicates).toEqual({ 3: "skip" });
    expect(await confirmParqetMigration(depotId, text, decisions, db())).toEqual({
      ok: false,
      reason: "booking-failed",
      item: { kind: "proposal", key: "2", records: [2], date: "2024-03-01", type: "SELL" },
      failure: { ok: false, reason: "sell-exceeds-holding", available: "0" },
    });
    expect(await counts()).toEqual(before);
  });

  it("marks a sale whose Parqet gain differs by more than one cent", async () => {
    const depotId = await depot();
    const summary = ok(await confirmParqetMigration(depotId, FIXTURE.replace(";436,77;", ";436,79;"), DECIDED, db()));
    expect(summary.comparison?.sales[0].gain).toEqual({ ledger: "436.77", file: "436.79", mismatch: true });
  });

  it("refuses a Depot archived after the preview and writes nothing", async () => {
    const depotId = await depot();
    expect((await previewParqetMigration(depotId, FIXTURE, db())).ok).toBe(true);
    expect((await archiveDepot(depotId, db())).ok).toBe(true);
    expect(await confirmParqetMigration(depotId, FIXTURE, DECIDED, db())).toEqual({ ok: false, reason: "depot-archived" });
    expect(await confirmParqetMigration("nope", FIXTURE, DECIDED, db())).toEqual({ ok: false, reason: "depot-not-found" });
    expect(await counts()).toEqual({ securities: 0, transactions: 0, corporateActions: 0 });
  });

  it("passes file failures through", async () => {
    const depotId = await depot();
    expect(await confirmParqetMigration(depotId, "", DECIDED, db())).toEqual({ ok: false, reason: "empty-file" });
  });
});

describe("file without Cash rows", () => {
  const decisions: MigrationDecisions = { classifications: { [WELT]: "ETF" }, flags: {}, duplicates: {} };

  it("does not reconcile cash and offers an opening booking dated the earliest proposal", async () => {
    const depotId = await depot();
    const summary = ok(await confirmParqetMigration(depotId, NO_CASH, decisions, db()));
    expect(summary.comparison?.cash).toBeNull();
    expect(summary.openingBalance).toEqual({ date: "2024-02-01", asOf: "2024-05-02", ledgerBalance: "-1200" });
    expect(summary.comparison?.sales).toEqual([expect.objectContaining({ gain: { ledger: "0", file: "0", mismatch: false } })]);
  });

  it("books the difference to the entered balance as DEPOSIT/WITHDRAWAL, nothing at zero difference", async () => {
    const depotId = await depot();
    ok(await confirmParqetMigration(depotId, NO_CASH, decisions, db()));
    const opening = await recordOpeningBalance({ depotId, date: "2024-02-01", asOf: "2024-05-02", balance: "300" }, db());
    if (!opening.ok) throw new Error(opening.reason);
    expect(opening.transaction).toMatchObject({ type: "DEPOSIT", date: "2024-02-01", amount: "1500" });
    expect(opening.balance).toBe("300");

    expect(await recordOpeningBalance({ depotId, date: "2024-02-01", asOf: "2024-05-02", balance: "300" }, db())).toEqual({
      ok: true,
      transaction: null,
      balance: "300",
    });
    const lower = await recordOpeningBalance({ depotId, date: "2024-05-02", asOf: "2024-05-02", balance: "100" }, db());
    expect(lower).toMatchObject({ ok: true, transaction: { type: "WITHDRAWAL", amount: "200" }, balance: "100" });
  });

  it("validates the opening booking", async () => {
    const depotId = await depot();
    const base = { depotId, date: "2024-02-01", asOf: "2024-05-02", balance: "1" };
    expect(await recordOpeningBalance({ ...base, balance: "1,5" }, db())).toEqual({ ok: false, reason: "balance-invalid" });
    expect(await recordOpeningBalance({ ...base, date: "x" }, db())).toEqual({ ok: false, reason: "date-invalid" });
    expect(await recordOpeningBalance({ ...base, date: "2024-05-03" }, db())).toEqual({ ok: false, reason: "date-after-export" });
    expect(await recordOpeningBalance({ ...base, depotId: "nope" }, db())).toEqual({ ok: false, reason: "depot-not-found" });
    expect((await archiveDepot(depotId, db())).ok).toBe(true);
    expect(await recordOpeningBalance(base, db())).toEqual({ ok: false, reason: "depot-archived" });
  });
});
