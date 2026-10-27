import { describe, expect, it } from "vitest";
import { NO_CORPORATE_ACTIONS } from "./corporate-actions";
import type { GainsRow } from "./gains-analysis";
import {
  distributeDeposit,
  parseTargets,
  rebalancing,
  type RebalancingHolding,
  type RebalancingInput,
  type Segment,
  SEGMENTS,
  segmentSlices,
  type SegmentClassification,
  targetRecord,
  type Targets,
  targetsFromRecord,
  isThreshold,
} from "./rebalancing";
import type { RegionWeights } from "./region-split";
import type { TaxAllowanceInput, TaxSecurity } from "./tax";

const TODAY = "2026-10-27";

const US_STOCK: SegmentClassification = { type: "STOCK", assetClass: "Aktien", region: "USA", country: "USA" };
const EU_STOCK: SegmentClassification = { type: "STOCK", assetClass: "Aktien", region: "Europa", country: "Deutschland" };
const WORLD_ETF: SegmentClassification = { type: "ETF", assetClass: "Aktien", region: "Welt", country: null };
const BOND_ETF: SegmentClassification = { type: "ETF", assetClass: "Anleihen", region: "Welt", country: null };
const MSCI_WORLD: RegionWeights = [
  { region: "USA", weight: "72" },
  { region: "Europa", weight: "15" },
  { region: "Japan", weight: "6" },
  { region: "Pazifik ohne Japan", weight: "4" },
  { region: "Sonstige", weight: "3" },
];

function targets(percent: Partial<Record<Segment, string>>): Targets {
  return Object.fromEntries(SEGMENTS.map((segment) => [segment, percent[segment] ?? "0"])) as Targets;
}

let sequence = 0;
function buy(securityId: string, quantity: string, amount: string, date = "2026-01-10"): GainsRow {
  return { securityId, type: "BUY", date, sequence: ++sequence, quantity, amount, fee: "0", tax: "0" };
}

type Fixture = {
  holding: RebalancingHolding;
  rows: GainsRow[];
};

/** A priced holding in Depot d1 with its BUY lots (`[quantity, cost]`). */
function holding(
  securityId: string,
  classification: SegmentClassification,
  price: string,
  lots: [string, string][],
  split: RegionWeights | null = null,
  depotId = "d1",
): Fixture {
  const quantity = lots.reduce((total, [q]) => total + Number(q), 0);
  return {
    holding: { securityId, depotId, quantity: String(quantity), price, value: String(quantity * Number(price)), classification, split },
    rows: lots.map(([q, cost]) => buy(securityId, q, cost)),
  };
}

const STOCK: TaxSecurity = { category: "stock", teilfreistellung: "0" };
const EQUITY_FUND: TaxSecurity = { category: "fund", teilfreistellung: "0.3" };

function input(
  fixtures: Fixture[],
  options: {
    cash?: string[];
    targets?: Partial<Record<Segment, string>> | null;
    threshold?: string;
    deposit?: string;
    securities?: Record<string, TaxSecurity>;
    allowances?: TaxAllowanceInput[];
    extraRows?: GainsRow[];
  } = {},
): RebalancingInput {
  return {
    holdings: fixtures.map((fixture) => fixture.holding),
    cash: (options.cash ?? []).map((value) => ({ depotId: "d1", value })),
    targets: options.targets === null || options.targets === undefined ? null : { targets: targets(options.targets), threshold: options.threshold ?? "2" },
    deposit: options.deposit ?? "0",
    tax: {
      depots: [{ depotId: "d1", broker: "COMDIRECT", rows: [...(options.extraRows ?? []), ...fixtures.flatMap((fixture) => fixture.rows)] }],
      actions: NO_CORPORATE_ACTIONS,
      securities: options.securities ?? {},
      allowances: options.allowances ?? [],
    },
    today: TODAY,
  };
}

const values = (result: ReturnType<typeof rebalancing>) => Object.fromEntries(result.segments.map((row) => [row.segment, row.value]));

describe("segmentSlices", () => {
  it("maps asset classes, crypto and single regions", () => {
    const slice = (classification: Partial<SegmentClassification>) =>
      segmentSlices("100", { type: "STOCK", assetClass: null, region: null, country: null, ...classification }, null).map((entry) => entry.segment);
    expect(slice({ type: "CRYPTO" })).toEqual(["crypto"]);
    expect(slice({ type: "ETF", assetClass: "Krypto" })).toEqual(["crypto"]);
    expect(slice({ type: "ETF", assetClass: "Geldmarkt" })).toEqual(["cash"]);
    expect(slice({ type: "ETF", assetClass: "Anleihen" })).toEqual(["bonds"]);
    expect(slice({ type: "ETF", assetClass: "Rohstoffe" })).toEqual(["commodities"]);
    expect(slice({ type: "ETF", assetClass: "Immobilien" })).toEqual(["realEstate"]);
    expect(slice({ type: "ETF", assetClass: "Gemischt" })).toEqual([null]);
    expect(slice({ type: "CERTIFICATE", assetClass: "Derivate" })).toEqual([null]);
    expect(slice({ type: "UNCLASSIFIED" })).toEqual([null]);
    // Single region: Asien-Pazifik is Japan only for the country Japan; Nordamerika counts as USA.
    expect(slice({ assetClass: "Aktien", region: "Asien-Pazifik", country: "Japan" })).toEqual(["equityJapan"]);
    expect(slice({ assetClass: "Aktien", region: "Asien-Pazifik", country: "Australien" })).toEqual(["equityPacificExJapan"]);
    expect(slice({ assetClass: "Aktien", region: "Nordamerika", country: "Kanada" })).toEqual(["equityUsa"]);
    expect(slice({ assetClass: "Aktien", region: "Schwellenländer" })).toEqual(["equityEmerging"]);
    expect(slice({ assetClass: "Aktien", region: "Europa" })).toEqual(["equityEurope"]);
    expect(slice({ assetClass: "Aktien", region: null })).toEqual([null]);
    expect(slice({ type: "ETF", assetClass: "Aktien", region: "Welt" })).toEqual([null]);
  });

  it("distributes an equity fund by its split, Sonstige unassigned, summing exactly", () => {
    expect(segmentSlices("1000", WORLD_ETF, MSCI_WORLD)).toEqual([
      { segment: "equityUsa", value: "720", weight: "0.72" },
      { segment: "equityEurope", value: "150", weight: "0.15" },
      { segment: "equityJapan", value: "60", weight: "0.06" },
      { segment: "equityPacificExJapan", value: "40", weight: "0.04" },
      { segment: null, value: "30", weight: "0.03" },
    ]);
    // A bond fund ignores a split: its asset class decides.
    expect(segmentSlices("300", BOND_ETF, MSCI_WORLD)).toEqual([{ segment: "bonds", value: "300", weight: "1" }]);
  });
});

describe("parseTargets", () => {
  it("accepts German input, empty fields as 0 and the default threshold", () => {
    expect(parseTargets({ equityUsa: "60,5", equityEurope: "39.5", bonds: "" }, "")).toEqual({
      ok: true,
      targets: targets({ equityUsa: "60.5", equityEurope: "39.5" }),
      threshold: "2",
    });
    expect(parseTargets({ cash: "100" }, "2,25")).toMatchObject({ ok: true, threshold: "2.25" });
  });

  it("rejects invalid values, a wrong sum and an invalid threshold", () => {
    expect(parseTargets({ equityUsa: "60", equityEurope: "39,5" }, "2")).toEqual({ ok: false, reason: "target-sum" });
    expect(parseTargets({ equityUsa: "-10", cash: "110" }, "2")).toEqual({ ok: false, reason: "target-invalid", segment: "equityUsa" });
    expect(parseTargets({ equityUsa: "abc" }, "2")).toEqual({ ok: false, reason: "target-invalid", segment: "equityUsa" });
    expect(parseTargets({ bonds: "33,333" }, "2")).toEqual({ ok: false, reason: "target-invalid", segment: "bonds" });
    expect(parseTargets({ bonds: "101" }, "2")).toEqual({ ok: false, reason: "target-invalid", segment: "bonds" });
    expect(parseTargets({ bonds: 100 }, "2")).toEqual({ ok: false, reason: "target-invalid", segment: "bonds" });
    for (const threshold of ["-1", "x", "1,234", "101", 2]) {
      expect(parseTargets({ cash: "100" }, threshold)).toEqual({ ok: false, reason: "threshold-invalid" });
    }
  });
});

describe("targetRecord / targetsFromRecord / isThreshold", () => {
  it("round-trips non-zero targets and rejects malformed records", () => {
    const parsed = targets({ equityUsa: "60.5", bonds: "39.5" });
    expect(targetRecord(parsed)).toEqual({ equityUsa: "60.5", bonds: "39.5" });
    expect(targetsFromRecord({ equityUsa: "60.5", bonds: "39.5" })).toEqual(parsed);
    for (const record of [{ equityUsa: "60", bonds: "39.5" }, { equityUsa: "60.50", bonds: "39.5" }, { equityUsa: "100", gold: "0" }, { cash: "0", equityUsa: "100" }, { cash: 100 }, [], null, {}]) {
      expect(targetsFromRecord(record)).toBeNull();
    }
    expect(isThreshold("2")).toBe(true);
    expect(isThreshold("0.25")).toBe(true);
    for (const value of ["2.0", "-1", "100.01", "", "2,5", 2]) expect(isThreshold(value)).toBe(false);
  });
});

describe("distributeDeposit", () => {
  it("fills the largest deficit first, each up to its deficit", () => {
    const actual = { ...targets({}), equityUsa: "700", equityEurope: "300" };
    // Deficits on 2.000: Europa 700, USA 300.
    expect(distributeDeposit(actual, targets({ equityUsa: "50", equityEurope: "50" }), "1000")).toMatchObject({ equityEurope: "700", equityUsa: "300" });
    // 500 € goes entirely to Europa (largest deficit 450 on 1.500), the rest to USA.
    expect(distributeDeposit(actual, targets({ equityUsa: "50", equityEurope: "50" }), "500")).toMatchObject({ equityEurope: "450", equityUsa: "50" });
    // Ties in segment order.
    expect(distributeDeposit({ ...targets({}), bonds: "100" }, targets({ equityUsa: "40", equityEurope: "40", bonds: "20" }), "20")).toMatchObject({
      equityUsa: "20",
      equityEurope: "0",
      bonds: "0",
    });
  });
});

describe("rebalancing", () => {
  it("maps a World ETF, a US stock, a bond ETF and cash; segments plus unassigned equal the scope value", () => {
    const result = rebalancing(
      input(
        [
          holding("world", WORLD_ETF, "100", [["10", "800"]], MSCI_WORLD),
          holding("us", US_STOCK, "50", [["10", "400"]]),
          holding("bond", BOND_ETF, "30", [["10", "300"]]),
        ],
        { cash: ["200"] },
      ),
    );
    expect(values(result)).toEqual({
      equityUsa: "1220",
      equityEurope: "150",
      equityJapan: "60",
      equityPacificExJapan: "40",
      equityEmerging: "0",
      bonds: "300",
      commodities: "0",
      realEstate: "0",
      crypto: "0",
      cash: "200",
    });
    expect(result).toMatchObject({ total: "2000", assignable: "1970", unassigned: { value: "30", holdings: [{ securityId: "world", depotId: "d1", value: "30" }] } });
    expect(result.segments[0]).toMatchObject({ share: "0.6192893401", target: null, deviationPoints: null, inRange: null });
    expect(result.proposal).toBeNull();
  });

  it("buys the deposit into the largest deficits; both segments end in range", () => {
    const result = rebalancing(
      input([holding("us", US_STOCK, "70", [["10", "500"]]), holding("eu", EU_STOCK, "30", [["10", "300"]])], {
        targets: { equityUsa: "50", equityEurope: "50" },
        deposit: "1000",
      }),
    );
    expect(result.proposal).toMatchObject({
      deposit: "1000",
      buys: [
        { segment: "equityUsa", amount: "300", instrument: { kind: "security", securityId: "us" } },
        { segment: "equityEurope", amount: "700", instrument: { kind: "security", securityId: "eu" } },
      ],
      sells: [],
      inRange: ["equityUsa", "equityEurope"],
      totalBuys: "1000",
      totalSells: "0",
      cashLeft: "0",
    });
  });

  it("does not trade segments within the threshold", () => {
    const result = rebalancing(
      input([holding("us", US_STOCK, "61", [["10", "500"]]), holding("eu", EU_STOCK, "39", [["10", "300"]])], {
        targets: { equityUsa: "60", equityEurope: "40" },
      }),
    );
    expect(result.segments.slice(0, 2)).toMatchObject([
      { deviationPoints: "1", deviationAmount: "10", inRange: true },
      { deviationPoints: "-1", deviationAmount: "-10", inRange: true },
    ]);
    expect(result.proposal).toMatchObject({ buys: [], sells: [], inRange: ["equityUsa", "equityEurope"], totalTax: "0", cashLeft: "0" });
    // An empty segment with target 0 is neither in nor out of range.
    expect(result.segments.find((row) => row.segment === "bonds")).toMatchObject({ value: "0", target: "0", deviationPoints: "0", inRange: null });
  });

  it("rebalances an overweight segment into the largest holding of the underweight one", () => {
    const result = rebalancing(
      input(
        [
          holding("us", US_STOCK, "70", [["10", "700"]]),
          holding("eu-small", EU_STOCK, "10", [["10", "100"]]),
          holding("eu", EU_STOCK, "20", [["10", "200"]]),
        ],
        { targets: { equityUsa: "50", equityEurope: "50" }, securities: { us: STOCK } },
      ),
    );
    expect(result.segments.slice(0, 2)).toMatchObject([
      { deviationPoints: "20", deviationAmount: "200", inRange: false },
      { deviationPoints: "-20", deviationAmount: "-200", inRange: false },
    ]);
    expect(result.proposal).toMatchObject({
      buys: [{ segment: "equityEurope", amount: "200", instrument: { kind: "security", securityId: "eu" } }],
      sells: [{ segment: "equityUsa", kind: "security", securityId: "us", depotId: "d1", quantity: "2.857143", amount: "200" }],
      totalBuys: "200",
      totalSells: "200",
      cashLeft: "0",
    });
  });

  it("names no instrument for a segment without holdings and keeps empty zero-target segments out of 'im Rahmen'", () => {
    const result = rebalancing(input([holding("us", US_STOCK, "100", [["10", "1000"]])], { targets: { equityUsa: "99", bonds: "1" }, threshold: "2" }));
    // Bonds deviate 1 point (in range); USA too.
    expect(result.proposal).toMatchObject({ buys: [], sells: [], inRange: ["equityUsa", "bonds"] });
    const out = rebalancing(input([holding("us", US_STOCK, "100", [["10", "1000"]])], { targets: { equityUsa: "50", bonds: "50" } }));
    expect(out.proposal?.buys).toEqual([{ segment: "bonds", amount: "500", instrument: null }]);
  });

  it("sells losses first, up to the slice, then the smallest gain", () => {
    // USA: stock A 1.000 € (unit cost 80 → +20 %), stock B 100 € (unit cost 110 → −10 %); cash 900 €.
    const result = rebalancing(
      input([holding("a", US_STOCK, "100", [["10", "800"]]), holding("b", US_STOCK, "100", [["1", "110"]])], {
        cash: ["900"],
        targets: { equityUsa: "47.5", cash: "52.5" },
        securities: { a: STOCK, b: STOCK },
      }),
    );
    expect(result.proposal?.sells).toEqual([
      { segment: "equityUsa", kind: "security", securityId: "b", depotId: "d1", quantity: "1", amount: "100", gain: "-10", tax: "0" },
      { segment: "equityUsa", kind: "security", securityId: "a", depotId: "d1", quantity: "0.5", amount: "50", gain: "10", tax: "0" },
    ]);
    expect(result.proposal?.buys).toEqual([{ segment: "cash", amount: "150", instrument: { kind: "cash" } }]);
  });

  it("sells cash at a ratio of 0: after losses, before gains", () => {
    const result = rebalancing(
      input([holding("mm-loss", { ...BOND_ETF, assetClass: "Geldmarkt" }, "100", [["1", "120"]]), holding("mm-gain", { ...BOND_ETF, assetClass: "Geldmarkt" }, "100", [["5", "400"]])], {
        cash: ["100"],
        targets: { cash: "50", bonds: "50" },
      }),
    );
    expect(result.proposal?.sells.map((sell) => [sell.kind, sell.securityId, sell.amount, sell.gain, sell.tax])).toEqual([
      ["security", "mm-loss", "100", "-20", "0"],
      ["cash", null, "100", "0", "0"],
      ["security", "mm-gain", "150", "30", "2.64"],
    ]);
  });

  it("estimates the tax with the remaining allowance (comdirect allowance 100, gain 300)", () => {
    const result = rebalancing(
      input([holding("us", US_STOCK, "100", [["10", "700"]])], {
        cash: ["1000"],
        targets: { cash: "100" },
        securities: { us: STOCK },
        allowances: [{ broker: "COMDIRECT", year: 2026, amount: "100" }],
      }),
    );
    expect(result.proposal).toMatchObject({
      sells: [{ securityId: "us", quantity: "10", amount: "1000", gain: "300", tax: "52.75" }],
      buys: [{ segment: "cash", amount: "1000", instrument: { kind: "cash" } }],
      totalTax: "52.75",
      cashLeft: "0",
    });
  });

  it("applies the Teilfreistellung of an equity fund (gain 1.000, allowance 0 → tax 184,63)", () => {
    const usFund: SegmentClassification = { type: "ETF", assetClass: "Aktien", region: "USA", country: null };
    const result = rebalancing(input([holding("fund", usFund, "200", [["10", "1000"]])], { targets: { cash: "100" }, securities: { fund: EQUITY_FUND } }));
    expect(result.proposal).toMatchObject({
      sells: [{ securityId: "fund", amount: "2000", gain: "1000", tax: "184.63" }],
      buys: [{ segment: "cash", amount: "2000", instrument: { kind: "cash" } }],
      totalTax: "184.63",
    });
  });

  it("gives a negative tax when a sale's loss offsets a gain realized earlier this year", () => {
    // Earlier this year: stock A bought for 500, sold for 700 (gain 200 → 52,75 € tax without allowance).
    const earlier = [buy("a", "10", "500", "2026-01-05"), { ...buy("a", "10", "700", "2026-03-01"), type: "SELL" }];
    const result = rebalancing(
      input([holding("b", US_STOCK, "80", [["10", "1000"]])], { targets: { cash: "100" }, securities: { a: STOCK, b: STOCK }, extraRows: earlier }),
    );
    expect(result.proposal).toMatchObject({ sells: [{ securityId: "b", amount: "800", gain: "-200", tax: "-52.75" }], totalTax: "-52.75" });
  });

  it("shares a fund's lots across its segments and sums the per-sale taxes to the total", () => {
    // World fund 50/50 USA/Europa, 10 units at 100: lot 1 (5 units, cost 600: loss), lot 2 (5 units, cost 250: gain).
    const split: RegionWeights = [
      { region: "USA", weight: "50" },
      { region: "Europa", weight: "50" },
    ];
    const result = rebalancing(
      input([holding("world", WORLD_ETF, "100", [["5", "600"], ["5", "250"]], split)], {
        cash: ["1000"],
        targets: { cash: "100" },
        securities: { world: EQUITY_FUND },
      }),
    );
    // USA takes lot 1 (−100); Europa continues with lot 2 (+250). Fund income −70, then +105 → 26,25 + 1,44.
    expect(result.proposal?.sells).toEqual([
      { segment: "equityUsa", kind: "security", securityId: "world", depotId: "d1", quantity: "5", amount: "500", gain: "-100", tax: "0" },
      { segment: "equityEurope", kind: "security", securityId: "world", depotId: "d1", quantity: "5", amount: "500", gain: "250", tax: "27.69" },
    ]);
    expect(result.proposal).toMatchObject({ totalSells: "1000", totalBuys: "1000", totalTax: "27.69", cashLeft: "0" });
  });

  it("rounds trades half-up to cents and keeps the difference as Saldo Guthaben", () => {
    // A 1.000: USA 1.000; targets USA 66,67 / Europa 33,33 → sell 333,30, buy 333,30 (no Europa holding).
    const result = rebalancing(input([holding("us", US_STOCK, "100", [["10", "1000"]])], { targets: { equityUsa: "66.67", equityEurope: "33.33" }, deposit: "0.01" }));
    // Base 1.000,01: Europa target 333,303333 → 333,30; USA 666,706667 − 1.000 → −333,29.
    expect(result.proposal).toMatchObject({
      buys: [{ segment: "equityEurope", amount: "333.3", instrument: null }],
      sells: [{ segment: "equityUsa", amount: "333.29", quantity: "3.3329" }],
      cashLeft: "0",
    });
  });
  it("lets the Teilfreistellung change the sell order (fund ratio 0,20 × 0,7 = 0,14 before stock 0,15)", () => {
    const usFund: SegmentClassification = { type: "ETF", assetClass: "Aktien", region: "USA", country: null };
    const result = rebalancing(
      input([holding("stock", US_STOCK, "100", [["10", "850"]]), holding("fund", usFund, "100", [["10", "800"]])], {
        targets: { equityUsa: "95", cash: "5" },
        securities: { stock: STOCK, fund: EQUITY_FUND },
      }),
    );
    expect(result.proposal?.sells).toMatchObject([{ securityId: "fund", quantity: "1", amount: "100", gain: "20" }]);
    // No cash balance in scope: the cash buy is still held as cash.
    expect(result.proposal?.buys).toEqual([{ segment: "cash", amount: "100", instrument: { kind: "cash" } }]);
  });

  it("skips a sale whose quantity rounds to 0 units", () => {
    // 0,001 units at 10.000.000 €; selling 2 € would be 0,0000002 units.
    const result = rebalancing(
      input([holding("pricey", US_STOCK, "10000000", [["0.001", "5000"]])], { cash: ["10000"], targets: { equityUsa: "49.99", cash: "50.01" }, threshold: "0", securities: { pricey: STOCK } }),
    );
    expect(result.proposal).toMatchObject({ sells: [], buys: [{ segment: "cash", amount: "2" }], totalTax: "0", cashLeft: "-2" });
  });

  it("estimates with every Depot of the broker but takes the gain from the selling Depot's lots", () => {
    // d2 (same broker, out of scope) realized 1.000 this year, using up the 1.000 allowance, and holds "s" at 90.
    const d2Rows: GainsRow[] = [
      buy("x", "10", "500", "2026-01-05"),
      { ...buy("x", "10", "1500", "2026-03-01"), type: "SELL" },
      buy("s", "10", "900", "2026-02-01"),
    ];
    const base = input([holding("s", US_STOCK, "100", [["10", "700"]])], {
      targets: { cash: "100" },
      securities: { s: STOCK, x: STOCK },
      allowances: [{ broker: "COMDIRECT", year: 2026, amount: "1000" }],
    });
    const alone = rebalancing(base);
    expect(alone.proposal?.sells).toMatchObject([{ depotId: "d1", gain: "300", tax: "0" }]);
    const withD2 = rebalancing({ ...base, tax: { ...base.tax, depots: [...base.tax.depots, { depotId: "d2", broker: "COMDIRECT", rows: d2Rows }] } });
    // Gain 300 from d1's lots (70 each, not d2's 90); 1.300 − 1.000 allowance → 75 + 4,13.
    expect(withD2.proposal?.sells).toMatchObject([{ depotId: "d1", quantity: "10", amount: "1000", gain: "300", tax: "79.13" }]);
  });

  it("sells units beyond the FIFO lots last, at zero cost, until the trade is reached", () => {
    // Stock A: 12 units at 100 but lots for 10 (cost 800); stock B: 1 unit at cost 50; cash 700 → A = 2.000.
    const a = holding("a", US_STOCK, "100", [["10", "800"]]);
    a.holding = { ...a.holding, quantity: "12", value: "1200" };
    const result = rebalancing(
      input([a, holding("b", US_STOCK, "100", [["1", "50"]])], { cash: ["700"], targets: { equityUsa: "7.5", cash: "92.5" }, securities: { a: STOCK, b: STOCK } }),
    );
    // Sell 1.150: A's lot (ratio 0,2) 1.000, B (0,5) 100, then A's zero-cost units (1,0) 50.
    expect(result.proposal?.sells).toMatchObject([
      { securityId: "a", quantity: "10.5", amount: "1050", gain: "250" },
      { securityId: "b", quantity: "1", amount: "100", gain: "50" },
    ]);
    expect(result.proposal).toMatchObject({ totalSells: "1150", totalBuys: "1150", cashLeft: "0" });
  });
});
