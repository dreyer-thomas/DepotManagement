import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { allocation } from "@/core/allocation";
import { archiveDepot, compositionHoldings, createDepot, ensureSecurity, listDepots, listPositions, recordTransaction, type RecordTransactionInput } from "@/modules/ledger";
import { ALLOCATION_LABELS, allocationAnalysis, allocationHoldings, groupOf, listClassifications, listRegionSplits, setManualClassification, setManualRegionSplit } from "./index";

let testDb: TestDatabase;
const db = () => testDb.client;
const TODAY = "2026-10-26";

let main: string;
let second: string;
let old: string;
let sap: string;
let world: string;

async function book(input: RecordTransactionInput) {
  const result = await recordTransaction(input, db());
  if (!result.ok) throw new Error(`setup failed: ${result.reason}`);
}

beforeEach(async () => {
  testDb = createTestDatabase();
  const depots = await Promise.all(
    [
      { name: "Hauptdepot", broker: "COMDIRECT" as const },
      { name: "Zweitdepot", broker: "FINANZEN_ZERO" as const },
      { name: "Altdepot", broker: "COMDIRECT" as const },
    ].map((input) => createDepot(input, db())),
  );
  if (!depots.every((depot) => depot.ok)) throw new Error("setup failed");
  [main, second, old] = depots.map((depot) => (depot.ok ? depot.depot.id : ""));
  const s = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" }, db());
  const w = await ensureSecurity({ isin: "IE00B4L5Y983" }, { name: "Welt ETF", assetType: "ETF" }, db());
  if (!s.ok || !w.ok) throw new Error("setup failed");
  sap = s.security.id;
  world = w.security.id;
  await book({ depotId: main, type: "DEPOSIT", date: "2026-01-02", amount: "5000" });
  await book({ depotId: main, type: "BUY", date: "2026-01-05", quantity: "10", price: "100", security: { id: sap } });
  await book({ depotId: main, type: "BUY", date: "2026-01-06", quantity: "20", price: "50", security: { id: world } });
  await book({ depotId: second, type: "DEPOSIT", date: "2026-01-02", amount: "500" });
  await book({ depotId: second, type: "BUY", date: "2026-02-01", quantity: "2", price: "110", security: { id: sap } });
  await book({ depotId: old, type: "DEPOSIT", date: "2026-01-02", amount: "1" });
  await book({ depotId: old, type: "WITHDRAWAL", date: "2026-01-03", amount: "1" });
  if (!(await archiveDepot(old, db())).ok) throw new Error("setup failed");
  await setManualClassification(sap, { assetClass: "Aktien", region: "Europa" }, db());
  await setManualRegionSplit(world, { USA: "70", Europa: "30" }, db());
});

afterEach(async () => {
  await testDb.cleanup();
});

/** The Analysen page's former glue, step by step, as the reference. */
async function reference(scope: "portfolio" | { depotId: string }, dimension: Parameters<typeof allocationAnalysis>[1]) {
  const all = await listDepots(db());
  const inScope = all.filter((depot) => (scope === "portfolio" ? !depot.archived : depot.id === scope.depotId));
  const positions = await Promise.all(inScope.map((depot) => listPositions(depot.id, TODAY, db())));
  const holdings = inScope.flatMap((depot, index) => compositionHoldings(depot, positions[index]));
  const splits = dimension === "region" ? await listRegionSplits(db()) : {};
  return allocation(
    allocationHoldings(holdings, await listClassifications(db()), dimension, splits),
    inScope.map((depot) => depot.cashBalance),
    ALLOCATION_LABELS,
  );
}

describe("allocationAnalysis", () => {
  it("groups the Portfolio's priced Positions and cash by asset class, unclassified as Unbekannt", async () => {
    const result = await allocationAnalysis("portfolio", "assetClass", TODAY, db());
    expect(result).toEqual(await reference("portfolio", "assetClass"));
    expect(result.segments.map((segment) => [segment.label, segment.amount])).toEqual([
      ["Aktien", "1320"],
      ["Unbekannt", "1000"],
      ["Guthaben", "3280"],
    ]);
    expect(result.positions[`group:Aktien`].map((position) => position.depotName)).toEqual(["Hauptdepot", "Zweitdepot"]);
  });

  it("distributes a split fund over its regions and limits the scope to one Depot", async () => {
    const result = await allocationAnalysis({ depotId: main }, "region", TODAY, db());
    expect(result).toEqual(await reference({ depotId: main }, "region"));
    expect(result.segments.map((segment) => [segment.label, segment.amount])).toEqual([
      ["Europa", "1400"],
      ["USA", "700"],
      ["Guthaben", "3000"],
    ]);
    expect(result.positions["group:USA"]).toEqual([expect.objectContaining({ securityId: world, weight: "0.7" })]);
  });

  it("uses the asset-type labels for Wertpapiertyp and gives an empty allocation for an unknown Depot", async () => {
    const result = await allocationAnalysis("portfolio", "type", TODAY, db());
    expect(result.segments.map((segment) => segment.label)).toEqual(["Aktie", "ETF", "Guthaben"]);
    expect(await allocationAnalysis({ depotId: "nope" }, "type", TODAY, db())).toEqual({ segments: [], positions: {} });
  });
});

describe("allocationAnalysis with storedPrices", () => {
  it("values the Positions with the stored Prices the loader gives, not the Transaction prices", async () => {
    const storedPrices = async (ids: string[], asOf: string) =>
      ids.filter((id) => id === sap).map((securityId) => ({ id: "p", securityId, date: asOf, sequence: 0, price: "150", source: "provider" as const }));
    const result = await allocationAnalysis("portfolio", "assetClass", TODAY, db(), { storedPrices });
    expect(result.segments.map((segment) => [segment.label, segment.amount])).toEqual([
      ["Aktien", "1800"],
      ["Unbekannt", "1000"],
      ["Guthaben", "3280"],
    ]);
  });
});

describe("groupOf", () => {
  it("maps company size – to Nicht zutreffend and UNCLASSIFIED to unknown", async () => {
    const classifications = await listClassifications(db());
    expect(groupOf(classifications[sap], "region")).toBe("Europa");
    expect(groupOf(undefined, "sector")).toBeNull();
    expect(groupOf({ ...classifications[sap], companySize: { ...classifications[sap].companySize, value: "–" } }, "companySize")).toBe("Nicht zutreffend");
    expect(groupOf({ ...classifications[sap], type: "UNCLASSIFIED" }, "type")).toBeNull();
  });
});
