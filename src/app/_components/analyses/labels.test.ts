import { describe, expect, it } from "vitest";
import { DIMENSIONS, type ClassifiedAssetType } from "@/core/classification";
import type { Classification, DimensionValue } from "@/modules/classification";
import {
  ALLOCATION_DIMENSIONS,
  allocationDimension,
  allocationHoldings,
  allocationHref,
  analysisHref,
  analysisScope,
  analysisTab,
  groupOf,
  heatmapCellTone,
  heatmapTintAlpha,
} from "./labels";
import { getContrastRatio } from "@mui/material/styles";
import { colors } from "@/theme/tokens";

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

  it("knows the Rendite tab and builds its URL keeping scope and dimension", () => {
    expect(analysisTab("returns")).toBe("returns");
    expect(analysisHref("returns", "d1", "region")).toBe("/analyses?tab=returns&scope=d1&dimension=region");
  });

  it("tints heatmap cells by sign with an intensity capped at 10 %", () => {
    expect(heatmapCellTone(null)).toEqual({ tone: "neutral", intensity: 0 });
    expect(heatmapCellTone("0")).toEqual({ tone: "neutral", intensity: 0 });
    expect(heatmapCellTone("0.05")).toEqual({ tone: "gain", intensity: 0.5 });
    expect(heatmapCellTone("-0.02")).toEqual({ tone: "loss", intensity: 0.2 });
    expect(heatmapCellTone("0.35")).toEqual({ tone: "gain", intensity: 1 });
    expect(heatmapCellTone("-1")).toEqual({ tone: "loss", intensity: 1 });
    // Decided as displayed: shows as 0,00 % → neutral; 0,01 % → tinted.
    expect(heatmapCellTone("0.00003")).toEqual({ tone: "neutral", intensity: 0 });
    expect(heatmapCellTone("-0.00004")).toEqual({ tone: "neutral", intensity: 0 });
    expect(heatmapCellTone("0.00005").tone).toBe("gain");
  });

  it("keeps the cell text at WCAG AA contrast on the strongest tint in both schemes", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    const blend = (tint: string, surface: string, alpha: number) =>
      `rgb(${rgb(tint)
        .map((value, i) => Math.round(value * alpha + rgb(surface)[i] * (1 - alpha)))
        .join(", ")})`;
    for (const tone of ["gain", "loss"] as const) {
      expect(getContrastRatio(blend(colors[tone], colors.surface, heatmapTintAlpha(1, "light")), colors.ink)).toBeGreaterThanOrEqual(4.5);
      expect(
        getContrastRatio(blend(colors[`${tone}-dark`], colors["surface-dark"], heatmapTintAlpha(1, "dark")), colors["ink-dark"]),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(heatmapTintAlpha(0, "light")).toBeCloseTo(0.12);
    expect(heatmapTintAlpha(1, "light")).toBeCloseTo(0.6);
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
