import { describe, expect, it } from "vitest";
import { type AllocationHolding, allocation } from "./allocation";
import type { CompositionSegment } from "./composition";
import { ExactDecimal } from "./decimal";

const LABELS = { cash: "Guthaben", unknown: "Unbekannt" };

function holding(securityId: string, value: string, group: string | null, extra: Partial<AllocationHolding> = {}): AllocationHolding {
  return { securityId, securityName: `Name ${securityId}`, assetType: "STOCK", depotId: "A", depotName: "Depot A", value, group, ...extra };
}

const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new ExactDecimal(0)).toFixed();
const shares = (segments: CompositionSegment[]) => sum(segments.map((s) => s.share));
const displayed = (segments: CompositionSegment[]) => sum(segments.map((s) => s.displayShare));
const brief = (segments: CompositionSegment[]) => segments.map((s) => [s.key, s.label, s.amount, s.displayShare]);

describe("allocation", () => {
  it("groups by value, puts Unbekannt and Guthaben last and lists each segment's Positions", () => {
    const result = allocation([holding("sap", "600", "Technologie"), holding("etf", "300", null)], "100", LABELS);
    expect(brief(result.segments)).toEqual([
      ["group:Technologie", "Technologie", "600", "0.600"],
      ["unknown", "Unbekannt", "300", "0.300"],
      ["cash", "Guthaben", "100", "0.100"],
    ]);
    expect(result.segments.map((s) => s.kind)).toEqual(["item", "item", "cash"]);
    expect(shares(result.segments)).toBe("1");
    expect(displayed(result.segments)).toBe("1");
    expect(result.positions["group:Technologie"]).toEqual([
      { securityId: "sap", securityName: "Name sap", depotId: "A", depotName: "Depot A", value: "600", share: "0.6" },
    ]);
    expect(result.positions.unknown.map((p) => [p.securityId, p.share])).toEqual([["etf", "0.3"]]);
    expect(result.positions.cash).toBeUndefined();
  });

  it("merges a group across Depots and lists both Positions by value", () => {
    const result = allocation(
      [
        holding("sap", "200", "Technologie", { depotId: "A", depotName: "Depot A" }),
        holding("sap", "300", "Technologie", { depotId: "B", depotName: "Depot B" }),
        holding("bmw", "400", "Zyklische Konsumgüter", { depotId: "B", depotName: "Depot B" }),
      ],
      ["50", "50"],
      LABELS,
    );
    expect(brief(result.segments)).toEqual([
      ["group:Technologie", "Technologie", "500", "0.500"],
      ["group:Zyklische Konsumgüter", "Zyklische Konsumgüter", "400", "0.400"],
      ["cash", "Guthaben", "100", "0.100"],
    ]);
    expect(result.positions["group:Technologie"].map((p) => [p.depotName, p.value, p.share])).toEqual([
      ["Depot B", "300", "0.3"],
      ["Depot A", "200", "0.2"],
    ]);
  });

  it("orders ties by label (de-DE) and keeps Unbekannt after larger and smaller groups", () => {
    const result = allocation(
      [holding("a", "100", "Österreich"), holding("b", "100", "Belgien"), holding("c", "500", null), holding("d", "50", "USA")],
      "0",
      LABELS,
    );
    expect(result.segments.map((s) => s.label)).toEqual(["Belgien", "Österreich", "USA", "Unbekannt"]);
    expect(shares(result.segments)).toBe("1");
    expect(displayed(result.segments)).toBe("1");
  });

  it("counts a group named like the unknown label as unclassified", () => {
    const result = allocation([holding("a", "100", "Unbekannt"), holding("b", "100", null)], "0", LABELS);
    expect(brief(result.segments)).toEqual([["unknown", "Unbekannt", "200", "1.000"]]);
    expect(result.positions.unknown).toHaveLength(2);
  });

  it("splits thirds by largest remainder with exact shares summing to 1", () => {
    const result = allocation([holding("a", "100", "X"), holding("b", "100", "Y")], "100", LABELS);
    expect(result.segments.map((s) => s.displayShare)).toEqual(["0.334", "0.333", "0.333"]);
    expect(shares(result.segments)).toBe("1");
    expect(displayed(result.segments)).toBe("1");
  });

  it("lists negative cash without dropping it; Position shares refer to the total incl. cash", () => {
    const result = allocation([holding("a", "550", "Aktien")], "-50", LABELS);
    expect(brief(result.segments)).toEqual([
      ["group:Aktien", "Aktien", "550", "1.100"],
      ["cash", "Guthaben", "-50", "-0.100"],
    ]);
    expect(shares(result.segments)).toBe("1");
    expect(result.positions["group:Aktien"][0].share).toBe("1.1");
  });

  it("is empty without holdings and cash", () => {
    expect(allocation([], "0", LABELS)).toEqual({ segments: [], positions: {} });
  });

  it("shows only cash when nothing is held", () => {
    const result = allocation([], ["40", "60"], LABELS);
    expect(brief(result.segments)).toEqual([["cash", "Guthaben", "100", "1.000"]]);
    expect(result.positions).toEqual({});
  });

  it("leaves out an Unbekannt segment of zero", () => {
    const result = allocation([holding("a", "100", "Aktien")], "0", LABELS);
    expect(result.segments.map((s) => s.key)).toEqual(["group:Aktien"]);
  });
});
