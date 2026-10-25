import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import {
  archiveDepot,
  createDepot,
  ensureSecurity,
  listCashBookings,
  listIsinChanges,
  listPositions,
  listSplits,
  listTransactions,
  recordTransaction,
} from "@/modules/ledger";
import { cashBalance } from "@/core/cash";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { confirmParqetMigration, type ConfirmResult, recordOpeningBalance } from "./confirm";
import {
  type Correction,
  EMPTY_DECISIONS,
  initialDecisions,
  type MigrationDecisions,
  openDecisions,
  parqetAsIsDecisions,
} from "./decisions";
import { previewParqetMigration } from "./preview";

const FIXTURE = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export.csv.txt"), "utf8");
const NO_CASH = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export-no-cash.csv.txt"), "utf8");
const CASHLESS = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export-cashless.csv.txt"), "utf8");
const HANDS_OFF = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export-hands-off.csv.txt"), "utf8");

const OLD = "DE0007164600";
const NEW = "DE000SYN0013";
const APFEL = "US0378331005";
const WELT = "IE00B4L5Y983";
const FLAG_KEYS = ["2", "3", "4-5", "7", "8"];

/** Explicit decisions for the fixture: skip every flag (same as no decision), types as estimated. */
const DECIDED: MigrationDecisions = {
  classifications: {},
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
    expect(summary.exportDate).toBe("2024-07-03");
    expect(summary.booked).toEqual({ transactions: 10, splits: 0, isinChanges: 1, securities: 5 });
    expect(summary.skipped).toEqual({ duplicates: 0, flags: 5, splits: 0, isinChanges: 0 });
    expect(summary.skippedFlags).toEqual([
      { key: "2", records: [2], reason: "unsupported-row", detail: "Buy/Cash" },
      { key: "3", records: [3], reason: "unparseable", detail: "datetime" },
      { key: "4-5", records: [4, 5], reason: "cash-pair-mismatch" },
      { key: "7", records: [7], reason: "unparseable", detail: "shares" },
      { key: "8", records: [8], reason: "non-eur", detail: "USD" },
    ]);
    const comparison = summary.comparison!;
    expect(comparison.positions.map((p) => [p.key, p.quantity.ledger, p.costBasis.ledger, p.mismatch])).toEqual([
      [APFEL, "5", "62.23", false],
      ["BTC", "0.00012345", "4.938", false],
      [NEW, "6.00172839", "1201.335678", false],
      [WELT, "3", "300", false],
    ]);
    expect(comparison.investedCapital).toEqual({ ledger: "1568.503678", file: "1568.503678", mismatch: false });
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
    expect(rows).toHaveLength(10);
    expect(rows.find((row) => row.type === "BUY" && row.security?.isin === OLD)?.security?.assetType).toBe("STOCK");
    // The delivery: DEPOSIT then BUY on the same date, cash unchanged.
    expect(rows.filter((row) => row.date === "2024-07-03").sort((a, b) => a.sequence - b.sequence).map((row) => [row.type, row.sequence, row.amount, row.security?.isin ?? null])).toEqual([
      ["DEPOSIT", 1, "300", null],
      ["BUY", 2, "300", WELT],
    ]);
    expect(rows.find((row) => row.security?.isin === WELT)?.security?.assetType).toBe("ETF");
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
    expect(preview.preview.duplicates.map((d) => d.status)).toEqual(Array(10).fill("duplicate"));
    expect(preview.preview.duplicates.map((d) => d.key).slice(-2)).toEqual(["6d", "6"]);
    expect(preview.preview.isinChanges[0].recorded).toBe(true);

    const summary = ok(await confirmParqetMigration(depotId, FIXTURE, await rerunDecisions(depotId), db()));
    expect(summary.booked).toEqual({ transactions: 0, splits: 0, isinChanges: 0, securities: 0 });
    expect(summary.skipped).toEqual({ duplicates: 10, flags: 5, splits: 0, isinChanges: 1 });
    // The skipped SELL is still reconciled through its single match.
    expect(summary.comparison?.sales.map((sale) => sale.gain.mismatch)).toEqual([false]);
    expect(summary.comparison?.positions.some((p) => p.mismatch)).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it("books the same file normally for another Depot (the recorded ISIN change is not booked again)", async () => {
    ok(await confirmParqetMigration(await depot(), FIXTURE, DECIDED, db()));
    const second = await depot("Zweitdepot");
    const summary = ok(await confirmParqetMigration(second, FIXTURE, await rerunDecisions(second), db()));
    expect(summary.booked).toEqual({ transactions: 10, splits: 0, isinChanges: 0, securities: 0 });
    expect(summary.skipped.isinChanges).toBe(1);
    expect(summary.comparison?.positions.some((p) => p.mismatch)).toBe(false);
    expect(summary.comparison?.cash?.mismatch).toBe(false);
  });

  it("returns decisions-open with a fresh preview and writes nothing while a duplicate is undecided", async () => {
    const depotId = await depot();
    // A duplicate that appeared since the preview is open.
    expect((await recordTransaction({ depotId, type: "DEPOSIT", date: "2024-01-02", amount: "10000" }, db())).ok).toBe(true);
    const before = await counts();
    const result = await confirmParqetMigration(depotId, FIXTURE, DECIDED, db());
    expect(result).toMatchObject({ ok: false, reason: "decisions-open", open: [{ kind: "duplicate", key: "24" }] });
    expect(result.ok === false && result.reason === "decisions-open" && result.preview.depot.id).toBe(depotId);
    expect(await counts()).toEqual(before);
  });

  it("books with the estimated types unless overridden, skipping undecided flags", async () => {
    const depotId = await depot();
    const summary = ok(
      await confirmParqetMigration(depotId, FIXTURE, { ...EMPTY_DECISIONS, classifications: { [APFEL]: "FUND" } }, db()),
    );
    expect(summary.skipped.flags).toBe(5);
    const types = new Map((await listTransactions(depotId, db())).flatMap((row) => (row.security ? [[row.security.isin, row.security.assetType]] : [])));
    expect(types.get(APFEL)).toBe("FUND");
    expect(types.get(WELT)).toBe("ETF");
    expect(types.get(OLD)).toBe("STOCK");
    expect(types.get(null)).toBe("CRYPTO");
  });

  it("books a corrected flag after that date's proposals", async () => {
    const depotId = await depot();
    const summary = ok(await confirmParqetMigration(depotId, FIXTURE, withFlag("8", {}), db()));
    expect(summary.booked.transactions).toBe(11);
    expect(summary.skipped.flags).toBe(4);
    const rows = await listTransactions(depotId, db());
    const onDate = rows.filter((row) => row.date === "2024-06-03").sort((a, b) => a.sequence - b.sequence);
    expect(onDate.map((row) => [row.type, row.sequence])).toEqual([
      ["SELL", 1],
      ["BUY", 2],
    ]);
    expect(onDate[1]).toMatchObject({ quantity: "10", price: "5", amount: "50", security: { isin: WELT, name: "Welt ETF", assetType: "ETF" } });
    // The file's figures never include flagged rows: the corrected BUY shows as a difference.
    expect(summary.comparison?.positions.find((p) => p.key === WELT)).toMatchObject({
      quantity: { ledger: "13", file: "3", mismatch: true },
      mismatch: true,
    });
  });

  it("books a duplicate decided 'Trotzdem buchen'", async () => {
    const depotId = await depot();
    ok(await confirmParqetMigration(depotId, FIXTURE, DECIDED, db()));
    const decisions = await rerunDecisions(depotId);
    const summary = ok(await confirmParqetMigration(depotId, FIXTURE, { ...decisions, duplicates: { ...decisions.duplicates, 24: "book" } }, db()));
    expect(summary.booked.transactions).toBe(1);
    expect(summary.skipped.duplicates).toBe(9);
    const deposits = (await listTransactions(depotId, db())).filter((row) => row.type === "DEPOSIT" && row.date === "2024-01-02");
    expect(deposits).toHaveLength(2);
    expect(await db().transaction.count()).toBe(11);
  });

  it("books a TAX correction with only its tax and a DEPOSIT correction without Security", async () => {
    const depotId = await depot();
    const tax = withFlag("8", { type: "TAX", securityKey: APFEL, amount: "300", tax: "3,5" });
    const decisions = withFlag("7", { type: "DEPOSIT", amount: "20", securityKey: WELT, quantity: "1", price: "1" });
    const summary = ok(
      await confirmParqetMigration(depotId, FIXTURE, { ...decisions, flags: { ...decisions.flags, 8: tax.flags["8"] } }, db()),
    );
    expect(summary.booked.transactions).toBe(12);
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
    ok(await confirmParqetMigration(depotId, FIXTURE, withFlag("8", { securityKey: APFEL.toLowerCase(), securityName: "", assetType: "" }), db()));
    const rows = await listTransactions(depotId, db());
    expect(rows.filter((row) => row.date === "2024-06-03" && row.type === "BUY")[0].security).toMatchObject({ isin: APFEL, assetType: "STOCK" });
  });

  it("fails a bad correction with the ledger's reason for that flag and writes nothing", async () => {
    const depotId = await depot();
    expect(await confirmParqetMigration(depotId, FIXTURE, withFlag("8", { amount: "abc" }), db())).toEqual({
      ok: false,
      reason: "booking-failed",
      item: { kind: "flag", key: "8", records: [8], date: "2024-06-03", type: "BUY" },
      failure: { ok: false, reason: "amount-invalid" },
    });
    expect(
      await confirmParqetMigration(depotId, FIXTURE, withFlag("8", { securityKey: "DE000SYNC014", securityName: "" }), db()),
    ).toMatchObject({
      reason: "booking-failed",
      item: { kind: "flag", key: "8" },
      failure: { reason: "security-name-invalid" },
    });
    expect(await confirmParqetMigration(depotId, FIXTURE, withFlag("8", { date: "2024-02-30" }), db())).toMatchObject({
      reason: "booking-failed",
      item: { kind: "flag", key: "8" },
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

  it("'Alle wie in Parqet übernehmen' books bookable flags as Parqet has them and skips the rest", async () => {
    const depotId = await depot();
    const preview = await previewParqetMigration(depotId, FIXTURE, db());
    if (!preview.ok) throw new Error(preview.reason);
    const summary = ok(await confirmParqetMigration(depotId, FIXTURE, parqetAsIsDecisions(preview.preview, EMPTY_DECISIONS), db()));
    // Only the cash-pair mismatch (an EUR Buy of a file Security) is bookable as-is.
    expect(summary.booked.transactions).toBe(11);
    expect(summary.skippedFlags.map((flag) => flag.key)).toEqual(["2", "3", "7", "8"]);
    const buy = (await listTransactions(depotId, db())).find((row) => row.date === "2024-07-04");
    expect(buy).toMatchObject({ type: "BUY", quantity: "10", price: "9.9", amount: "99", fee: "1", security: { isin: APFEL } });
  });

  it("'Alle wie in Parqet übernehmen' fails atomically when a flag's SELL exceeds the holding", async () => {
    const depotId = await depot();
    const text = [
      HEADER,
      `2024-03-01T09:00:00.000Z;0;5;0;0;0;;TransferOut;Security;${APFEL};EUR;Apfel`,
      `2024-02-01T09:00:00.000Z;10;1;10;0;0;;Buy;Security;${APFEL};EUR;Apfel`,
    ].join("\n");
    const preview = await previewParqetMigration(depotId, text, db());
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.preview.flagged).toEqual([expect.objectContaining({ records: [2], reason: "unpaired-security-transfer" })]);
    expect(await confirmParqetMigration(depotId, text, parqetAsIsDecisions(preview.preview, EMPTY_DECISIONS), db())).toEqual({
      ok: false,
      reason: "booking-failed",
      item: { kind: "flag", key: "2", records: [2], date: "2024-03-01", type: "SELL" },
      failure: { ok: false, reason: "sell-exceeds-holding", available: "1" },
    });
    expect(await counts()).toEqual({ securities: 0, transactions: 0, corporateActions: 0 });
  });

  it("books a split pair from the file before that date's Transactions and does not book it again", async () => {
    const depotId = await depot();
    const text = [
      HEADER,
      `2024-06-01T09:00:00.000Z;3;40;120;0;0;;Sell;Security;${APFEL};EUR;Apfel`,
      `2024-06-01T00:00:00.000Z;0;40;0;0;0;;TransferIn;Security;${APFEL};EUR;Apfel`,
      `2024-06-01T00:00:00.000Z;0;10;0;0;0;;TransferOut;Security;${APFEL};EUR;Apfel`,
      `2024-02-01T09:00:00.000Z;40;10;400;0;0;;Buy;Security;${APFEL};EUR;Apfel`,
    ].join("\n");
    const summary = ok(await confirmParqetMigration(depotId, text, EMPTY_DECISIONS, db()));
    // No Cash rows: the Buy gets a funding DEPOSIT of 400.
    expect(summary.booked).toEqual({ transactions: 3, splits: 1, isinChanges: 0, securities: 1 });
    expect(await listSplits(db())).toEqual([expect.objectContaining({ date: "2024-06-01", ratioOld: "1", ratioNew: "4" })]);
    expect(summary.comparison?.positions).toEqual([]);

    const again = await previewParqetMigration(depotId, text, db());
    if (!again.ok) throw new Error(again.reason);
    expect(again.preview.splits[0].recorded).toBe(true);
    const rerun = ok(await confirmParqetMigration(depotId, text, initialDecisions(again.preview), db()));
    expect(rerun.booked).toEqual({ transactions: 0, splits: 0, isinChanges: 0, securities: 0 });
    expect(rerun.skipped).toMatchObject({ duplicates: 3, splits: 1 });
  });

  it("names a failing split", async () => {
    const depotId = await depot();
    const apple = await ensureSecurity({ isin: APFEL }, { name: "Apfel", assetType: "STOCK" }, db());
    if (!apple.ok) throw new Error("setup failed");
    // A later SELL in another Depot that a reverse split would oversell.
    const other = await depot("Zweitdepot");
    for (const [type, date] of [["BUY", "2024-01-01"], ["SELL", "2024-07-01"]] as const) {
      const booked = await recordTransaction({ depotId: other, type, date, quantity: "10", price: "1", security: { id: apple.security.id } }, db());
      expect(booked.ok).toBe(true);
    }
    const text = [
      HEADER,
      `2024-06-01T00:00:00.000Z;0;1;0;0;0;;TransferIn;Security;${APFEL};EUR;Apfel`,
      `2024-06-01T00:00:00.000Z;0;10;0;0;0;;TransferOut;Security;${APFEL};EUR;Apfel`,
    ].join("\n");
    expect(await confirmParqetMigration(depotId, text, EMPTY_DECISIONS, db())).toEqual({
      ok: false,
      reason: "booking-failed",
      item: { kind: "split", key: "2-3", records: [2, 3], date: "2024-06-01", securityKey: APFEL, ratio: "10:1" },
      failure: { ok: false, reason: "later-sell-exceeds-holding", date: "2024-07-01" },
    });
  });
});

describe("hands-off fixture (story 2-5)", () => {
  const F1 = "LU000SYNF017";
  const F2 = "LU000SYNF025";
  const F3 = "LU000SYNF033";
  const E1 = "IE000SYNE015";
  const C1 = "DE000SYNC014";
  const S1 = "DE000SYNS010";

  it("previews into an empty Depot with zero open decisions and books to the expected figures", async () => {
    const depotId = await depot();
    const preview = await previewParqetMigration(depotId, HANDS_OFF, db());
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.preview.flagged).toEqual([]);
    expect(openDecisions(preview.preview, initialDecisions(preview.preview))).toEqual([]);
    expect(openDecisions(preview.preview, EMPTY_DECISIONS)).toEqual([]);
    expect(preview.preview.splits).toEqual([expect.objectContaining({ key: S1, ratioOld: "1", ratioNew: "4", recorded: false })]);
    expect(preview.preview.deliveries.map((delivery) => delivery.securityKey).sort()).toEqual([C1, E1, F1, F2, F3].sort());
    expect(Object.fromEntries(preview.preview.securities.map((s) => [s.key, s.assetType]))).toEqual({
      [F1]: "FUND",
      [F2]: "FUND",
      [F3]: "FUND",
      [E1]: "ETF",
      [C1]: "ETF",
      [S1]: "STOCK",
    });

    const summary = ok(await confirmParqetMigration(depotId, HANDS_OFF, EMPTY_DECISIONS, db()));
    expect(summary.booked).toEqual({ transactions: 14, splits: 1, isinChanges: 0, securities: 6 });
    expect(summary.skippedFlags).toEqual([]);

    // Hand-computed: deliveries at Parqet's cost; S1 bought 10 for 1.001 €, split 1:4, 20 of 40 sold; F3 half sold.
    const positions = await listPositions(depotId, "2022-06-01", db());
    expect(Object.fromEntries(positions.map((p) => [p.security.isin, [p.quantity, p.costBasis, p.security.assetType]]))).toEqual({
      [F1]: ["10", "500", "FUND"],
      [F2]: ["20", "500", "FUND"],
      [F3]: ["50", "500", "FUND"],
      [E1]: ["40", "1000", "ETF"],
      [C1]: ["5", "502.5", "ETF"],
      [S1]: ["20", "500.5", "STOCK"],
    });
    const invested = positions.reduce((sum, p) => sum.plus(p.costBasis), new ExactDecimal(0));
    expect(canonicalDecimal(invested)).toBe("3503");
    // 10.000 − 1.001 + 599 + 600; the deliveries leave cash unchanged.
    expect(cashBalance(await listTransactions(depotId, db()), "2022-06-01")).toBe("10198");

    const comparison = summary.comparison!;
    expect(comparison.positions.some((p) => p.mismatch)).toBe(false);
    expect(comparison.investedCapital).toEqual({ ledger: "3503", file: "3503", mismatch: false });
    expect(comparison.cash).toEqual({ ledger: "10198", file: "10198", mismatch: false });
    expect(comparison.sales.map((sale) => [sale.securityKey, sale.gain.mismatch])).toEqual([
      [S1, false],
      [F3, false],
    ]);
  });
});

describe("file without Cash rows", () => {
  const decisions: MigrationDecisions = { classifications: { [WELT]: "ETF" }, flags: {}, duplicates: {} };

  it("funds the buy, does not reconcile cash and offers an opening booking dated the export date", async () => {
    const depotId = await depot();
    const summary = ok(await confirmParqetMigration(depotId, NO_CASH, decisions, db()));
    expect(summary.booked.transactions).toBe(3);
    expect(summary.comparison?.cash).toBeNull();
    expect(summary.openingBalance).toEqual({ date: "2024-05-02", asOf: "2024-05-02", ledgerBalance: "300" });
    // listTransactions is newest first.
    expect((await listTransactions(depotId, db())).map((row) => [row.type, row.date, row.amount])).toEqual([
      ["SELL", "2024-05-02", "300"],
      ["BUY", "2024-02-01", "1500"],
      ["DEPOSIT", "2024-02-01", "1500"],
    ]);
    expect(summary.comparison?.sales).toEqual([expect.objectContaining({ gain: { ledger: "0", file: "0", mismatch: false } })]);
  });

  it("books the difference to the entered balance as DEPOSIT/WITHDRAWAL, nothing at zero difference", async () => {
    const depotId = await depot();
    ok(await confirmParqetMigration(depotId, NO_CASH, decisions, db()));
    const opening = await recordOpeningBalance({ depotId, date: "2024-05-02", asOf: "2024-05-02", balance: "450" }, db());
    if (!opening.ok) throw new Error(opening.reason);
    expect(opening.transaction).toMatchObject({ type: "DEPOSIT", date: "2024-05-02", amount: "150" });
    expect(opening.balance).toBe("450");

    expect(await recordOpeningBalance({ depotId, date: "2024-05-02", asOf: "2024-05-02", balance: "450" }, db())).toEqual({
      ok: true,
      transaction: null,
      balance: "450",
    });
    const lower = await recordOpeningBalance({ depotId, date: "2024-05-02", asOf: "2024-05-02", balance: "100" }, db());
    expect(lower).toMatchObject({ ok: true, transaction: { type: "WITHDRAWAL", amount: "350" }, balance: "100" });
  });

  it("funds a cash-less export minimally, never goes negative and aligns to the broker's balance at the export date", async () => {
    const depotId = await depot();
    const preview = await previewParqetMigration(depotId, CASHLESS, db());
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.preview.hasCashRows).toBe(false);
    expect(preview.preview.fundingCount).toBe(3);
    expect(preview.preview.figures?.cashBalance).toBe("0");

    const summary = ok(await confirmParqetMigration(depotId, CASHLESS, EMPTY_DECISIONS, db()));
    expect(summary.booked).toMatchObject({ transactions: 9, securities: 3 });
    const rows = (await listTransactions(depotId, db())).reverse();
    expect(rows.filter((row) => row.type === "DEPOSIT").map((row) => [row.date, row.amount])).toEqual([
      ["2024-01-10", "1005"],
      ["2024-02-15", "1000"],
      ["2024-06-01", "392"],
    ]);
    const bookings = await listCashBookings(depotId, db());
    expect(bookings.every((booking) => !new ExactDecimal(booking.balance).isNegative())).toBe(true);
    expect(cashBalance(rows, "2024-06-01")).toBe("0");

    const comparison = summary.comparison!;
    expect(comparison.positions.some((position) => position.mismatch)).toBe(false);
    expect(comparison.investedCapital.mismatch).toBe(false);
    expect(comparison.sales.map((sale) => [sale.gain.ledger, sale.gain.mismatch])).toEqual([["92.5", false]]);
    expect(summary.openingBalance).toEqual({ date: "2024-06-01", asOf: "2024-06-01", ledgerBalance: "0" });

    const opening = await recordOpeningBalance({ depotId, date: "2024-06-01", asOf: "2024-06-01", balance: "150" }, db());
    expect(opening).toMatchObject({ ok: true, transaction: { type: "DEPOSIT", date: "2024-06-01", amount: "150" }, balance: "150" });
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
