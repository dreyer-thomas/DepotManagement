import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import {
  allowedAssetTypes,
  changeSecurityType,
  createDepot,
  ensureSecurity,
  firstActivityDates,
  listSecurities,
  recordIsinChange,
  recordTrade,
} from "./index";
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

  it("creates a FUND Security identified by its ISIN", async () => {
    const fund = await ensureSecurity({ isin: "LU000SYNF017" }, { name: "AB SICAV I", assetType: "FUND" }, db());
    expect(fund.ok && fund.security).toMatchObject({ isin: "LU000SYNF017", assetType: "FUND" });
    expect(await ensureSecurity({ cryptoSymbol: "XYZ" }, { name: "X", assetType: "FUND" }, db())).toEqual({
      ok: false,
      reason: "asset-type-invalid",
    });
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

describe("changeSecurityType", () => {
  async function isinSecurity(assetType: "STOCK" | "UNCLASSIFIED" = "STOCK") {
    return db().security.create({
      data: { isin: "IE00B4L5Y983", name: "Welt ETF", assetType },
      select: { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true },
    });
  }

  it("stores a new type valid for an ISIN Security", async () => {
    const security = await isinSecurity();
    expect(await changeSecurityType(security.id, "ETF", db())).toEqual({ ok: true, security: { ...security, assetType: "ETF" } });
    expect((await listSecurities(db()))[0].assetType).toBe("ETF");
  });

  it("classifies an UNCLASSIFIED Security", async () => {
    const security = await isinSecurity("UNCLASSIFIED");
    const result = await changeSecurityType(security.id, "FUND", db());
    expect(result.ok && result.security.assetType).toBe("FUND");
  });

  it.each(["CRYPTO", "UNCLASSIFIED", "BOND", 42, undefined])("rejects %j for an ISIN Security", async (assetType) => {
    const security = await isinSecurity();
    expect(await changeSecurityType(security.id, assetType, db())).toEqual({ ok: false, reason: "asset-type-invalid" });
    expect((await listSecurities(db()))[0].assetType).toBe("STOCK");
  });

  it("rejects non-CRYPTO types for a crypto Security", async () => {
    const btc = await ensureSecurity({ cryptoSymbol: "BTC" }, { name: "Bitcoin", assetType: "CRYPTO" }, db());
    if (!btc.ok) throw new Error("setup failed");
    expect(await changeSecurityType(btc.security.id, "STOCK", db())).toEqual({ ok: false, reason: "asset-type-invalid" });
    expect(await changeSecurityType(btc.security.id, "CRYPTO", db())).toEqual(btc);
  });

  it.each(["missing", "", 7, null])("returns not-found for id %j", async (id) => {
    expect(await changeSecurityType(id, "ETF", db())).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("allowedAssetTypes", () => {
  it("offers the ISIN types for an ISIN Security and CRYPTO for a crypto Security, never UNCLASSIFIED", () => {
    expect(allowedAssetTypes({ isin: "IE00B4L5Y983", cryptoSymbol: null })).toEqual(["STOCK", "ETF", "FUND", "CERTIFICATE"]);
    expect(allowedAssetTypes({ isin: null, cryptoSymbol: "BTC" })).toEqual(["CRYPTO"]);
  });
});

describe("firstActivityDates", () => {
  it("is the earliest Transaction date (any Depot) or ISIN change date into the Security", async () => {
    const depot = await createDepot({ name: "A", broker: "COMDIRECT" }, db());
    const other = await createDepot({ name: "B", broker: "COMDIRECT" }, db());
    const apple = await ensureSecurity({ isin: "US0378331005" }, { name: "Apple", assetType: "STOCK" }, db());
    const idle = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP", assetType: "STOCK" }, db());
    if (!depot.ok || !other.ok || !apple.ok || !idle.ok) throw new Error("setup failed");
    const appleId = apple.security.id;
    const buy = (depotId: string, date: string) =>
      recordTrade({ depotId, type: "BUY", date, quantity: "2", price: "10", security: { id: appleId } }, db());
    expect((await buy(depot.depot.id, "2024-05-02")).ok).toBe(true);
    expect((await buy(other.depot.id, "2024-03-04")).ok).toBe(true);
    const changed = await recordIsinChange(
      {
        oldSecurityId: appleId,
        newSecurity: { new: { isin: "DE000SYN0013", name: "Neu", assetType: "STOCK" } },
        date: "2024-06-03",
        oldQuantity: "1",
        newQuantity: "1",
      },
      db(),
    );
    if (!changed.ok) throw new Error(changed.reason);
    const newId = changed.isinChange.newSecurity.id;

    const dates = await firstActivityDates([appleId, newId, idle.security.id], db());
    expect(Object.fromEntries(dates)).toEqual({ [appleId]: "2024-03-04", [newId]: "2024-06-03" });
    expect(await firstActivityDates([], db())).toEqual(new Map());
  });
});
