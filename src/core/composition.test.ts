import { describe, expect, it } from "vitest";
import {
  type CompositionHolding,
  type CompositionSegment,
  compositionByAssetType,
  compositionByDepot,
  compositionByPosition,
  holdingShares,
  holdingTotals,
} from "./composition";
import { ExactDecimal } from "./decimal";

const LABELS = {
  other: "Sonstige",
  cash: "Guthaben",
  assetType: (type: string) => ({ ETF: "ETF", STOCK: "Aktie", UNCLASSIFIED: "Unklassifiziert" })[type] ?? type,
};

function holding(securityId: string, value: string, extra: Partial<CompositionHolding> = {}): CompositionHolding {
  return { securityId, securityName: `Name ${securityId}`, assetType: "STOCK", depotId: "A", depotName: "Depot A", value, ...extra };
}

const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new ExactDecimal(0)).toFixed();
const shares = (segments: CompositionSegment[]) => sum(segments.map((s) => s.share));
const displayed = (segments: CompositionSegment[]) => sum(segments.map((s) => s.displayShare));
const brief = (segments: CompositionSegment[]) => segments.map((s) => [s.label, s.amount, s.displayShare]);

describe("compositionByPosition", () => {
  it("splits thirds by largest remainder, the first segment taking the extra unit, without a zero cash segment", () => {
    const segments = compositionByPosition([holding("x", "100"), holding("y", "100"), holding("z", "100")], "0", LABELS);
    expect(segments.map((s) => s.displayShare)).toEqual(["0.334", "0.333", "0.333"]);
    expect(segments.map((s) => s.kind)).toEqual(["item", "item", "item"]);
    expect(shares(segments)).toBe("1");
    expect(displayed(segments)).toBe("1");
  });

  it("keeps the top 8 by value, merges the rest into Sonstige and puts Guthaben last", () => {
    const holdings = Array.from({ length: 10 }, (_, i) => holding(`s${i}`, String((i + 1) * 10)));
    const segments = compositionByPosition(holdings, "50", LABELS);
    expect(segments).toHaveLength(10);
    expect(segments.slice(0, 8).map((s) => s.amount)).toEqual(["100", "90", "80", "70", "60", "50", "40", "30"]);
    expect(segments[8]).toMatchObject({ kind: "other", label: "Sonstige", amount: "30" });
    expect(segments[9]).toMatchObject({ kind: "cash", label: "Guthaben", amount: "50" });
    expect(shares(segments)).toBe("1");
    expect(displayed(segments)).toBe("1");
  });

  it("has no Sonstige with exactly 8 Securities", () => {
    const holdings = Array.from({ length: 8 }, (_, i) => holding(`s${i}`, "10"));
    const segments = compositionByPosition(holdings, "0", LABELS);
    expect(segments).toHaveLength(8);
    expect(segments.some((s) => s.kind === "other")).toBe(false);
  });

  it("merges the same Security across Depots", () => {
    const segments = compositionByPosition(
      [holding("x", "300", { depotId: "A" }), holding("x", "200", { depotId: "B", depotName: "Depot B" })],
      "0",
      LABELS,
    );
    expect(brief(segments)).toEqual([["Name x", "500", "1.000"]]);
  });

  it("orders equal amounts by label (de-DE)", () => {
    const segments = compositionByPosition(
      [holding("b", "10", { securityName: "Zeta" }), holding("a", "10", { securityName: "Äpfel" }), holding("c", "20", { securityName: "Beta" })],
      "0",
      LABELS,
    );
    expect(segments.map((s) => s.label)).toEqual(["Beta", "Äpfel", "Zeta"]);
  });

  it("lists negative cash with a negative share, rounds half-up and still sums the shares to 1", () => {
    const segments = compositionByPosition([holding("x", "1000")], "-10", LABELS);
    expect(brief(segments)).toEqual([
      ["Name x", "1000", "1.010"],
      ["Guthaben", "-10", "-0.010"],
    ]);
    expect(segments[1].share.startsWith("-")).toBe(true);
    expect(shares(segments)).toBe("1");
  });

  it("returns nothing for no holdings and zero cash, or a non-positive total", () => {
    expect(compositionByPosition([], "0", LABELS)).toEqual([]);
    expect(compositionByPosition([holding("x", "10")], "-10", LABELS)).toEqual([]);
    expect(compositionByPosition([holding("x", "10")], "-20", LABELS)).toEqual([]);
  });

  it("shows cash alone as 100 % and sums several cash balances", () => {
    expect(brief(compositionByPosition([], ["30", "70"], LABELS))).toEqual([["Guthaben", "100", "1.000"]]);
  });

  it("drops zero-value holdings", () => {
    const segments = compositionByPosition([holding("x", "0"), holding("y", "10")], "0", LABELS);
    expect(segments.map((s) => s.label)).toEqual(["Name y"]);
  });

  it("keeps exact shares summing to 1 for awkward divisions", () => {
    const segments = compositionByPosition([holding("x", "1"), holding("y", "1"), holding("z", "1"), holding("w", "4")], "0.01", LABELS);
    expect(shares(segments)).toBe("1");
    expect(displayed(segments)).toBe("1");
  });
});

describe("compositionByAssetType", () => {
  it("groups by asset type with the given labels and cash last", () => {
    const segments = compositionByAssetType(
      [
        holding("e1", "400", { assetType: "ETF" }),
        holding("s", "300"),
        holding("e2", "200", { assetType: "ETF" }),
        holding("u", "50", { assetType: "UNCLASSIFIED" }),
      ],
      "50",
      LABELS,
    );
    expect(brief(segments)).toEqual([
      ["ETF", "600", "0.600"],
      ["Aktie", "300", "0.300"],
      ["Unklassifiziert", "50", "0.050"],
      ["Guthaben", "50", "0.050"],
    ]);
  });
});

describe("compositionByDepot", () => {
  it("gives each Depot its Positions value and keeps all cash in Guthaben", () => {
    const segments = compositionByDepot(
      [holding("x", "500"), holding("y", "200"), holding("x", "200", { depotId: "B", depotName: "Depot B" })],
      ["100", "0"],
      LABELS,
    );
    expect(brief(segments)).toEqual([
      ["Depot A", "700", "0.700"],
      ["Depot B", "200", "0.200"],
      ["Guthaben", "100", "0.100"],
    ]);
    expect(segments.map((s) => s.kind)).toEqual(["item", "item", "cash"]);
  });
});

describe("holdingShares", () => {
  it("divides each value by the values plus cash, keeping null for unpriced holdings", () => {
    expect(holdingShares(["300", null, "100"], ["50", "50"])).toEqual(["0.6", null, "0.2"]);
  });

  it("rounds to 30 decimal places", () => {
    expect(holdingShares(["1", "2"], "0")).toEqual(["0.333333333333333333333333333333", "0.666666666666666666666666666667"]);
  });

  it("gives null everywhere when the total is not positive", () => {
    expect(holdingShares(["0", null], "0")).toEqual([null, null]);
    expect(holdingShares(["10"], "-20")).toEqual([null]);
    expect(holdingShares([], "100")).toEqual([]);
  });
});

describe("holdingTotals", () => {
  it("sums the priced values and the cash balances", () => {
    expect(holdingTotals(["300.5", null, "100"], ["50", "-0.5"])).toEqual({ positionsValue: "400.5", cash: "49.5" });
    expect(holdingTotals([], "0")).toEqual({ positionsValue: "0", cash: "0" });
  });
});
