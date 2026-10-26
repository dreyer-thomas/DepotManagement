import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import {
  archiveDepot,
  bookReconciliationCorrection,
  createDepot,
  deleteDepot,
  ensureSecurity,
  finishReconciliation,
  getReconciliation,
  listPositions,
  listRealizedSales,
  listTransactions,
  openReconciliation,
  recordTransaction,
  type RecordTransactionInput,
  saveReconciliationRow,
} from "./index";

const TODAY = "2026-10-26";
const STATEMENT = "2026-10-20";

let testDb: TestDatabase;
let depotId: string;
let alphaId: string;
let betaId: string;

const db = () => testDb.client;

beforeEach(async () => {
  testDb = createTestDatabase();
  const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, db());
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
  const alpha = await ensureSecurity({ isin: "DE000SYNCA09" }, { name: "Synthetic Alpha AG", assetType: "STOCK" }, db());
  const beta = await ensureSecurity({ isin: "DE000SYNCB08" }, { name: "Synthetic Beta AG", assetType: "STOCK" }, db());
  if (!alpha.ok || !beta.ok) throw new Error("setup failed");
  alphaId = alpha.security.id;
  betaId = beta.security.id;
});

afterEach(async () => {
  await testDb.cleanup();
});

async function book(input: Omit<RecordTransactionInput, "depotId">) {
  const result = await recordTransaction({ depotId, ...input }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.transaction;
}

async function seed() {
  await book({ type: "DEPOSIT", date: "2026-01-01", amount: "1100" });
  await book({ type: "BUY", date: "2026-01-02", quantity: "10", price: "100", security: { id: alphaId } });
  await book({ type: "BUY", date: "2026-01-03", quantity: "5", price: "0", security: { id: betaId } });
}

async function open(statementDate = STATEMENT) {
  const result = await openReconciliation(depotId, statementDate, TODAY, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.runId;
}

describe("openReconciliation / getReconciliation", () => {
  it("lists the Positions held on the statement date plus the Cash Account; entries persist", async () => {
    await seed();
    expect(await getReconciliation(depotId, db())).toEqual({ run: null, lastReconciled: null });
    const runId = await open();
    expect(await saveReconciliationRow(runId, alphaId, { statementValue: "12" }, db())).toEqual({ ok: true });
    expect(await saveReconciliationRow(runId, betaId, { checked: true }, db())).toEqual({ ok: true });
    const { run } = await getReconciliation(depotId, db());
    expect(run).toMatchObject({ id: runId, depotId, statementDate: STATEMENT, progress: { reconciled: 1, total: 3 } });
    expect(run!.rows.map((row) => [row.security?.name ?? null, row.appValue, row.statementValue, row.checked, row.status, row.difference])).toEqual([
      ["Synthetic Alpha AG", "10", "12", false, "difference", "2"],
      ["Synthetic Beta AG", "5", null, true, "reconciled", null],
      [null, "100", null, false, "open", null],
    ]);
    expect(run!.rows[0].defaultUnitCost).toBe("100");
  });

  it("refuses a second open run, a future or invalid date and an archived or unknown Depot", async () => {
    await open();
    expect(await openReconciliation(depotId, "2026-10-01", TODAY, db())).toEqual({ ok: false, reason: "run-open" });
    const other = await createDepot({ name: "Zweitdepot", broker: "COMDIRECT" }, db());
    if (!other.ok) throw new Error("setup failed");
    expect(await openReconciliation(other.depot.id, "2026-10-27", TODAY, db())).toEqual({ ok: false, reason: "date-in-future" });
    expect(await openReconciliation(other.depot.id, "2026-13-01", TODAY, db())).toEqual({ ok: false, reason: "date-invalid" });
    expect(await openReconciliation("missing", TODAY, TODAY, db())).toEqual({ ok: false, reason: "depot-not-found" });
    await archiveDepot(other.depot.id, db());
    expect(await openReconciliation(other.depot.id, TODAY, TODAY, db())).toEqual({ ok: false, reason: "depot-archived" });
  });
});

describe("saveReconciliationRow", () => {
  it("validates values: Positions ≥ 0 with ≤ 8 decimals, cash any decimal; clears with empty", async () => {
    await seed();
    const runId = await open();
    expect(await saveReconciliationRow(runId, alphaId, { statementValue: "-1" }, db())).toEqual({ ok: false, reason: "value-invalid" });
    expect(await saveReconciliationRow(runId, alphaId, { statementValue: "1.123456789" }, db())).toEqual({ ok: false, reason: "value-invalid" });
    expect(await saveReconciliationRow(runId, alphaId, { statementValue: "abc" }, db())).toEqual({ ok: false, reason: "value-invalid" });
    expect(await saveReconciliationRow(runId, null, { statementValue: "-12.345" }, db())).toEqual({ ok: true });
    expect(await saveReconciliationRow(runId, null, { statementValue: "100.00" }, db())).toEqual({ ok: true });
    expect(await saveReconciliationRow(runId, alphaId, { statementValue: "10" }, db())).toEqual({ ok: true });
    expect(await saveReconciliationRow(runId, alphaId, { statementValue: "" }, db())).toEqual({ ok: true });
    const { run } = await getReconciliation(depotId, db());
    expect(run!.rows.map((row) => row.statementValue)).toEqual([null, null, "100"]);
    expect(await testDb.client.reconciliationRow.count({ where: { runId, securityId: null } })).toBe(1);
  });

  it("refuses an unknown run, a Security never held on the statement date and a finished run", async () => {
    await seed();
    const runId = await open("2026-01-02");
    expect(await saveReconciliationRow("missing", null, { checked: true }, db())).toEqual({ ok: false, reason: "run-not-found" });
    expect(await saveReconciliationRow(runId, betaId, { checked: true }, db())).toEqual({ ok: false, reason: "row-not-found" });
    await finishReconciliation(runId, "2026-10-26T10:00:00.000Z", db());
    expect(await saveReconciliationRow(runId, alphaId, { checked: true }, db())).toEqual({ ok: false, reason: "run-finished" });
  });

  it("cash sub-cent: app 100.004, statement 100,00 is reconciled", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-01", amount: "100.004" });
    const runId = await open();
    await saveReconciliationRow(runId, null, { statementValue: "100.00" }, db());
    const { run } = await getReconciliation(depotId, db());
    expect(run!.rows).toMatchObject([{ securityId: null, status: "reconciled" }]);
  });
});

describe("bookReconciliationCorrection", () => {
  it("Position +: ADJUSTMENT at the average purchase price; cash and realized gain unchanged; row ✅", async () => {
    await seed();
    const runId = await open();
    await saveReconciliationRow(runId, alphaId, { statementValue: "12" }, db());
    const result = await bookReconciliationCorrection(runId, alphaId, undefined, db());
    expect(result).toMatchObject({
      ok: true,
      transaction: { type: "ADJUSTMENT", date: STATEMENT, quantity: "2", price: "100", amount: "0", note: null },
    });
    const [position] = await listPositions(depotId, TODAY, db());
    expect(position).toMatchObject({ quantity: "12", costBasis: "1200" });
    expect(await listRealizedSales(depotId, TODAY, db())).toEqual([]);
    const { run } = await getReconciliation(depotId, db());
    expect(run!.rows[0]).toMatchObject({ appValue: "12", status: "reconciled" });
    expect(run!.rows[2].appValue).toBe("100");
  });

  it("Position +: an entered unit cost wins and must not be negative", async () => {
    await seed();
    const runId = await open();
    await saveReconciliationRow(runId, alphaId, { statementValue: "11" }, db());
    expect(await bookReconciliationCorrection(runId, alphaId, "-1", db())).toEqual({ ok: false, reason: "price-invalid" });
    expect(await bookReconciliationCorrection(runId, alphaId, "80.5", db())).toMatchObject({ ok: true, transaction: { price: "80.5" } });
  });

  it("held position corrected to 0: the saved row stays and matches", async () => {
    await seed();
    const runId = await open();
    await saveReconciliationRow(runId, betaId, { statementValue: "0" }, db());
    expect(await bookReconciliationCorrection(runId, betaId, undefined, db())).toMatchObject({
      ok: true,
      transaction: { quantity: "-5", price: null },
    });
    const { run } = await getReconciliation(depotId, db());
    expect(run!.rows.find((row) => row.securityId === betaId)).toMatchObject({ appValue: "0", statementValue: "0", status: "reconciled" });
    // A positive correction of a no-longer-held Security has no average price.
    await saveReconciliationRow(runId, betaId, { statementValue: "1" }, db());
    expect(await bookReconciliationCorrection(runId, betaId, undefined, db())).toEqual({ ok: false, reason: "price-invalid" });
  });

  it("a negative correction a later sell needs is refused by the holding guard", async () => {
    await seed();
    await book({ type: "SELL", date: "2026-10-22", quantity: "8", price: "100", security: { id: alphaId } });
    const runId = await open();
    await saveReconciliationRow(runId, alphaId, { statementValue: "7" }, db());
    expect(await bookReconciliationCorrection(runId, alphaId, undefined, db())).toEqual({
      ok: false,
      reason: "sell-exceeds-holding",
      available: "2",
    });
  });

  it("Cash: DEPOSIT or WITHDRAWAL of the exact difference with note Kontoabgleich", async () => {
    await book({ type: "DEPOSIT", date: "2026-01-01", amount: "100" });
    const runId = await open();
    await saveReconciliationRow(runId, null, { statementValue: "112.34" }, db());
    expect(await bookReconciliationCorrection(runId, null, undefined, db())).toMatchObject({
      ok: true,
      transaction: { type: "DEPOSIT", date: STATEMENT, amount: "12.34", note: "Kontoabgleich" },
    });
    expect((await getReconciliation(depotId, db())).run!.rows[0]).toMatchObject({ appValue: "112.34", status: "reconciled" });
    await saveReconciliationRow(runId, null, { statementValue: "100.001" }, db());
    expect(await bookReconciliationCorrection(runId, null, undefined, db())).toMatchObject({
      ok: true,
      transaction: { type: "WITHDRAWAL", amount: "12.339", note: "Kontoabgleich" },
    });
  });

  it("no-difference without a statement value or when it matches", async () => {
    await seed();
    const runId = await open();
    expect(await bookReconciliationCorrection(runId, alphaId, undefined, db())).toEqual({ ok: false, reason: "no-difference" });
    await saveReconciliationRow(runId, alphaId, { statementValue: "10" }, db());
    expect(await bookReconciliationCorrection(runId, alphaId, undefined, db())).toEqual({ ok: false, reason: "no-difference" });
    await saveReconciliationRow(runId, null, { statementValue: "100.004" }, db());
    expect(await bookReconciliationCorrection(runId, null, undefined, db())).toEqual({ ok: false, reason: "no-difference" });
    expect(await listTransactions(depotId, db())).toHaveLength(3);
  });
});

describe("finishReconciliation", () => {
  it("finishes with open rows; the Depot shows the statement date and the next run starts empty", async () => {
    await seed();
    const runId = await open();
    await saveReconciliationRow(runId, alphaId, { statementValue: "10" }, db());
    expect(await finishReconciliation(runId, "2026-10-26T10:00:00.000Z", db())).toEqual({ ok: true, statementDate: STATEMENT });
    expect(await finishReconciliation(runId, "2026-10-26T10:00:00.000Z", db())).toEqual({ ok: false, reason: "run-finished" });
    expect(await getReconciliation(depotId, db())).toEqual({ run: null, lastReconciled: STATEMENT });
    const next = await open(TODAY);
    const { run, lastReconciled } = await getReconciliation(depotId, db());
    expect(run!.id).toBe(next);
    expect(run!.rows.every((row) => row.statementValue === null && !row.checked)).toBe(true);
    expect(lastReconciled).toBe(STATEMENT);
  });

  it("an archived Depot's run is read-only", async () => {
    const runId = await open();
    await archiveDepot(depotId, db());
    expect(await finishReconciliation(runId, "2026-10-26T10:00:00.000Z", db())).toEqual({ ok: false, reason: "depot-archived" });
    expect(await saveReconciliationRow(runId, null, { checked: true }, db())).toEqual({ ok: false, reason: "depot-archived" });
  });

  it("deleting the Depot removes its runs and rows", async () => {
    await seed();
    const runId = await open();
    await saveReconciliationRow(runId, alphaId, { statementValue: "10" }, db());
    expect((await deleteDepot(depotId, db())).ok).toBe(true);
    expect(await testDb.client.reconciliationRun.count()).toBe(0);
    expect(await testDb.client.reconciliationRow.count()).toBe(0);
  });
});
