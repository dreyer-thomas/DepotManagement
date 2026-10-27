import { describe, expect, it } from "vitest";
import { NO_CORPORATE_ACTIONS, type CorporateActions } from "./corporate-actions";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { bestAndWorstSales, type GainsBucket, type GainsRow, type GainsSale, gainsAnalysis } from "./gains-analysis";
import { periodPerformance } from "./returns";
import { periodFlows, valuationSeries } from "./valuation";

type Input = Partial<Omit<GainsRow, "type" | "date">>;

let sequence = 0;
function row(type: string, date: string, input: Input = {}): GainsRow {
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

const deposit = (date: string, amount: string) => row("DEPOSIT", date, { amount });
const withdrawal = (date: string, amount: string) => row("WITHDRAWAL", date, { amount });
const buy = (date: string, quantity: string, price: string, input: Input = {}) =>
  row("BUY", date, { securityId: "s1", quantity, price, amount: new ExactDecimal(quantity).times(price).toFixed(), ...input });
const sell = (date: string, quantity: string, price: string, input: Input = {}) =>
  row("SELL", date, { securityId: "s1", quantity, price, amount: new ExactDecimal(quantity).times(price).toFixed(), ...input });

const EMPTY = { realized: "0", dividends: "0", fees: "0", taxes: "0", deposits: "0", withdrawals: "0", netCashFlow: "0" };

const HAND = [
  deposit("2026-01-10", "2000"),
  buy("2026-01-10", "10", "100", { fee: "1" }),
  sell("2026-03-05", "4", "120", { fee: "2", tax: "5" }),
  row("DIVIDEND", "2026-03-20", { securityId: "s1", amount: "30", fee: "0.5", tax: "7.5" }),
  withdrawal("2026-04-02", "300"),
];

const one = (rows: GainsRow[], today: string, actions: CorporateActions = NO_CORPORATE_ACTIONS) =>
  gainsAnalysis([{ depotId: "d1", rows }], actions, today);

function sumMonths(months: readonly GainsBucket[], year: string) {
  const keys = ["realized", "dividends", "fees", "taxes", "deposits", "withdrawals", "netCashFlow"] as const;
  return Object.fromEntries(
    keys.map((key) => [
      key,
      canonicalDecimal(months.filter((m) => m.period.startsWith(year)).reduce((sum, m) => sum.plus(m[key]), new ExactDecimal(0))),
    ]),
  );
}

describe("gainsAnalysis", () => {
  it("matches the hand reference per month and year", () => {
    const result = one(HAND, "2026-04-30");
    expect(result.months).toEqual([
      { period: "2026-01", ...EMPTY, deposits: "2000", netCashFlow: "2000" },
      { period: "2026-02", ...EMPTY },
      { period: "2026-03", ...EMPTY, realized: "77.6", dividends: "30", fees: "0.5", taxes: "12.5" },
      { period: "2026-04", ...EMPTY, withdrawals: "300", netCashFlow: "-300" },
    ]);
    expect(result.years).toEqual([
      { period: "2026", realized: "77.6", dividends: "30", fees: "0.5", taxes: "12.5", deposits: "2000", withdrawals: "300", netCashFlow: "1700" },
    ]);
  });

  it("records the sale with booked quantity, proceeds, Cost Basis, gain and ratio", () => {
    const [sale] = one(HAND, "2026-04-30").sales;
    expect(sale).toEqual({
      depotId: "d1",
      securityId: "s1",
      date: "2026-03-05",
      sequence: HAND[2].sequence,
      quantity: "4",
      proceeds: "478",
      costBasis: "400.4",
      gain: "77.6",
      gainRatio: canonicalDecimal(new ExactDecimal("77.6").dividedBy("400.4")),
    });
  });

  it("counts a standalone FEE row in its month and year", () => {
    const result = one([...HAND, row("FEE", "2026-02-15", { fee: "3" })], "2026-04-30");
    expect(result.months[1]).toEqual({ period: "2026-02", ...EMPTY, fees: "3" });
    expect(result.years[0]).toMatchObject({ fees: "3.5", taxes: "12.5" });
  });

  it("agrees with the Period figures of the same calendar year", () => {
    const withFee = [...HAND, row("FEE", "2026-02-15", { fee: "3" })];
    const rows = withFee.map((r) => ({ ...r, id: `r${r.sequence}` }));
    const observations = rows
      .filter((r) => r.price !== null && r.price !== undefined)
      .map((r) => ({ id: r.id, securityId: r.securityId!, date: r.date, sequence: r.sequence, price: r.price!, source: "transaction" as const }));
    const points = valuationSeries(rows, observations, NO_CORPORATE_ACTIONS, "2025-12-31", "2026-04-30");
    const performance = periodPerformance(rows, points[0], points.slice(1), NO_CORPORATE_ACTIONS);
    const [year] = one(withFee, "2026-04-30").years;
    expect(year.fees).toBe("3.5");
    expect(year.realized).toBe(performance.realized);
    expect(year.dividends).toBe(performance.dividends);
    expect(year.fees).toBe(performance.fees);
    expect(year.taxes).toBe(periodFlows(rows, "2026-01-01", "2026-12-31").taxesPaid);
  });

  it("keeps FIFO per Depot in the Portfolio", () => {
    const a = [deposit("2026-01-01", "1000"), buy("2026-01-02", "1", "100"), sell("2026-02-01", "1", "150")];
    const b = [deposit("2026-01-01", "1000"), buy("2026-01-03", "1", "200"), sell("2026-02-02", "1", "150")];
    const result = gainsAnalysis(
      [
        { depotId: "a", rows: a },
        { depotId: "b", rows: b },
      ],
      NO_CORPORATE_ACTIONS,
      "2026-02-28",
    );
    expect(result.sales.map((s) => [s.depotId, s.gain])).toEqual([
      ["a", "50"],
      ["b", "-50"],
    ]);
    expect(result.months[1]).toMatchObject({ period: "2026-02", realized: "0" });
    expect(result.years[0]).toMatchObject({ deposits: "2000", netCashFlow: "2000" });
  });

  it("keeps the booked quantity of a sale after a split", () => {
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-02-01", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const rows = [buy("2026-01-05", "10", "100"), sell("2026-03-01", "20", "60")];
    const [sale] = one(rows, "2026-03-31", actions).sales;
    expect(sale).toMatchObject({ quantity: "20", proceeds: "1200", costBasis: "1000", gain: "200", gainRatio: "0.2" });
  });

  it("leaves holding corrections out and counts a reconciliation deposit as cash flow", () => {
    const rows = [
      buy("2026-01-05", "10", "100"),
      row("ADJUSTMENT", "2026-01-06", { securityId: "s1", quantity: "2", price: "100" }),
      row("DEPOSIT", "2026-01-07", { amount: "12.34" }),
    ];
    const result = one(rows, "2026-01-31");
    expect(result.months).toEqual([{ period: "2026-01", ...EMPTY, deposits: "12.34", netCashFlow: "12.34" }]);
    expect(result.sales).toEqual([]);
  });

  it("ignores rows dated after today", () => {
    const rows = [buy("2026-01-05", "10", "100"), sell("2026-05-01", "10", "120"), deposit("2026-05-02", "5")];
    const result = one(rows, "2026-04-30");
    expect(result.sales).toEqual([]);
    expect(result.months.map((m) => m.period)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(result.years[0]).toEqual({ period: "2026", ...EMPTY });
  });

  it("books a tax refund negative in its month", () => {
    const result = one([row("TAX", "2026-02-10", { tax: "-20" })], "2026-02-28");
    expect(result.months).toEqual([{ period: "2026-02", ...EMPTY, taxes: "-20" }]);
  });

  it("is empty without rows", () => {
    expect(one([], "2026-04-30")).toEqual({ months: [], years: [], sales: [] });
    expect(gainsAnalysis([], NO_CORPORATE_ACTIONS, "2026-04-30")).toEqual({ months: [], years: [], sales: [] });
  });

  it("fills years without activity and sums each year from its months", () => {
    const rows = [deposit("2024-11-05", "100"), deposit("2024-12-05", "50"), buy("2024-12-06", "1", "100"), sell("2026-03-01", "1", "90", { tax: "1" })];
    const result = one(rows, "2026-04-30");
    expect(result.years.map((y) => y.period)).toEqual(["2024", "2025", "2026"]);
    expect(result.years[1]).toEqual({ period: "2025", ...EMPTY });
    expect(result.months).toHaveLength(2 + 12 + 4);
    for (const year of result.years) expect({ period: year.period, ...sumMonths(result.months, year.period) }).toEqual(year);
    expect(result.years[2]).toMatchObject({ realized: "-10", taxes: "1" });
  });

  it("gives a null ratio when the Cost Basis is zero", () => {
    const [sale] = one([sell("2026-01-05", "1", "10")], "2026-01-31").sales;
    expect(sale).toMatchObject({ costBasis: "0", gain: "10", gainRatio: null });
  });
});

describe("bestAndWorstSales", () => {
  const sale = (gain: string, date: string, seq = 1): GainsSale => ({
    depotId: "d1",
    securityId: "s1",
    date,
    sequence: seq,
    quantity: "1",
    proceeds: "0",
    costBasis: "0",
    gain,
    gainRatio: null,
  });

  it("lists the top five positive and the negative sales, leaving zero out", () => {
    const sales = [
      sale("50", "2026-01-01"),
      sale("10", "2026-01-02"),
      sale("0", "2026-01-03"),
      sale("-5", "2026-01-04"),
      sale("-20", "2026-01-05"),
      ...["1", "2", "3", "4", "60", "7"].map((gain, index) => sale(gain, `2026-02-0${index + 1}`)),
    ];
    const { best, worst } = bestAndWorstSales(sales);
    expect(best.map((s) => s.gain)).toEqual(["60", "50", "10", "7", "4"]);
    expect(worst.map((s) => s.gain)).toEqual(["-20", "-5"]);
  });

  it("breaks ties by date, then sequence", () => {
    const { best, worst } = bestAndWorstSales([sale("5", "2026-02-01", 2), sale("5", "2026-02-01", 1), sale("5", "2026-01-01"), sale("-1", "2026-03-01"), sale("-1", "2026-02-01")], 2);
    expect(best.map((s) => [s.date, s.sequence])).toEqual([
      ["2026-01-01", 1],
      ["2026-02-01", 1],
    ]);
    expect(worst.map((s) => s.date)).toEqual(["2026-02-01", "2026-03-01"]);
  });
});
