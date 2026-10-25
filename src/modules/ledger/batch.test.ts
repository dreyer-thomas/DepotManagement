import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { type BatchEntry, type BatchSecurity, recordBatch } from "./batch";
import { archiveDepot, createDepot, ensureSecurity, listIsinChanges, listTransactions } from "./index";

let testDb: TestDatabase;
let depotId: string;
const db = () => testDb.client;

const OLD = "DE0007164600";
const NEW = "DE000SYN0013";

const SECURITIES: BatchSecurity[] = [
  { ref: "old", identifier: { isin: OLD }, details: { name: "Altname", assetType: "STOCK" } },
  { ref: "new", identifier: { isin: NEW }, details: { name: "Neuname", assetType: "STOCK" } },
];

const buy = (ref: string, date: string, quantity = "10"): BatchEntry => ({
  kind: "transaction",
  ref,
  securityRef: "old",
  input: { type: "BUY", date, quantity, price: "10", allowDuplicate: true },
});

async function counts() {
  return {
    securities: await db().security.count(),
    transactions: await db().transaction.count(),
    corporateActions: await db().corporateAction.count(),
  };
}

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
  const depot = await createDepot({ name: "Hauptdepot", broker: "FINANZEN_ZERO" }, db());
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
});

describe("recordBatch", () => {
  it("ensures Securities and books Transactions and ISIN changes in order, returning them by ref", async () => {
    const existing = await ensureSecurity({ isin: OLD }, { name: "Gespeichert", assetType: "ETF" }, db());
    if (!existing.ok) throw new Error("setup failed");
    const result = await recordBatch(
      {
        depotId,
        securities: SECURITIES,
        entries: [
          { kind: "transaction", ref: "d", securityRef: null, input: { type: "DEPOSIT", date: "2024-01-01", amount: "500" } },
          buy("b1", "2024-01-02"),
          buy("b2", "2024-01-02", "2"),
          { kind: "isin-change", ref: "i", oldSecurityRef: "old", newSecurityRef: "new", date: "2024-02-01", oldQuantity: "12", newQuantity: "6" },
          { kind: "transaction", ref: "s", securityRef: "new", input: { type: "SELL", date: "2024-03-01", quantity: "6", price: "30" } },
        ],
      },
      db(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result));
    // An existing Security is reused unchanged.
    expect(result.securities.old).toEqual(existing.security);
    expect(result.securities.new).toMatchObject({ isin: NEW, name: "Neuname", assetType: "STOCK" });
    expect(result.transactions.b1).toMatchObject({ type: "BUY", date: "2024-01-02", sequence: 1 });
    expect(result.transactions.b2).toMatchObject({ type: "BUY", date: "2024-01-02", sequence: 2, quantity: "2" });
    expect(result.transactions.s.security?.isin).toBe(NEW);
    expect(result.isinChanges.i).toMatchObject({ date: "2024-02-01", oldQuantity: "12", newQuantity: "6" });
    expect(await listTransactions(depotId, db())).toHaveLength(4);
    expect(await listIsinChanges(db())).toHaveLength(1);
  });

  it("rolls everything back on the first failing entry and names it", async () => {
    const before = await counts();
    const result = await recordBatch(
      {
        depotId,
        securities: SECURITIES,
        entries: [
          buy("b1", "2024-01-02"),
          { kind: "transaction", ref: "s", securityRef: "old", input: { type: "SELL", date: "2024-01-03", quantity: "11", price: "10" } },
          buy("never", "2024-01-04"),
        ],
      },
      db(),
    );
    expect(result).toEqual({ ok: false, ref: "s", failure: { ok: false, reason: "sell-exceeds-holding", available: "10" } });
    expect(await counts()).toEqual(before);
  });

  it("reports validation failures of Transactions, ISIN changes and Securities by ref", async () => {
    const before = await counts();
    expect(
      await recordBatch(
        { depotId, securities: SECURITIES, entries: [{ kind: "transaction", ref: "x", securityRef: null, input: { type: "DEPOSIT", date: "2024-01-01", amount: "abc" } }] },
        db(),
      ),
    ).toEqual({ ok: false, ref: "x", failure: { ok: false, reason: "amount-invalid" } });
    expect(
      await recordBatch(
        { depotId, securities: [{ ref: "bad", identifier: { isin: "XX" }, details: { name: "X", assetType: "STOCK" } }], entries: [] },
        db(),
      ),
    ).toEqual({ ok: false, ref: "bad", failure: { ok: false, reason: "isin-invalid" } });
    expect(
      await recordBatch(
        {
          depotId,
          securities: SECURITIES,
          entries: [{ kind: "isin-change", ref: "i", oldSecurityRef: "old", newSecurityRef: "new", date: "2024-02-01", oldQuantity: "0", newQuantity: "1" }],
        },
        db(),
      ),
    ).toEqual({ ok: false, ref: "i", failure: { ok: false, reason: "old-quantity-invalid" } });
    expect(
      await recordBatch({ depotId, securities: [], entries: [buy("b", "2024-01-01")] }, db()),
    ).toEqual({ ok: false, ref: "b", failure: { ok: false, reason: "security-ref-unknown" } });
    expect(await counts()).toEqual(before);
  });

  it("refuses an unknown or archived Depot with ref 'depot'", async () => {
    expect(await recordBatch({ depotId: "nope", securities: SECURITIES, entries: [] }, db())).toEqual({
      ok: false,
      ref: "depot",
      failure: { ok: false, reason: "depot-not-found" },
    });
    expect((await archiveDepot(depotId, db())).ok).toBe(true);
    expect(await recordBatch({ depotId, securities: SECURITIES, entries: [] }, db())).toEqual({
      ok: false,
      ref: "depot",
      failure: { ok: false, reason: "depot-archived" },
    });
    expect(await db().security.count()).toBe(0);
  });

  it("checks duplicates unless an entry allows them", async () => {
    expect((await recordBatch({ depotId, securities: SECURITIES, entries: [buy("a", "2024-01-02")] }, db())).ok).toBe(true);
    const again = await recordBatch(
      {
        depotId,
        securities: SECURITIES,
        entries: [{ kind: "transaction", ref: "dup", securityRef: "old", input: { type: "BUY", date: "2024-01-02", quantity: "10", price: "10" } }],
      },
      db(),
    );
    expect(again).toMatchObject({ ok: false, ref: "dup", failure: { reason: "possible-duplicate", status: "duplicate" } });
    expect((await recordBatch({ depotId, securities: SECURITIES, entries: [buy("a2", "2024-01-02")] }, db())).ok).toBe(true);
  });
});
