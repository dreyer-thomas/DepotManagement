import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { ensureSecurity, listSecurities } from "./index";
import { hasValidIsinCheckDigit } from "./securities";

let testDb: TestDatabase;

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

const db = () => testDb.client;

describe("hasValidIsinCheckDigit", () => {
  it.each(["US0378331005", "IE00B4L5Y983", "DE0007164600", "US5949181045"])("accepts %s", (isin) => {
    expect(hasValidIsinCheckDigit(isin)).toBe(true);
  });

  it.each(["US0378331006", "IE00B4L5Y984", "DE0007164601"])("rejects %s", (isin) => {
    expect(hasValidIsinCheckDigit(isin)).toBe(false);
  });
});

describe("ensureSecurity", () => {
  it("creates a Security with a normalised ISIN once and returns it again unchanged", async () => {
    const first = await ensureSecurity({ isin: " us0378331005 " }, { name: " Apple Inc. ", assetType: "STOCK" }, db());
    expect(first).toEqual({
      ok: true,
      security: { id: expect.any(String), isin: "US0378331005", cryptoSymbol: null, name: "Apple Inc.", assetType: "STOCK" },
    });
    const again = await ensureSecurity({ isin: "US0378331005" }, { name: "Anderer Name", assetType: "ETF" }, db());
    expect(again).toEqual(first);
    expect(await listSecurities(db())).toHaveLength(1);
  });

  it("upper-cases crypto symbols and requires CRYPTO", async () => {
    const result = await ensureSecurity({ cryptoSymbol: " btc " }, { name: "Bitcoin", assetType: "CRYPTO" }, db());
    expect(result.ok && result.security).toMatchObject({ cryptoSymbol: "BTC", isin: null, assetType: "CRYPTO" });
    const again = await ensureSecurity({ cryptoSymbol: "BTC" }, { name: "Bitcoin", assetType: "CRYPTO" }, db());
    expect(again.ok && again.security.id).toBe(result.ok && result.security.id);
  });

  it.each([
    [{ isin: "US0378331006" }, { name: "Apple", assetType: "STOCK" }, "isin-invalid"],
    [{ isin: "US037833100" }, { name: "Apple", assetType: "STOCK" }, "isin-invalid"],
    [{ isin: 42 }, { name: "Apple", assetType: "STOCK" }, "isin-invalid"],
    [{ cryptoSymbol: "BTC-EUR" }, { name: "Bitcoin", assetType: "CRYPTO" }, "crypto-symbol-invalid"],
    [{ cryptoSymbol: "ABCDEFGHIJK" }, { name: "X", assetType: "CRYPTO" }, "crypto-symbol-invalid"],
    [{ isin: "US0378331005" }, { name: "  ", assetType: "STOCK" }, "security-name-invalid"],
    [{ isin: "US0378331005" }, { name: "x".repeat(101), assetType: "STOCK" }, "security-name-invalid"],
    [{ isin: "US0378331005" }, { name: "Apple", assetType: "CRYPTO" }, "asset-type-invalid"],
    [{ isin: "US0378331005" }, { name: "Apple", assetType: "UNCLASSIFIED" }, "asset-type-invalid"],
    [{ isin: "US0378331005" }, { name: "Apple", assetType: "BOND" }, "asset-type-invalid"],
    [{ cryptoSymbol: "BTC" }, { name: "Bitcoin", assetType: "STOCK" }, "asset-type-invalid"],
  ] as const)("rejects %j / %j with %s", async (identifier, details, reason) => {
    expect(await ensureSecurity(identifier, details, db())).toEqual({ ok: false, reason });
    expect(await listSecurities(db())).toEqual([]);
  });

  it("accepts exactly 100 name characters", async () => {
    const result = await ensureSecurity({ isin: "IE00B4L5Y983" }, { name: "x".repeat(100), assetType: "ETF" }, db());
    expect(result.ok).toBe(true);
  });

  it("re-reads the existing row on a unique-constraint race", async () => {
    const existing = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple", assetType: "STOCK" }, db());
    const real = db();
    let calls = 0;
    const security = new Proxy(real.security, {
      get: (target, prop, receiver) =>
        prop === "findUnique"
          ? async (args: Parameters<typeof real.security.findUnique>[0]) => (calls++ === 0 ? null : target.findUnique(args))
          : Reflect.get(target, prop, receiver),
    });
    const raceDb = new Proxy(real, {
      get: (target, prop, receiver) => (prop === "security" ? security : Reflect.get(target, prop, receiver)),
    });
    expect(await ensureSecurity({ isin: "US0378331005" }, { name: "Apple", assetType: "STOCK" }, raceDb)).toEqual(existing);
  });
});

describe("listSecurities", () => {
  it("sorts by name with German collation", async () => {
    await ensureSecurity({ isin: "US0378331005" }, { name: "Zeta", assetType: "STOCK" }, db());
    await ensureSecurity({ isin: "IE00B4L5Y983" }, { name: "Öko", assetType: "ETF" }, db());
    await ensureSecurity({ cryptoSymbol: "BTC" }, { name: "bitcoin", assetType: "CRYPTO" }, db());
    expect((await listSecurities(db())).map((s) => s.name)).toEqual(["bitcoin", "Öko", "Zeta"]);
  });
});
