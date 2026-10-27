import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { type DividendBucket, type DividendDepotInput, type DividendPosition, dividendAnalysis } from "./dividend-analysis";
import type { GainsRow } from "./gains-analysis";
import { resolvePeriod } from "./period";
import { periodFlows } from "./valuation";

const TODAY = "2026-10-27";

let sequence = 0;
function row(type: string, date: string, input: Partial<GainsRow> = {}): GainsRow {
  return { securityId: null, type, date, sequence: ++sequence, quantity: null, price: null, amount: "0", fee: "0", tax: "0", ...input };
}
const buy = (date: string, securityId: string, quantity: string, amount: string) => row("BUY", date, { securityId, quantity, amount, price: "1" });
const sell = (date: string, securityId: string, quantity: string, amount: string) => row("SELL", date, { securityId, quantity, amount, price: "1" });
const dividend = (date: string, securityId: string, amount: string, input: Partial<GainsRow> = {}) => row("DIVIDEND", date, { securityId, amount, ...input });
const position = (securityId: string, quantity: string, value: string | null): DividendPosition => ({ securityId, quantity, value });

const HAND_ROWS = [
  buy("2025-01-02", "x", "10", "500"),
  dividend("2025-11-15", "x", "20", { tax: "5", fee: "0.5" }),
  buy("2026-03-01", "x", "10", "600"),
  dividend("2026-05-10", "x", "40", { tax: "10" }),
];
const HAND: DividendDepotInput = { depotId: "d1", rows: HAND_ROWS, positions: [position("x", "20", "2000")] };

const analyse = (depots: DividendDepotInput[], actions: CorporateActions = NO_CORPORATE_ACTIONS, today = TODAY) => dividendAnalysis(depots, actions, today);

function sumYear(months: readonly DividendBucket[], year: string) {
  const inYear = months.filter((m) => m.period.startsWith(`${year}-`));
  return {
    gross: canonicalDecimal(inYear.reduce((sum, m) => sum.plus(m.gross), new ExactDecimal(0))),
    net: canonicalDecimal(inYear.reduce((sum, m) => sum.plus(m.net), new ExactDecimal(0))),
  };
}

describe("dividendAnalysis", () => {
  it("matches the hand reference per month, year, cumulative and Security", () => {
    const result = analyse([HAND]);
    expect(result.months.map((m) => m.period)).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`),
      ...Array.from({ length: 10 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`),
    ]);
    const nonZero = result.months.filter((m) => m.gross !== "0" || m.net !== "0");
    expect(nonZero).toEqual([
      { period: "2025-11", gross: "20", net: "14.5" },
      { period: "2026-05", gross: "40", net: "30" },
    ]);
    expect(result.years).toEqual([
      { period: "2025", gross: "20", net: "14.5" },
      { period: "2026", gross: "40", net: "30" },
    ]);
    for (const year of result.years) expect(sumYear(result.months, year.period)).toEqual({ gross: year.gross, net: year.net });
    expect(result.cumulative).toEqual([
      { period: "2025", gross: "20", net: "14.5" },
      { period: "2026", gross: "60", net: "44.5" },
    ]);
    expect(result.bySecurity).toEqual([{ securityId: "x", count: 2, gross: "60", net: "44.5", lastDate: "2026-05-10" }]);
  });

  it("computes trailing income and yield over the 1J Period, matching periodFlows", () => {
    const { trailing } = analyse([HAND]);
    expect(trailing).toEqual({
      from: "2025-10-27",
      to: TODAY,
      gross: "60",
      net: "44.5",
      payingValue: "2000",
      grossYield: "0.03",
      netYield: "0.02225",
    });
    const period = resolvePeriod({ kind: "preset", preset: "1J" }, TODAY, null);
    expect(trailing.gross).toBe(periodFlows(HAND_ROWS, period.from, period.to).dividends);
  });

  it("estimates the next 12 months at today's holding", () => {
    const result = analyse([HAND]);
    expect(result.expected).toEqual([
      { depotId: "d1", securityId: "x", date: "2026-11-15", basedOn: "2025-11-15", gross: "40", net: "29" },
      { depotId: "d1", securityId: "x", date: "2027-05-10", basedOn: "2026-05-10", gross: "40", net: "30" },
    ]);
    expect(result.expectedMonths.map((m) => m.period)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      ...Array.from({ length: 10 }, (_, i) => `2027-${String(i + 1).padStart(2, "0")}`),
    ]);
    const total = result.expectedMonths.reduce((sum, m) => ({ gross: sum.gross.plus(m.gross), net: sum.net.plus(m.net) }), {
      gross: new ExactDecimal(0),
      net: new ExactDecimal(0),
    });
    expect([total.gross.toFixed(), total.net.toFixed()]).toEqual(["80", "59"]);
    expect(result.expectedMonths.find((m) => m.period === "2026-11")).toEqual({ period: "2026-11", gross: "40", net: "29" });
  });

  it("carries a payment across a split to today's units (factor 1)", () => {
    const rows = [buy("2025-06-01", "y", "10", "1000"), dividend("2025-12-01", "y", "10")];
    const actions: CorporateActions = { splits: [{ securityId: "y", date: "2026-01-15", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const result = analyse([{ depotId: "d1", rows, positions: [position("y", "20", "500")] }], actions);
    expect(result.expected).toEqual([{ depotId: "d1", securityId: "y", date: "2026-12-01", basedOn: "2025-12-01", gross: "10", net: "10" }]);
    expect(result.trailing.payingValue).toBe("500");
  });

  it("uses factor 1 when nothing was held at the payment", () => {
    const rows = [dividend("2026-01-10", "x", "12"), buy("2026-02-01", "x", "10", "1000")];
    const result = analyse([{ depotId: "d1", rows, positions: [position("x", "10", "1000")] }]);
    expect(result.expected).toEqual([{ depotId: "d1", securityId: "x", date: "2027-01-10", basedOn: "2026-01-10", gross: "12", net: "12" }]);
  });

  it("follows an ISIN change to today's Security", () => {
    const rows = [buy("2025-06-01", "old", "10", "1000"), dividend("2025-12-01", "old", "10")];
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [{ oldSecurityId: "old", newSecurityId: "new", date: "2026-02-01", oldQuantity: "10", newQuantity: "5" }],
    };
    const result = analyse([{ depotId: "d1", rows, positions: [position("new", "5", "800")] }], actions);
    expect(result.expected).toEqual([{ depotId: "d1", securityId: "new", date: "2026-12-01", basedOn: "2025-12-01", gross: "10", net: "10" }]);
    expect(result.trailing.grossYield).toBe("0.0125");
    expect(result.bySecurity.map((s) => s.securityId)).toEqual(["old"]);
  });

  it("counts a sold Security's income but neither its value nor an estimate", () => {
    const rows = [buy("2025-06-01", "z", "10", "1000"), dividend("2026-02-01", "z", "15"), sell("2026-06-01", "z", "10", "1100")];
    const result = analyse([{ depotId: "d1", rows, positions: [] }]);
    expect(result.trailing).toMatchObject({ gross: "15", payingValue: "0", grossYield: null, netYield: null });
    expect(result.expected).toEqual([]);
  });

  it("keeps a payment exactly one year ago in the trailing income but not in the estimate", () => {
    const rows = [buy("2025-06-01", "x", "10", "1000"), dividend("2025-10-27", "x", "12")];
    const result = analyse([{ depotId: "d1", rows, positions: [position("x", "10", "1200")] }]);
    expect(result.trailing).toMatchObject({ gross: "12", payingValue: "1200", grossYield: "0.01" });
    expect(result.expected).toEqual([]);
  });

  it("has no yield when a paying Position has no value", () => {
    const rows = [buy("2025-06-01", "x", "10", "1000"), dividend("2026-01-10", "x", "12")];
    const result = analyse([{ depotId: "d1", rows, positions: [position("x", "10", null)] }]);
    expect(result.trailing).toMatchObject({ gross: "12", payingValue: "0", grossYield: null, netYield: null });
  });

  it("has no yield when the paying value is 0", () => {
    const rows = [buy("2025-06-01", "x", "10", "1000"), dividend("2026-01-10", "x", "12")];
    const result = analyse([{ depotId: "d1", rows, positions: [position("x", "10", "0")] }]);
    expect(result.trailing.grossYield).toBeNull();
  });

  it("values paying Positions per Depot across two Depots", () => {
    const a: DividendDepotInput = {
      depotId: "a",
      rows: [buy("2025-06-01", "x", "5", "500"), dividend("2026-01-10", "x", "5"), sell("2026-03-01", "x", "5", "600")],
      positions: [],
    };
    const b: DividendDepotInput = {
      depotId: "b",
      rows: [buy("2025-06-01", "x", "10", "1000"), dividend("2026-01-10", "x", "10")],
      positions: [position("x", "10", "1000")],
    };
    const result = analyse([a, b]);
    expect(result.trailing).toMatchObject({ gross: "15", payingValue: "1000", grossYield: "0.015" });
    expect(result.expected).toEqual([{ depotId: "b", securityId: "x", date: "2027-01-10", basedOn: "2026-01-10", gross: "10", net: "10" }]);
    expect(result.bySecurity).toEqual([{ securityId: "x", count: 2, gross: "15", net: "15", lastDate: "2026-01-10" }]);
  });

  it("raises net by a tax refund", () => {
    const result = analyse([{ depotId: "d1", rows: [dividend("2026-01-10", "x", "10", { tax: "-2" })], positions: [] }]);
    expect(result.years).toEqual([{ period: "2026", gross: "10", net: "12" }]);
  });

  it("does not attribute standalone TAX/FEE rows and orders Securities by gross", () => {
    const rows = [
      dividend("2026-01-10", "b", "10"),
      dividend("2026-02-10", "a", "10"),
      dividend("2026-03-10", "c", "30"),
      row("TAX", "2026-03-10", { securityId: "c", tax: "5" }),
      row("FEE", "2026-03-10", { fee: "1" }),
      row("DIVIDEND", "2026-03-10", { amount: "99" }),
    ];
    const result = analyse([{ depotId: "d1", rows, positions: [] }]);
    expect(result.bySecurity.map((s) => [s.securityId, s.gross, s.net])).toEqual([
      ["c", "30", "30"],
      ["a", "10", "10"],
      ["b", "10", "10"],
    ]);
    expect(result.trailing.net).toBe("50");
  });

  it("gives zero buckets and empty lists without dividends", () => {
    const result = analyse([{ depotId: "d1", rows: [row("DEPOSIT", "2026-09-01", { amount: "100" })], positions: [] }]);
    expect(result.months).toEqual([
      { period: "2026-09", gross: "0", net: "0" },
      { period: "2026-10", gross: "0", net: "0" },
    ]);
    expect(result.years).toEqual([{ period: "2026", gross: "0", net: "0" }]);
    expect(result.cumulative).toEqual([{ period: "2026", gross: "0", net: "0" }]);
    expect(result.bySecurity).toEqual([]);
    expect(result.trailing).toMatchObject({ gross: "0", net: "0", grossYield: null, netYield: null });
    expect(result.expected).toEqual([]);
    expect(result.expectedMonths).toHaveLength(13);
  });

  it("is empty without rows", () => {
    expect(analyse([{ depotId: "d1", rows: [], positions: [] }])).toEqual({
      months: [],
      years: [],
      cumulative: [],
      bySecurity: [],
      trailing: { from: "2025-10-27", to: TODAY, gross: "0", net: "0", payingValue: "0", grossYield: null, netYield: null },
      expected: [],
      expectedMonths: [],
    });
  });

  it("ignores rows after today", () => {
    const result = analyse([{ depotId: "d1", rows: [...HAND_ROWS, dividend("2026-11-01", "x", "100")], positions: HAND.positions }]);
    expect(result.trailing.gross).toBe("60");
    expect(result.months.at(-1)?.period).toBe("2026-10");
    expect(result.bySecurity[0]).toMatchObject({ count: 2, lastDate: "2026-05-10" });
  });
});
