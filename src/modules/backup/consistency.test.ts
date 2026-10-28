import { describe, expect, it } from "vitest";
import { checkConsistency } from "./consistency";
import type { ExportFile } from "./schema";

const TS = "2026-10-26T10:00:00.000Z";

/** A small, consistent synthetic export file. */
function base(): ExportFile {
  return {
    schemaVersion: 6,
    depots: [
      { id: "d1", name: "Hauptdepot", broker: "COMDIRECT", archived: false },
      { id: "d2", name: "Zweitdepot", broker: "FINANZEN_ZERO", archived: false },
    ],
    securities: [
      { id: "s1", isin: "DE000SYNCA09", cryptoSymbol: null, name: "Alpha", assetType: "ETF" },
      { id: "s2", isin: "DE000SYNCB08", cryptoSymbol: null, name: "Beta", assetType: "STOCK" },
      { id: "s3", isin: null, cryptoSymbol: "BTC", name: "Bitcoin", assetType: "CRYPTO" },
      { id: "s4", isin: null, cryptoSymbol: null, name: "Ohne", assetType: "UNCLASSIFIED" },
    ],
    providerMappings: [
      { id: "m1", securityId: "s1", provider: "YAHOO", symbol: "A.DE", origin: "AUTO", updatedAt: TS, historyFrom: null, fetchedAt: null, fetchError: null },
    ],
    transactions: [
      { id: "t1", depotId: "d1", securityId: null, type: "DEPOSIT", date: "2026-01-01", sequence: 0, quantity: null, price: null, amount: "100", fee: "0", tax: "0", note: null },
      { id: "t2", depotId: "d1", securityId: "s1", type: "BUY", date: "2026-01-01", sequence: 1, quantity: "1", price: "10", amount: "10", fee: "0", tax: "0", note: null },
      { id: "t3", depotId: "d2", securityId: null, type: "DEPOSIT", date: "2026-01-01", sequence: 0, quantity: null, price: null, amount: "5", fee: "0", tax: "0", note: null },
    ],
    corporateActions: [
      { id: "c1", securityId: "s1", newSecurityId: null, type: "SPLIT", date: "2026-02-01", ratioOld: "1", ratioNew: "2" },
      { id: "c2", securityId: "s2", newSecurityId: "s1", type: "ISIN_CHANGE", date: "2026-02-01", ratioOld: "1", ratioNew: "1" },
    ],
    reconciliationRuns: [
      {
        id: "r1",
        depotId: "d1",
        statementDate: "2026-06-30",
        status: "OPEN",
        createdAt: TS,
        finishedAt: null,
        rows: [
          { id: "rw1", runId: "r1", securityId: null, statementValue: "90", checked: false },
          { id: "rw2", runId: "r1", securityId: "s1", statementValue: "1", checked: true },
        ],
      },
      {
        id: "r2",
        depotId: "d2",
        statementDate: "2026-06-30",
        status: "OPEN",
        createdAt: TS,
        finishedAt: null,
        rows: [{ id: "rw3", runId: "r2", securityId: null, statementValue: null, checked: false }],
      },
    ],
    prices: [
      { id: "p1", securityId: "s1", date: "2026-01-02", source: "MANUAL", price: "11", fetchedAt: TS },
      { id: "p2", securityId: "s1", date: "2026-01-02", source: "PROVIDER", price: "11", fetchedAt: TS },
    ],
    logos: [{ id: "l1", securityId: "s2", contentType: "image/png", fetchedAt: TS, data: "iVBORw0KGgo=" }],
    classifications: [
      { id: "k1", securityId: "s2", assetClass: null, sector: "Halbleiter", industry: null, region: "Europa", country: null, companySize: null, currency: null, regionSplit: null },
    ],
    taxAllowances: [
      { id: "a1", broker: "COMDIRECT", year: 2026, amount: "801" },
      { id: "a2", broker: "COMDIRECT", year: 2025, amount: "1000" },
    ],
    teilfreistellungOverrides: [{ id: "o1", securityId: "s1", rate: "0.15" }],
    targetAllocations: [
      { id: "t1", scope: "portfolio", weights: { equityUsa: "60", bonds: "40" }, threshold: "2" },
      { id: "t2", scope: "d1", weights: { cash: "100" }, threshold: "0.5" },
    ],
    watchlists: [
      {
        id: "w1",
        name: "Ideen",
        position: 1,
        createdAt: TS,
        entries: [
          { id: "e1", securityId: "s4", note: "", dateAdded: "2026-10-01", position: 1, source: "APP", clientName: null, createdAt: TS },
          { id: "e2", securityId: "s1", note: "Notiz", dateAdded: "2026-10-02", position: 2, source: "MCP", clientName: "Claude", createdAt: TS },
        ],
      },
      {
        id: "w2",
        name: "Dividenden",
        position: 2,
        createdAt: TS,
        entries: [{ id: "e3", securityId: "s4", note: "", dateAdded: "2026-10-03", position: 1, source: "APP", clientName: null, createdAt: TS }],
      },
    ],
  };
}

type Mutation = (file: ExportFile) => void;

describe("checkConsistency", () => {
  it("accepts a consistent file and an empty one", () => {
    expect(checkConsistency(base())).toEqual({ ok: true });
    const empty = base();
    for (const key of ["depots", "securities", "providerMappings", "transactions", "corporateActions", "reconciliationRuns", "prices", "logos", "classifications", "taxAllowances", "teilfreistellungOverrides", "targetAllocations", "watchlists"] as const) {
      empty[key] = [];
    }
    expect(checkConsistency(empty)).toEqual({ ok: true });
  });

  it.each<[string, Mutation, string]>([
    ["duplicate depot id", (f) => (f.depots[1].id = "d1"), "depots.1.id"],
    ["duplicate security id", (f) => (f.securities[2].id = "s1"), "securities.2.id"],
    ["duplicate mapping id", (f) => f.providerMappings.push({ ...f.providerMappings[0], securityId: "s2" }), "providerMappings.1.id"],
    ["duplicate transaction id", (f) => (f.transactions[2].id = "t1"), "transactions.2.id"],
    ["duplicate corporate action id", (f) => (f.corporateActions[1].id = "c1"), "corporateActions.1.id"],
    ["duplicate run id", (f) => (f.reconciliationRuns[1].id = "r1"), "reconciliationRuns.1.id"],
    ["duplicate row id across runs", (f) => (f.reconciliationRuns[1].rows[0].id = "rw1"), "reconciliationRuns.1.rows.0.id"],
    ["duplicate price id", (f) => (f.prices[1].id = "p1"), "prices.1.id"],
    ["duplicate logo id", (f) => f.logos.push({ ...f.logos[0], securityId: "s1" }), "logos.1.id"],
    ["duplicate classification id", (f) => f.classifications.push({ ...f.classifications[0], securityId: "s1" }), "classifications.1.id"],
    ["duplicate depot name", (f) => (f.depots[1].name = "Hauptdepot"), "depots.1.name"],
    ["duplicate ISIN", (f) => (f.securities[1].isin = "DE000SYNCA09"), "securities.1.isin"],
    ["duplicate crypto symbol", (f) => (f.securities[3].cryptoSymbol = "BTC"), "securities.3.cryptoSymbol"],
    ["unknown transaction depot", (f) => (f.transactions[1].depotId = "nope"), "transactions.1.depotId"],
    ["unknown transaction security", (f) => (f.transactions[1].securityId = "nope"), "transactions.1.securityId"],
    ["duplicate (depot, date, sequence)", (f) => (f.transactions[1].sequence = 0), "transactions.1.sequence"],
    ["unknown corporate action security", (f) => (f.corporateActions[0].securityId = "nope"), "corporateActions.0.securityId"],
    ["unknown ISIN-change target", (f) => (f.corporateActions[1].newSecurityId = "nope"), "corporateActions.1.newSecurityId"],
    [
      "duplicate (security, type, date)",
      (f) => f.corporateActions.push({ ...f.corporateActions[0], id: "c3" }),
      "corporateActions.2.date",
    ],
    ["unknown run depot", (f) => (f.reconciliationRuns[0].depotId = "nope"), "reconciliationRuns.0.depotId"],
    ["row runId not its parent", (f) => (f.reconciliationRuns[0].rows[1].runId = "r2"), "reconciliationRuns.0.rows.1.runId"],
    ["unknown row security", (f) => (f.reconciliationRuns[0].rows[1].securityId = "nope"), "reconciliationRuns.0.rows.1.securityId"],
    ["two rows of one Security in a run", (f) => (f.reconciliationRuns[0].rows[0].securityId = "s1"), "reconciliationRuns.0.rows.1.securityId"],
    ["two cash rows in a run", (f) => (f.reconciliationRuns[0].rows[1].securityId = null), "reconciliationRuns.0.rows.1.securityId"],
    ["unknown mapping security", (f) => (f.providerMappings[0].securityId = "nope"), "providerMappings.0.securityId"],
    [
      "two mappings of one Security",
      (f) => f.providerMappings.push({ ...f.providerMappings[0], id: "m2" }),
      "providerMappings.1.securityId",
    ],
    ["unknown price security", (f) => (f.prices[0].securityId = "nope"), "prices.0.securityId"],
    ["duplicate (security, date, source)", (f) => (f.prices[1].source = "MANUAL"), "prices.1.source"],
    ["unknown logo security", (f) => (f.logos[0].securityId = "nope"), "logos.0.securityId"],
    ["two logos of one Security", (f) => f.logos.push({ ...f.logos[0], id: "l2" }), "logos.1.securityId"],
    ["unknown classification security", (f) => (f.classifications[0].securityId = "nope"), "classifications.0.securityId"],
    ["two classifications of one Security", (f) => f.classifications.push({ ...f.classifications[0], id: "k2" }), "classifications.1.securityId"],
    ["duplicate tax allowance id", (f) => (f.taxAllowances[1].id = "a1"), "taxAllowances.1.id"],
    ["duplicate (broker, year) allowance", (f) => (f.taxAllowances[1].year = 2026), "taxAllowances.1.year"],
    ["duplicate override id", (f) => f.teilfreistellungOverrides.push({ ...f.teilfreistellungOverrides[0], securityId: "s2" }), "teilfreistellungOverrides.1.id"],
    ["unknown override security", (f) => (f.teilfreistellungOverrides[0].securityId = "nope"), "teilfreistellungOverrides.0.securityId"],
    ["two overrides of one Security", (f) => f.teilfreistellungOverrides.push({ ...f.teilfreistellungOverrides[0], id: "o2" }), "teilfreistellungOverrides.1.securityId"],
    ["rate outside the list", (f) => (f.teilfreistellungOverrides[0].rate = "0.2"), "teilfreistellungOverrides.0.rate"],
    ["duplicate target allocation id", (f) => f.targetAllocations.push({ ...f.targetAllocations[0], scope: "d2" }), "targetAllocations.2.id"],
    ["two target allocations of one scope", (f) => f.targetAllocations.push({ ...f.targetAllocations[0], id: "t3" }), "targetAllocations.2.scope"],
    ["unknown target allocation scope", (f) => (f.targetAllocations[1].scope = "nope"), "targetAllocations.1.scope"],
    ["target weights not summing to 100", (f) => (f.targetAllocations[0].weights = { equityUsa: "60", bonds: "39.5" }), "targetAllocations.0.weights"],
    ["non-canonical target weight", (f) => (f.targetAllocations[0].weights = { equityUsa: "60.0", bonds: "40" }), "targetAllocations.0.weights"],
    ["zero target weight", (f) => (f.targetAllocations[1].weights = { cash: "100", bonds: "0" }), "targetAllocations.1.weights"],
    ["invalid threshold", (f) => (f.targetAllocations[0].threshold = "100.5"), "targetAllocations.0.threshold"],
    ["duplicate watchlist id", (f) => (f.watchlists[1].id = "w1"), "watchlists.1.id"],
    ["duplicate watchlist entry id across lists", (f) => (f.watchlists[1].entries[0].id = "e1"), "watchlists.1.entries.0.id"],
    ["duplicate watchlist position", (f) => (f.watchlists[1].position = 1), "watchlists.1.position"],
    ["watchlist names equal ignoring case", (f) => (f.watchlists[1].name = "IDEEN"), "watchlists.1.name"],
    ["watchlist names equal after NFC", (f) => ((f.watchlists[0].name = "Caf\u00e9"), (f.watchlists[1].name = "CAFE\u0301")), "watchlists.1.name"],
    ["dangling watchlist entry", (f) => (f.watchlists[0].entries[1].securityId = "nope"), "watchlists.0.entries.1.securityId"],
    ["Security twice on one list", (f) => (f.watchlists[0].entries[1].securityId = "s4"), "watchlists.0.entries.1.securityId"],
  ])("rejects a %s with its path", (_label, mutate, path) => {
    const file = base();
    mutate(file);
    expect(checkConsistency(file)).toEqual({ ok: false, path });
  });

  it("allows one Security on several watchlists and the same entry position on different lists", () => {
    const file = base();
    expect(file.watchlists[0].entries[0]).toMatchObject({ securityId: "s4", position: 1 });
    expect(file.watchlists[1].entries[0]).toMatchObject({ securityId: "s4", position: 1 });
    expect(checkConsistency(file)).toEqual({ ok: true });
  });

  it("allows the same cash row shape in different runs and the same slot in different Depots", () => {
    const file = base();
    expect(file.transactions[0]).toMatchObject({ date: "2026-01-01", sequence: 0 });
    expect(file.transactions[2]).toMatchObject({ date: "2026-01-01", sequence: 0 });
    expect(checkConsistency(file)).toEqual({ ok: true });
  });
});
