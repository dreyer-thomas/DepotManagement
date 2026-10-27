import { describe, expect, it } from "vitest";
import { DIMENSIONS, type ClassifiedAssetType } from "@/core/classification";
import type { Classification, DimensionValue } from "@/modules/classification";
import {
  ALLOCATION_DIMENSIONS,
  allocationDimension,
  allocationHoldings,
  allocationHref,
  analysisScope,
  analysisTab,
  groupOf,
} from "./labels";

function dimension(value: string | null, manual: string | null = null): DimensionValue {
  return {
    value: manual ?? value,
    source: manual !== null ? "manual" : value !== null ? "provider" : null,
    manual,
    automatic: { value, source: value !== null ? "provider" : null },
  };
}

function classification(type: ClassifiedAssetType, values: Partial<Record<(typeof DIMENSIONS)[number], DimensionValue>> = {}): Classification {
  const base = Object.fromEntries(DIMENSIONS.map((d) => [d, dimension(null)])) as Record<(typeof DIMENSIONS)[number], DimensionValue>;
  return { ...base, ...values, type };
}

describe("analyses labels", () => {
  it("lists the dimensions in selector order", () => {
    expect(Object.values(ALLOCATION_DIMENSIONS)).toEqual([
      "Anlageklasse",
      "Wertpapiertyp",
      "Sektor",
      "Branche",
      "Region",
      "Land",
      "Unternehmensgröße",
      "Währung",
    ]);
  });

  it("falls back on unknown URL values", () => {
    expect(analysisTab("foo")).toBe("allocation");
    expect(analysisTab(undefined)).toBe("allocation");
    expect(allocationDimension("foo")).toBe("assetClass");
    expect(allocationDimension("toString")).toBe("assetClass");
    expect(allocationDimension(["region", "sector"])).toBe("region");
    expect(analysisScope("unknown", ["d1"])).toBe("portfolio");
    expect(analysisScope(undefined, ["d1"])).toBe("portfolio");
    expect(analysisScope("d1", ["d1"])).toBe("d1");
  });

  it("builds the allocation URL", () => {
    expect(allocationHref("portfolio", "sector")).toBe("/analyses?tab=allocation&scope=portfolio&dimension=sector");
  });

  it("uses the effective value, manual winning", () => {
    expect(groupOf(classification("STOCK", { region: dimension("Europa", "Welt") }), "region")).toBe("Welt");
    expect(groupOf(classification("STOCK", { sector: dimension("Technologie") }), "sector")).toBe("Technologie");
  });

  it("maps missing and null values to Unbekannt (null)", () => {
    expect(groupOf(undefined, "sector")).toBeNull();
    expect(groupOf(classification("ETF"), "sector")).toBeNull();
  });

  it("labels the type dimension from the asset type, UNCLASSIFIED as unknown", () => {
    expect(groupOf(classification("STOCK"), "type")).toBe("Aktie");
    expect(groupOf(classification("ETF"), "type")).toBe("ETF");
    expect(groupOf(classification("UNCLASSIFIED"), "type")).toBeNull();
  });

  it("shows company size – as Nicht zutreffend", () => {
    expect(groupOf(classification("ETF", { companySize: dimension("–") }), "companySize")).toBe("Nicht zutreffend");
    expect(groupOf(classification("STOCK", { companySize: dimension("Large Cap") }), "companySize")).toBe("Large Cap");
  });

  it("adds the group to composition holdings", () => {
    const holdings = allocationHoldings(
      [{ securityId: "s", securityName: "SAP", assetType: "STOCK", depotId: "d", depotName: "D", value: "1" }],
      { s: classification("STOCK", { currency: dimension("EUR") }) },
      "currency",
    );
    expect(holdings[0].group).toBe("EUR");
  });
});
