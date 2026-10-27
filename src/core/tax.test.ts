import { describe, expect, it } from "vitest";
import { NO_CORPORATE_ACTIONS, type CorporateActions } from "./corporate-actions";
import type { GainsRow } from "./gains-analysis";
import { allowanceSumExceedsLimit, type TaxPreviewInput, type TaxSecurity, taxPreview, taxSecurity } from "./tax";

const TODAY = "2026-10-27";

let sequence = 0;
function row(type: string, date: string, input: Partial<GainsRow> = {}): GainsRow {
  return {
    securityId: input.securityId ?? null,
    type,
    date,
    sequence: input.sequence ?? ++sequence,
    quantity: input.quantity ?? null,
    price: input.price ?? null,
    amount: input.amount ?? "0",
    fee: input.fee ?? "0",
    tax: input.tax ?? "0",
  };
}

/** A BUY at 1000 and a SELL of the same unit at `1000 + gain` (one unit). */
function trade(securityId: string, gain: string, date = "2026-03-01", sellTax = "0"): GainsRow[] {
  return [
    row("BUY", "2026-01-02", { securityId, quantity: "1", amount: "1000" }),
    row("SELL", date, { securityId, quantity: "1", amount: String(1000 + Number(gain)), tax: sellTax }),
  ];
}
const dividend = (securityId: string, amount: string, input: Partial<GainsRow> = {}) => row("DIVIDEND", "2026-05-01", { securityId, amount, ...input });

const SECURITIES: Record<string, TaxSecurity> = {
  stockA: { category: "stock", teilfreistellung: "0" },
  stockB: { category: "stock", teilfreistellung: "0" },
  equityEtf: { category: "fund", teilfreistellung: "0.3" },
  bondEtf: { category: "fund", teilfreistellung: "0" },
  bondEtf15: { category: "fund", teilfreistellung: "0.15" },
  cert: { category: "other", teilfreistellung: "0" },
};

function preview(rows: GainsRow[], options: Partial<TaxPreviewInput> & { allowance?: string } = {}) {
  return taxPreview({
    depots: [{ broker: "COMDIRECT", rows }],
    actions: NO_CORPORATE_ACTIONS,
    securities: SECURITIES,
    allowances: options.allowance ? [{ broker: "COMDIRECT", year: 2026, amount: options.allowance }] : [],
    brokers: ["COMDIRECT"],
    today: TODAY,
    ...options,
  });
}
const broker2026 = (years: ReturnType<typeof taxPreview>, index = 0) => years.find((year) => year.year === "2026")!.brokers[index];

describe("taxSecurity", () => {
  it("maps stocks, funds by asset class and override, and everything else", () => {
    expect(taxSecurity({ type: "STOCK", assetClass: "Aktien" }, null)).toEqual({ category: "stock", teilfreistellung: "0" });
    expect(taxSecurity({ type: "ETF", assetClass: "Aktien" }, null)).toEqual({ category: "fund", teilfreistellung: "0.3" });
    expect(taxSecurity({ type: "FUND", assetClass: "Anleihen" }, null)).toEqual({ category: "fund", teilfreistellung: "0" });
    expect(taxSecurity({ type: "ETF", assetClass: null }, null)).toEqual({ category: "fund", teilfreistellung: "0" });
    expect(taxSecurity({ type: "ETF", assetClass: "Aktien" }, "0")).toEqual({ category: "fund", teilfreistellung: "0" });
    expect(taxSecurity({ type: "ETF", assetClass: "Anleihen" }, "0.15")).toEqual({ category: "fund", teilfreistellung: "0.15" });
    for (const type of ["CERTIFICATE", "CRYPTO", "UNCLASSIFIED", "SOMETHING"]) {
      expect(taxSecurity({ type, assetClass: "Aktien" }, "0.3")).toEqual({ category: "other", teilfreistellung: "0" });
    }
  });
});

describe("taxPreview", () => {
  it("computes the full example by hand", () => {
    const rows = [
      ...trade("stockA", "3000"),
      ...trade("stockB", "-500"),
      ...trade("equityEtf", "1000"),
      dividend("stockA", "200"),
      dividend("equityEtf", "100"),
      ...trade("cert", "-400"),
      row("TAX", "2026-06-01", { tax: "600" }),
    ];
    const result = broker2026(preview(rows, { allowance: "1000" }));
    expect(result).toEqual({
      broker: "COMDIRECT",
      dividends: "270",
      stockGains: "3000",
      stockLosses: "500",
      fund: "700",
      other: "-400",
      offsetAgainstStock: "0",
      unusedStockLoss: "0",
      unusedOtherLoss: "0",
      taxable: "3070",
      allowance: "1000",
      allowanceUsed: "1000",
      allowanceLeft: "0",
      base: "2070",
      capitalGainsTax: "517.5",
      solidaritySurcharge: "28.46",
      estimated: "545.96",
      withheld: "600",
      difference: "54.04",
    });
  });

  it("keeps a stock loss in the stock pot", () => {
    const result = broker2026(preview([...trade("stockA", "-1000"), dividend("stockB", "300")]));
    expect(result).toMatchObject({ taxable: "300", unusedStockLoss: "1000", unusedOtherLoss: "0", capitalGainsTax: "75", solidaritySurcharge: "4.13", estimated: "79.13" });
    expect(result.difference).toBe("-79.13");
  });

  it("offsets an other loss against stock gains", () => {
    const result = broker2026(preview([...trade("stockA", "1000"), ...trade("cert", "-1500")]));
    expect(result).toMatchObject({ taxable: "0", offsetAgainstStock: "1000", unusedOtherLoss: "500", unusedStockLoss: "0", estimated: "0" });
  });

  it("uses at most the taxable income of the allowance", () => {
    const result = broker2026(preview([dividend("stockA", "300")], { allowance: "801" }));
    expect(result).toMatchObject({ taxable: "300", allowanceUsed: "300", allowanceLeft: "501", base: "0", estimated: "0" });
  });

  it("applies no Teilfreistellung to a non-equity fund, and the override", () => {
    expect(broker2026(preview(trade("bondEtf", "1000")))).toMatchObject({ fund: "1000", taxable: "1000" });
    expect(broker2026(preview(trade("bondEtf15", "1000")))).toMatchObject({ fund: "850", taxable: "850" });
  });

  it("shares the pots of one broker's Depots and separates brokers", () => {
    const depotA = trade("stockA", "1000");
    const depotB = trade("stockB", "-1000");
    const same = preview([], { depots: [{ broker: "COMDIRECT", rows: depotA }, { broker: "COMDIRECT", rows: depotB }] });
    expect(broker2026(same)).toMatchObject({ taxable: "0", unusedStockLoss: "0", stockGains: "1000", stockLosses: "1000" });

    const split = preview([], {
      depots: [{ broker: "COMDIRECT", rows: depotA }, { broker: "DEUTSCHE_BANK", rows: depotB }],
      brokers: ["COMDIRECT", "DEUTSCHE_BANK"],
    });
    expect(broker2026(split, 0)).toMatchObject({ broker: "COMDIRECT", taxable: "1000", unusedStockLoss: "0" });
    expect(broker2026(split, 1)).toMatchObject({ broker: "DEUTSCHE_BANK", taxable: "0", unusedStockLoss: "1000" });
    const total = split.find((year) => year.year === "2026")!.total;
    expect(total).toMatchObject({ taxable: "1000", unusedStockLoss: "1000", capitalGainsTax: "250", estimated: "263.75" });
  });

  it("sums the signed withheld tax", () => {
    const rows = [
      ...trade("stockA", "0", "2026-03-01", "50"),
      dividend("stockA", "0", { tax: "30" }),
      row("TAX", "2026-07-01", { tax: "20" }),
      row("TAX", "2026-08-01", { tax: "-10" }),
    ];
    expect(broker2026(preview(rows)).withheld).toBe("90");
  });

  it("takes a sale in its year and ignores future rows", () => {
    const rows = [
      row("BUY", "2025-01-02", { securityId: "stockA", quantity: "1", amount: "1000" }),
      row("SELL", "2025-12-31", { securityId: "stockA", quantity: "1", amount: "1100" }),
      row("DIVIDEND", "2026-12-01", { securityId: "stockA", amount: "999", tax: "250" }),
    ];
    const years = preview(rows);
    expect(years.map((year) => year.year)).toEqual(["2026", "2025"]);
    expect(years[1].brokers[0]).toMatchObject({ stockGains: "100", taxable: "100" });
    expect(years[0].brokers[0]).toMatchObject({ dividends: "0", taxable: "0", withheld: "0" });
  });

  it("returns only today's year without rows, and sums the year's allowances", () => {
    const years = preview([], {
      allowances: [
        { broker: "COMDIRECT", year: 2026, amount: "801" },
        { broker: "DEUTSCHE_BANK", year: 2026, amount: "300" },
        { broker: "COMDIRECT", year: 2025, amount: "1000" },
      ],
    });
    expect(years).toHaveLength(1);
    expect(years[0]).toMatchObject({ year: "2026", allowanceSum: "1101" });
    expect(years[0].brokers[0]).toMatchObject({ allowance: "801", allowanceLeft: "801" });
    expect(allowanceSumExceedsLimit(years[0].allowanceSum)).toBe(true);
    expect(allowanceSumExceedsLimit("1000")).toBe(false);
  });

  it("classifies a sale after an ISIN change by the new Security", () => {
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [{ oldSecurityId: "cert", newSecurityId: "stockA", date: "2026-02-01", oldQuantity: "1", newQuantity: "1" }],
    };
    const rows = [
      row("BUY", "2026-01-02", { securityId: "cert", quantity: "1", amount: "1000" }),
      row("SELL", "2026-03-01", { securityId: "stockA", quantity: "1", amount: "800" }),
    ];
    expect(broker2026(preview(rows, { actions }))).toMatchObject({ stockLosses: "200", other: "0" });
  });

  it("applies the Teilfreistellung to fund losses (signed) and treats unknown Securities as other", () => {
    expect(broker2026(preview(trade("equityEtf", "-1000")))).toMatchObject({ fund: "-700", taxable: "0", unusedOtherLoss: "700" });
    expect(broker2026(preview(trade("unknown", "100")))).toMatchObject({ other: "100", taxable: "100" });
  });
});
