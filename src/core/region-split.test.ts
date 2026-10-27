import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  deserializeRegionSplit,
  distributeByRegion,
  effectiveRegionSplit,
  parseRegionSplit,
  REGION_SPLIT_RULES,
  regionSplitFromRecord,
  regionSplitRule,
  serializeRegionSplit,
  SPLIT_REGIONS,
} from "./region-split";

const WORLD = [
  { region: "USA", weight: "72" },
  { region: "Europa", weight: "15" },
  { region: "Japan", weight: "6" },
  { region: "Pazifik ohne Japan", weight: "4" },
  { region: "Sonstige", weight: "3" },
];

/** `{USA: "72", …}` of a rule's weights. */
function weightsOf(name: string) {
  const split = regionSplitRule(name);
  return split && Object.fromEntries(split.weights.map((w) => [w.region, w.weight]));
}

describe("regionSplitRule", () => {
  it("splits an MSCI World ETF by the dated World weights", () => {
    expect(regionSplitRule("iShares Core MSCI World UCITS ETF")).toEqual({ index: "MSCI World", asOf: "2026-09-30", weights: WORLD });
  });

  it("matches specific indices before the general ones", () => {
    expect(regionSplitRule("Vanguard FTSE All-World UCITS ETF")?.index).toBe("FTSE All-World");
    expect(weightsOf("Vanguard FTSE All-World UCITS ETF")).toEqual({
      USA: "62",
      Europa: "14",
      Japan: "6",
      "Pazifik ohne Japan": "3",
      Schwellenländer: "11",
      Sonstige: "4",
    });
    expect(regionSplitRule("SPDR MSCI ACWI IMI UCITS ETF")?.index).toBe("MSCI ACWI");
    expect(weightsOf("iShares MSCI ACWI UCITS ETF")).toEqual({
      USA: "64",
      Europa: "13",
      Japan: "5",
      "Pazifik ohne Japan": "3",
      Schwellenländer: "11",
      Sonstige: "4",
    });
    expect(regionSplitRule("MSCI All Country World Fund")?.index).toBe("MSCI ACWI");
    expect(weightsOf("Vanguard FTSE Developed World UCITS ETF")).toEqual({
      USA: "71",
      Europa: "15",
      Japan: "7",
      "Pazifik ohne Japan": "4",
      Sonstige: "3",
    });
    expect(weightsOf("iShares Core MSCI Emerging Markets IMI UCITS ETF")).toEqual({ Schwellenländer: "100" });
    expect(weightsOf("Xtrackers MSCI EM UCITS ETF")).toEqual({ Schwellenländer: "100" });
    expect(weightsOf("iShares STOXX Europe 600 UCITS ETF (DE)")).toEqual({ Europa: "100" });
    expect(weightsOf("Xtrackers MSCI Europe UCITS ETF")).toEqual({ Europa: "100" });
    expect(weightsOf("iShares Core S&P 500 UCITS ETF")).toEqual({ USA: "100" });
    expect(weightsOf("Xtrackers MSCI USA UCITS ETF")).toEqual({ USA: "100" });
    expect(weightsOf("iShares MSCI Japan UCITS ETF")).toEqual({ Japan: "100" });
    expect(weightsOf("Amundi Japan TOPIX UCITS ETF")).toEqual({ Japan: "100" });
    expect(weightsOf("iShares Core MSCI Pacific ex Japan UCITS ETF")).toEqual({ "Pazifik ohne Japan": "100" });
    expect(regionSplitRule("iShares Core MSCI Pacific ex-Japan UCITS ETF")?.index).toBe("MSCI Pacific ex Japan");
  });

  it("puts single-region rules before the global ones", () => {
    expect(regionSplitRule("Vanguard FTSE Developed Europe UCITS ETF")).toMatchObject({ weights: [{ region: "Europa", weight: "100" }] });
    expect(regionSplitRule("iShares MSCI Emerging Europe")).toMatchObject({ weights: [{ region: "Schwellenländer", weight: "100" }] });
  });

  it("matches MSCI AC World as ACWI", () => {
    expect(regionSplitRule("Xtrackers MSCI AC World Screened UCITS ETF")?.index).toBe("MSCI ACWI");
  });

  it("names the matched index truthfully", () => {
    const index = (name: string) => regionSplitRule(name)?.index;
    expect(index("iShares STOXX Europe 600 UCITS ETF (DE)")).toBe("STOXX Europe 600");
    expect(index("Xtrackers MSCI Europe UCITS ETF")).toBe("MSCI Europe");
    expect(index("Vanguard FTSE Developed Europe UCITS ETF")).toBe("Europa-Index");
    expect(index("iShares Core S&P 500 UCITS ETF")).toBe("S&P 500");
    expect(index("Xtrackers MSCI USA UCITS ETF")).toBe("MSCI USA");
    expect(index("iShares MSCI Japan UCITS ETF")).toBe("MSCI Japan");
    expect(index("Amundi Japan TOPIX UCITS ETF")).toBe("TOPIX");
    expect(index("Xtrackers Nikkei 225 UCITS ETF")).toBe("Nikkei 225");
  });

  it("does not split exclusions, unmatched names and non-equity funds", () => {
    expect(regionSplitRule("Xtrackers MSCI World ex USA UCITS ETF")).toBeNull();
    expect(regionSplitRule("iShares MSCI ACWI ex-USA")).toBeNull();
    expect(regionSplitRule("iShares MSCI Europe ex UK")).toBeNull();
    expect(regionSplitRule("iShares Core Global Aggregate Bond UCITS ETF")).toBeNull();
    expect(regionSplitRule("iShares MSCI World Bond")).toBeNull();
    expect(regionSplitRule("Xetra-Gold")).toBeNull();
    expect(regionSplitRule("iShares Core DAX UCITS ETF")).toBeNull();
    expect(regionSplitRule("DWS Top Dividende")).toBeNull();
    expect(regionSplitRule("Some Fund")).toBeNull();
  });

  it("has rules whose weights are valid and sum to exactly 100", () => {
    for (const rule of REGION_SPLIT_RULES) {
      const sum = rule.weights.reduce((total, w) => total.plus(w.weight), new Decimal(0));
      expect(sum.toFixed(), rule.index).toBe("100");
      expect(rule.asOf).toBe("2026-09-30");
      const order = rule.weights.map((w) => SPLIT_REGIONS.indexOf(w.region));
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      expect(parseRegionSplit(Object.fromEntries(rule.weights.map((w) => [w.region, w.weight])))).toEqual({ ok: true, weights: rule.weights });
    }
  });

  it("returns a copy of the table weights", () => {
    regionSplitRule("MSCI World")!.weights[0].weight = "1";
    expect(regionSplitRule("MSCI World")!.weights[0].weight).toBe("72");
  });
});

describe("parseRegionSplit", () => {
  it("accepts German input summing to 100 and omits empty and zero regions", () => {
    expect(parseRegionSplit({ USA: "60", Europa: "37,5", Japan: "2,50", Schwellenländer: "0", Sonstige: "" })).toEqual({
      ok: true,
      weights: [
        { region: "USA", weight: "60" },
        { region: "Europa", weight: "37.5" },
        { region: "Japan", weight: "2.5" },
      ],
    });
    expect(parseRegionSplit({ USA: "100" })).toEqual({ ok: true, weights: [{ region: "USA", weight: "100" }] });
  });

  it("treats all-empty input as no split", () => {
    expect(parseRegionSplit({})).toEqual({ ok: true, weights: null });
    expect(parseRegionSplit({ USA: "", Europa: " ", Japan: null })).toEqual({ ok: true, weights: null });
  });

  it("rejects a sum other than 100", () => {
    expect(parseRegionSplit({ USA: "60", Europa: "39,5" })).toEqual({ ok: false, reason: "split-sum" });
    expect(parseRegionSplit({ USA: "60", Europa: "40,01" })).toEqual({ ok: false, reason: "split-sum" });
    expect(parseRegionSplit({ USA: "0" })).toEqual({ ok: false, reason: "split-sum" });
  });

  it.each([
    ["negative", { USA: "-10", Europa: "110" }],
    ["non-numeric", { USA: "abc", Europa: "100" }],
    ["over 100", { USA: "100,5" }],
    ["three decimals", { USA: "99,995", Europa: "0,005" }],
    ["not a string", { USA: 100 }],
  ])("rejects a %s value as split-invalid", (_, input) => {
    expect(parseRegionSplit(input)).toEqual({ ok: false, reason: "split-invalid" });
  });
});

describe("serializeRegionSplit / deserializeRegionSplit / regionSplitFromRecord", () => {
  it("round-trips a split as a JSON object in region order", () => {
    const json = serializeRegionSplit([
      { region: "USA", weight: "60" },
      { region: "Europa", weight: "40" },
    ]);
    expect(json).toBe('{"USA":"60","Europa":"40"}');
    expect(deserializeRegionSplit(json)).toEqual([
      { region: "USA", weight: "60" },
      { region: "Europa", weight: "40" },
    ]);
  });

  it("returns null for null, malformed or invalid stored values", () => {
    expect(deserializeRegionSplit(null)).toBeNull();
    expect(deserializeRegionSplit("{")).toBeNull();
    expect(deserializeRegionSplit("[]")).toBeNull();
    expect(deserializeRegionSplit('{"USA":"50"}')).toBeNull();
    expect(deserializeRegionSplit('{"USA":"50","Mars":"50"}')).toBeNull();
    expect(deserializeRegionSplit('{"USA":100}')).toBeNull();
    expect(deserializeRegionSplit("{}")).toBeNull();
  });

  it("accepts only canonical non-zero record values", () => {
    expect(regionSplitFromRecord({ USA: "60.0", Europa: "40" })).toBeNull();
    expect(regionSplitFromRecord({ USA: "60,5", Europa: "39.5" })).toBeNull();
    expect(regionSplitFromRecord({ USA: "100", Europa: "0" })).toBeNull();
    expect(regionSplitFromRecord({ USA: "60.5", Europa: "39.5" })).toEqual([
      { region: "USA", weight: "60.5" },
      { region: "Europa", weight: "39.5" },
    ]);
  });
});

describe("effectiveRegionSplit", () => {
  const rule = { index: "MSCI World", asOf: "2026-09-30", weights: WORLD as never };
  const manual = [
    { region: "USA" as const, weight: "60" },
    { region: "Europa" as const, weight: "40" },
  ];

  it("prefers the manual split, then a manual region (no split), then the rule split", () => {
    expect(effectiveRegionSplit({ assetType: "ETF", manual, manualRegion: "Europa", rule })).toEqual({
      weights: manual,
      source: "manual",
      index: null,
      asOf: null,
    });
    expect(effectiveRegionSplit({ assetType: "ETF", manual: null, manualRegion: "Europa", rule })).toBeNull();
    expect(effectiveRegionSplit({ assetType: "FUND", manual: null, manualRegion: null, rule })).toEqual({
      weights: WORLD,
      source: "rule",
      index: "MSCI World",
      asOf: "2026-09-30",
    });
    expect(effectiveRegionSplit({ assetType: "ETF", manual: null, manualRegion: null, rule: null })).toBeNull();
  });

  it("is none for every type other than ETF and FUND", () => {
    for (const assetType of ["STOCK", "CERTIFICATE", "CRYPTO", "UNCLASSIFIED"] as const) {
      expect(effectiveRegionSplit({ assetType, manual, manualRegion: null, rule })).toBeNull();
    }
  });
});

describe("distributeByRegion", () => {
  it("distributes 1000 by the World weights", () => {
    expect(distributeByRegion("1000", WORLD as never)).toEqual([
      { region: "USA", value: "720", weight: "0.72" },
      { region: "Europa", value: "150", weight: "0.15" },
      { region: "Japan", value: "60", weight: "0.06" },
      { region: "Pazifik ohne Japan", value: "40", weight: "0.04" },
      { region: "Sonstige", value: "30", weight: "0.03" },
    ]);
  });

  it("gives the last slice the remainder so the slices sum exactly to the value", () => {
    const slices = distributeByRegion("100.01", [
      { region: "USA", weight: "33.33" },
      { region: "Europa", weight: "33.33" },
      { region: "Japan", weight: "33.34" },
    ]);
    // 100.01 × 0.3333 = 33.333333; remainder 100.01 − 2 × 33.333333 = 33.343334.
    expect(slices.map((s) => s.value)).toEqual(["33.333333", "33.333333", "33.343334"]);
    expect(slices.reduce((sum, s) => sum.plus(s.value), new Decimal(0)).toFixed()).toBe("100.01");
    expect(slices.map((s) => s.weight)).toEqual(["0.3333", "0.3333", "0.3334"]);
  });
});
