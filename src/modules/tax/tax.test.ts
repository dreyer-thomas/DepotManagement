import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { taxPreview } from "@/core/tax";
import { setManualClassification } from "@/modules/classification";
import { archiveDepot, createDepot, ensureSecurity, recordTransaction, type RecordTransactionInput } from "@/modules/ledger";
import {
  exportTaxSettings,
  listTaxAllowances,
  listTeilfreistellungOverrides,
  replaceAllTaxSettings,
  setTaxAllowances,
  setTeilfreistellungOverride,
  taxPreviewInput,
} from "./index";

let testDb: TestDatabase;
const db = () => testDb.client;
const NOW = new Date("2026-10-27T10:00:00.000Z");
const now = () => NOW;
const TODAY = "2026-10-27";

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

async function security(isin: string, name: string, assetType: string) {
  const result = await ensureSecurity({ isin }, { name, assetType }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.security.id;
}

async function depot(name: string, broker: string) {
  const result = await createDepot({ name, broker }, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
  return result.depot.id;
}

async function book(input: RecordTransactionInput) {
  const result = await recordTransaction(input, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
}

describe("setTaxAllowances", () => {
  it("stores, replaces and removes amounts per broker and year", async () => {
    expect(await setTaxAllowances("2026", { COMDIRECT: "801", DEUTSCHE_BANK: "300,50" }, db(), now)).toEqual({ ok: true });
    expect(await setTaxAllowances(2025, { COMDIRECT: "1.000" }, db(), now)).toEqual({ ok: true });
    expect(await listTaxAllowances(db())).toEqual([
      { broker: "COMDIRECT", year: 2026, amount: "801" },
      { broker: "DEUTSCHE_BANK", year: 2026, amount: "300.5" },
      { broker: "COMDIRECT", year: 2025, amount: "1000" },
    ]);

    expect(await setTaxAllowances("2026", { COMDIRECT: "900", DEUTSCHE_BANK: "" }, db(), now)).toEqual({ ok: true });
    expect(await setTaxAllowances("2025", { COMDIRECT: "0" }, db(), now)).toEqual({ ok: true });
    expect(await listTaxAllowances(db())).toEqual([{ broker: "COMDIRECT", year: 2026, amount: "900" }]);
  });

  it("rejects invalid amounts and years before writing anything", async () => {
    for (const amount of ["-5", "abc", "1,234", 5]) {
      expect(await setTaxAllowances("2026", { COMDIRECT: "100", DEUTSCHE_BANK: amount }, db(), now)).toEqual({
        ok: false,
        reason: "amount-invalid",
        broker: "DEUTSCHE_BANK",
      });
    }
    for (const year of ["1999", "2101", "20x6", 2026.5, null]) {
      expect(await setTaxAllowances(year, { COMDIRECT: "100" }, db(), now)).toEqual({ ok: false, reason: "year-invalid" });
    }
    expect(await listTaxAllowances(db())).toEqual([]);
  });
});

describe("setTeilfreistellungOverride", () => {
  it("sets, replaces and removes an override", async () => {
    const etf = await security("IE00B4L5Y983", "iShares Core MSCI World", "ETF");
    expect(await setTeilfreistellungOverride(etf, "0.15", db(), now)).toEqual({ ok: true });
    expect(await setTeilfreistellungOverride(etf, "0", db(), now)).toEqual({ ok: true });
    expect(await listTeilfreistellungOverrides(db())).toEqual({ [etf]: "0" });
    expect(await setTeilfreistellungOverride(etf, "", db(), now)).toEqual({ ok: true });
    expect(await listTeilfreistellungOverrides(db())).toEqual({});
  });

  it("rejects unknown Securities and rates outside the list", async () => {
    const etf = await security("IE00B4L5Y983", "iShares Core MSCI World", "ETF");
    expect(await setTeilfreistellungOverride("missing", "0.3", db(), now)).toEqual({ ok: false, reason: "security-not-found" });
    for (const rate of ["0.2", "30", "0.30", null]) {
      expect(await setTeilfreistellungOverride(etf, rate, db(), now)).toEqual({ ok: false, reason: "rate-invalid" });
    }
  });
});

describe("taxPreviewInput", () => {
  it("covers archived Depots, classifications, overrides and the used brokers", async () => {
    const comdirect = await depot("Hauptdepot", "COMDIRECT");
    const archived = await depot("Altdepot", "FINANZEN_ZERO");
    const etf = await security("IE00B4L5Y983", "iShares Core MSCI World", "ETF");
    const stock = await security("US0378331005", "Apple Inc.", "STOCK");
    expect((await setManualClassification(etf, { assetClass: "Aktien" }, db())).ok).toBe(true);

    await book({ depotId: comdirect, type: "DEPOSIT", date: "2026-01-02", amount: "5000" });
    await book({ depotId: comdirect, type: "BUY", date: "2026-01-05", quantity: "10", price: "100", security: { id: etf } });
    await book({ depotId: comdirect, type: "SELL", date: "2026-03-05", quantity: "10", price: "200", tax: "200", security: { id: etf } });
    await book({ depotId: archived, type: "DEPOSIT", date: "2025-01-02", amount: "1000" });
    await book({ depotId: archived, type: "BUY", date: "2025-01-03", quantity: "1", price: "1000", security: { id: stock } });
    await book({ depotId: archived, type: "SELL", date: "2025-06-03", quantity: "1", price: "1500", security: { id: stock } });
    await book({ depotId: archived, type: "WITHDRAWAL", date: "2025-06-04", amount: "1500" });
    expect((await archiveDepot(archived, db())).ok).toBe(true);
    expect((await setTaxAllowances("2026", { COMDIRECT: "1000" }, db(), now)).ok).toBe(true);

    const input = await taxPreviewInput(db());
    expect(input.brokers).toEqual(["COMDIRECT", "FINANZEN_ZERO"]);
    expect(input.securities[etf]).toEqual({ category: "fund", teilfreistellung: "0.3" });
    expect(input.securities[stock]).toEqual({ category: "stock", teilfreistellung: "0" });

    let years = taxPreview({ ...input, today: TODAY });
    expect(years.map((year) => year.year)).toEqual(["2026", "2025"]);
    expect(years[0].brokers[0]).toMatchObject({ broker: "COMDIRECT", fund: "700", taxable: "700", allowanceUsed: "700", estimated: "0", withheld: "200" });
    expect(years[1].brokers[1]).toMatchObject({ broker: "FINANZEN_ZERO", stockGains: "500", taxable: "500" });

    // An override of 0 % applies to the fund's gain.
    expect((await setTeilfreistellungOverride(etf, "0", db(), now)).ok).toBe(true);
    years = taxPreview({ ...(await taxPreviewInput(db())), today: TODAY });
    expect(years[0].brokers[0]).toMatchObject({ fund: "1000", taxable: "1000" });
  });
});

describe("tax settings backup", () => {
  it("exports and replaces all allowances and overrides", async () => {
    const etf = await security("IE00B4L5Y983", "iShares Core MSCI World", "ETF");
    await setTaxAllowances("2026", { COMDIRECT: "801" }, db(), now);
    await setTeilfreistellungOverride(etf, "0.15", db(), now);
    const exported = await exportTaxSettings(db());
    expect(exported.taxAllowances).toEqual([{ id: expect.any(String), broker: "COMDIRECT", year: 2026, amount: "801" }]);
    expect(exported.teilfreistellungOverrides).toEqual([{ id: expect.any(String), securityId: etf, rate: "0.15" }]);

    await setTaxAllowances("2025", { DEUTSCHE_BANK: "200" }, db(), now);
    await replaceAllTaxSettings(exported, db(), now);
    expect(await exportTaxSettings(db())).toEqual(exported);

    await replaceAllTaxSettings({ taxAllowances: [], teilfreistellungOverrides: [] }, db(), now);
    expect(await listTaxAllowances(db())).toEqual([]);
    expect(await listTeilfreistellungOverrides(db())).toEqual({});
  });
});
