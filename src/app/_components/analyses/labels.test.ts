import { describe, expect, it } from "vitest";
import { DIMENSIONS, type ClassifiedAssetType } from "@/core/classification";
import type { Classification, DimensionValue } from "@/modules/classification";
import {
  ALLOCATION_DIMENSIONS,
  ANALYSIS_TABS,
  cashFlowAriaLabel,
  DIVIDEND_VIEWS,
  breakdownDefaultMonth,
  breakdownKpis,
  breakdownMonthLabel,
  breakdownSecurityFacts,
  breakdownSinceLabel,
  dividendColor,
  dividendPayingSecurities,
  dividendRunningStart,
  dividendSplits,
  dividendStackedAriaLabel,
  dividendYearLinesAriaLabel,
  wknOf,
  dividendAmount,
  dividendBuckets,
  dividendChartAriaLabel,
  dividendCountText,
  dividendRangeTotal,
  dividendSecuritiesAriaLabel,
  dividendYieldText,
  expectedDividendText,
  sumDividendAmounts,
  gainsBucketLabel,
  gainsBucketShortLabel,
  gainsBuckets,
  gainsChartAriaLabel,
  gainsSalesInRange,
  gainsYears,
  negateAmount,
  sumGainsBuckets,
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
import type { GainsBucket, GainsSale } from "@/core/gains-analysis";
import type { DividendAnalysis } from "@/core/dividend-analysis";

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
    expect(analysisTab("gains")).toBe("gains");
    expect(analysisTab("dividends")).toBe("dividends");
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

describe("gains labels", () => {
  const NBSP = "\u00a0";
  const bucket = (period: string, values: Partial<GainsBucket> = {}): GainsBucket => ({
    period,
    realized: "0",
    dividends: "0",
    fees: "0",
    taxes: "0",
    deposits: "0",
    withdrawals: "0",
    netCashFlow: "0",
    ...values,
  });
  const MONTHS = [bucket("2025-12", { realized: "5" }), bucket("2026-01", { realized: "77.6", dividends: "30", fees: "0.5", taxes: "12.5" }), bucket("2026-02", { realized: "-10", deposits: "100", withdrawals: "40", netCashFlow: "60" })];
  const YEARS = [bucket("2025", { realized: "5" }), bucket("2026", { realized: "67.6", dividends: "30", fees: "0.5", taxes: "12.5", deposits: "100", withdrawals: "40", netCashFlow: "60" })];

  it("adds the Gewinne tab after Rendite", () => {
    expect(ANALYSIS_TABS.map((tab) => tab.label)).toEqual(["Aufteilung", "Rendite", "Gewinne", "Dividenden"]);
  });

  it("picks years newest first and the buckets and sales of a view", () => {
    expect(gainsYears(YEARS)).toEqual(["2026", "2025"]);
    expect(gainsBuckets(MONTHS, YEARS, "months", "2026").map((b) => b.period)).toEqual(["2026-01", "2026-02"]);
    expect(gainsBuckets(MONTHS, YEARS, "years", "2026").map((b) => b.period)).toEqual(["2025", "2026"]);
    const sale = (date: string) => ({ date }) as GainsSale;
    const sales = [sale("2025-12-01"), sale("2026-02-01")];
    expect(gainsSalesInRange(sales, "months", "2026")).toEqual([sales[1]]);
    expect(gainsSalesInRange(sales, "years", "2026")).toEqual(sales);
  });

  it("negates an amount exactly", () => {
    expect(negateAmount("0.5")).toBe("-0.5");
    expect(negateAmount("-300")).toBe("300");
    expect(negateAmount("0")).toBe("0");
    expect(negateAmount("0.00")).toBe("0");
  });

  it("labels buckets and sums a range", () => {
    expect(gainsBucketShortLabel("2026-03")).toBe("Mär");
    expect(gainsBucketShortLabel("2026")).toBe("2026");
    expect(gainsBucketLabel("2026-03")).toBe("März 2026");
    expect(sumGainsBuckets(MONTHS.slice(1))).toEqual({ realized: "67.6", dividends: "30", fees: "0.5", taxes: "12.5", deposits: "100", withdrawals: "40", netCashFlow: "60" });
  });

  it("builds the chart text alternatives with signed values", () => {
    const months = MONTHS.slice(1);
    expect(gainsChartAriaLabel(months, { dividends: false, fees: false })).toBe(
      `Realisierte Gewinne: Januar 2026 Realisiert +77,60${NBSP}€; Februar 2026 Realisiert -10,00${NBSP}€`,
    );
    expect(gainsChartAriaLabel(months.slice(0, 1), { dividends: true, fees: true })).toBe(
      `Realisierte Gewinne: Januar 2026 Realisiert +77,60${NBSP}€, Dividenden +30,00${NBSP}€, Gebühren -0,50${NBSP}€`,
    );
    expect(cashFlowAriaLabel(months)).toBe(`Kapitalfluss (netto): Januar 2026 0,00${NBSP}€; Februar 2026 +60,00${NBSP}€`);
  });
});

describe("dividend labels", () => {
  const NBSP = "\u00a0";
  const ANALYSIS: DividendAnalysis = {
    months: [
      { period: "2025-10", gross: "0", net: "0" },
      { period: "2025-11", gross: "20", net: "14.5" },
      { period: "2025-12", gross: "0", net: "0" },
      { period: "2026-01", gross: "45", net: "35" },
    ],
    years: [
      { period: "2025", gross: "20", net: "14.5" },
      { period: "2026", gross: "45", net: "35" },
    ],
    cumulative: [
      { period: "2025", gross: "20", net: "14.5" },
      { period: "2026", gross: "65", net: "49.5" },
    ],
    bySecurity: [
      {
        securityId: "x",
        count: 2,
        gross: "60",
        net: "44.5",
        lastDate: "2026-01-10",
        trailingGross: "60",
        trailingNet: "44.5",
        costBasis: "1100",
        grossYieldOnCost: "0.05454545454545454545",
        netYieldOnCost: "0.04045454545454545455",
      },
      {
        securityId: "y",
        count: 1,
        gross: "5",
        net: "5",
        lastDate: "2026-01-20",
        trailingGross: "5",
        trailingNet: "5",
        costBasis: null,
        grossYieldOnCost: null,
        netYieldOnCost: null,
      },
    ],
    trailing: { from: "2025-01-31", to: "2026-01-31", gross: "60", net: "44.5", payingValue: "2000", grossYield: "0.03", netYield: "0.02225" },
    expected: [],
    expectedMonths: [
      { period: "2026-01", gross: "0", net: "0" },
      { period: "2026-02", gross: "40", net: "29" },
    ],
    monthsBySecurity: [
      { period: "2025-10", securities: [] },
      { period: "2025-11", securities: [{ securityId: "x", gross: "20", net: "14.5" }] },
      { period: "2025-12", securities: [] },
      {
        period: "2026-01",
        securities: [
          { securityId: "x", gross: "40", net: "30" },
          { securityId: "y", gross: "5", net: "5" },
        ],
      },
    ],
    yearLines: [
      { year: "2025", points: [...Array(10).fill({ gross: "0", net: "0" }), { gross: "20", net: "14.5" }, { gross: "20", net: "14.5" }] },
      { year: "2026", points: [{ gross: "45", net: "35" }, ...Array(11).fill(null)] },
    ],
    forecast: [{ gross: "45", net: "35" }, { gross: "85", net: "64" }, ...Array(10).fill({ gross: "85", net: "64" })],
  };

  it("lists the views in order", () => {
    expect(DIVIDEND_VIEWS.map((view) => view.label)).toEqual([
      "Monatlich (pro Jahr)",
      "Monatlich (fortl.)",
      "Jahre",
      "Akkumuliert",
      "Akkumuliert (pro Jahr)",
      "Breakdown",
      "Wertpapiere",
      "Erwartet",
    ]);
  });

  it("picks the buckets of a view and their total by mode", () => {
    expect(dividendBuckets(ANALYSIS, "months", "2025").map((b) => b.period)).toEqual(["2025-10", "2025-11", "2025-12"]);
    expect(dividendBuckets(ANALYSIS, "running", "2025").map((b) => b.period)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(dividendBuckets(ANALYSIS, "years", "2025")).toEqual(ANALYSIS.years);
    expect(dividendBuckets(ANALYSIS, "cumulative", "2025")).toEqual(ANALYSIS.cumulative);
    expect(dividendBuckets(ANALYSIS, "expected", "2025")).toEqual(ANALYSIS.expectedMonths);
    expect(dividendAmount(ANALYSIS.years[0], "gross")).toBe("20");
    expect(dividendAmount(ANALYSIS.years[0], "net")).toBe("14.5");
    expect(sumDividendAmounts(ANALYSIS.years, "net")).toBe("49.5");
    expect(sumDividendAmounts([], "net")).toBe("0");
    expect(dividendRangeTotal(ANALYSIS.years, "years", "gross")).toBe("65");
    expect(dividendRangeTotal(ANALYSIS.cumulative, "cumulative", "net")).toBe("49.5");
    expect(dividendRangeTotal([], "cumulative", "net")).toBe("0");
  });

  it("formats the yield unsigned, – without one", () => {
    expect(dividendYieldText("0.03")).toBe(`3,00${NBSP}%`);
    expect(dividendYieldText("0.02225")).toBe(`2,23${NBSP}%`);
    expect(dividendYieldText(null)).toBe("–");
  });

  it("builds the text alternatives and list captions", () => {
    expect(dividendChartAriaLabel("Dividenden pro Jahr", ANALYSIS.years, "net")).toBe(`Dividenden pro Jahr (Netto): 2025 14,50${NBSP}€; 2026 35,00${NBSP}€`);
    expect(dividendSecuritiesAriaLabel(ANALYSIS.bySecurity.slice(0, 1), { x: "SAP SE" }, "gross")).toBe(`Dividenden nach Wertpapier (Brutto): SAP SE 60,00${NBSP}€`);
    expect(dividendCountText(2, "2026-01-10")).toBe("2 Zahlungen · zuletzt 10.01.2026");
    expect(dividendCountText(1, "2026-01-10")).toBe("1 Zahlung · zuletzt 10.01.2026");
    expect(expectedDividendText("2026-11-15", "2025-11-15")).toBe("15.11.2026 · aus Zahlung vom 15.11.2025");
  });
  it("colours by index through the theme series, then the logo colours, cycling", () => {
    const series = ["s1", "s2", "s3", "s4", "s5"];
    expect(dividendColor(0, series)).toBe("s1");
    expect(dividendColor(4, series)).toBe("s5");
    expect(dividendColor(5, series)).toBe("#00695C");
    expect(dividendColor(12, series)).toBe("#1B5E20");
    expect(dividendColor(13, series)).toBe("s1");
  });

  it("derives the WKN from a German ISIN only", () => {
    expect(wknOf("DE0007164600")).toBe("716460");
    expect(wknOf("US0378331005")).toBeNull();
    expect(wknOf(null)).toBeNull();
    expect(breakdownSecurityFacts({ name: "SAP SE", isin: "DE0007164600", cryptoSymbol: null, assetType: "STOCK" })).toEqual([
      ["Typ", "Aktie"],
      ["ISIN", "DE0007164600"],
      ["WKN", "716460"],
    ]);
    expect(breakdownSecurityFacts({ name: "Apple", isin: "US0378331005", cryptoSymbol: null, assetType: "STOCK" }).at(-1)).toEqual(["WKN", "–"]);
    expect(breakdownSecurityFacts({ name: "Bitcoin", isin: null, cryptoSymbol: "BTC", assetType: "CRYPTO" }).slice(1)).toEqual([
      ["Symbol", "BTC"],
      ["WKN", "–"],
    ]);
  });

  it("starts the running range at the first payment and lists paying Securities in bySecurity order", () => {
    expect(dividendRunningStart(ANALYSIS)).toBe(1);
    expect(dividendRunningStart({ months: ANALYSIS.months.slice(0, 1), monthsBySecurity: ANALYSIS.monthsBySecurity.slice(0, 1) })).toBe(1);
    expect(dividendSplits(ANALYSIS, "running", "2025").map((m) => m.period)).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(dividendSplits(ANALYSIS, "months", "2025").map((m) => m.period)).toEqual(["2025-10", "2025-11", "2025-12"]);
    expect(dividendPayingSecurities(ANALYSIS.bySecurity, dividendSplits(ANALYSIS, "months", "2025"))).toEqual(["x"]);
    expect(dividendPayingSecurities(ANALYSIS.bySecurity, ANALYSIS.monthsBySecurity)).toEqual(["x", "y"]);
  });

  it("builds the stacked and year-lines text alternatives", () => {
    const splits = dividendSplits(ANALYSIS, "running", "2025");
    const buckets = dividendBuckets(ANALYSIS, "running", "2025");
    expect(dividendStackedAriaLabel("Dividenden pro Monat", buckets, splits, { x: "SAP SE", y: "Yolo AG" }, "gross")).toBe(
      `Dividenden pro Monat (Brutto): November 2025 20,00${NBSP}€ (SAP SE 20,00${NBSP}€); Dezember 2025 0,00${NBSP}€; Januar 2026 45,00${NBSP}€ (SAP SE 40,00${NBSP}€, Yolo AG 5,00${NBSP}€)`,
    );
    const zeros = (labels: string[]) => labels.map((m) => `${m} 0,00${NBSP}€`).join(", ");
    const MONTHS10 = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt"];
    expect(dividendYearLinesAriaLabel(ANALYSIS.yearLines, null, "2026-01-31", "net")).toBe(
      `Dividenden akkumuliert pro Jahr (Netto): 2025: ${zeros(MONTHS10)}, Nov 14,50${NBSP}€, Dez 14,50${NBSP}€; 2026: Jan 35,00${NBSP}€`,
    );
    const forecastMonths = ["Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"].map((m) => `${m} 85,00${NBSP}€`).join(", ");
    expect(dividendYearLinesAriaLabel(ANALYSIS.yearLines, ANALYSIS.forecast, "2026-01-31", "gross")).toBe(
      `Dividenden akkumuliert pro Jahr (Brutto): 2025: ${zeros(MONTHS10)}, Nov 20,00${NBSP}€, Dez 20,00${NBSP}€; 2026: Jan 45,00${NBSP}€; Prognose 2026 (Schätzung): Jan 45,00${NBSP}€, ${forecastMonths}`,
    );
    expect(dividendYearLinesAriaLabel(ANALYSIS.yearLines, Array(12).fill(null), "2026-01-31", "gross")).not.toContain("Prognose");
  });

  it("computes the Breakdown default month and KPIs", () => {
    const splits = dividendSplits(ANALYSIS, "running", "2025");
    expect(breakdownDefaultMonth(splits, "x")).toBe("2026-01");
    expect(breakdownDefaultMonth(splits, "z")).toBeNull();
    expect(breakdownKpis(splits, "x", "2026-01", "gross")).toEqual({ month: "40", sinceJanuary: "40" });
    expect(breakdownKpis(splits, "x", "2025-12", "net")).toEqual({ month: "0", sinceJanuary: "14.5" });
    expect(breakdownKpis(splits, "y", "2025-11", "gross")).toEqual({ month: "0", sinceJanuary: "0" });
    expect(breakdownMonthLabel("2026-05")).toBe("Im Mai 2026");
    expect(breakdownSinceLabel("2026-05")).toBe("Seit Jan. 2026");
    expect(dividendYieldText(ANALYSIS.bySecurity[0].grossYieldOnCost)).toBe(`5,45${NBSP}%`);
    expect(dividendYieldText(ANALYSIS.bySecurity[0].netYieldOnCost)).toBe(`4,05${NBSP}%`);
    expect(dividendYieldText(ANALYSIS.bySecurity[1].grossYieldOnCost)).toBe("–");
  });
});
