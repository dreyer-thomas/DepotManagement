import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { NO_CORPORATE_ACTIONS } from "./corporate-actions";
import { addDays } from "./dates";
import { ExactDecimal } from "./decimal";
import type { PriceObservation } from "./prices";
import { returnHeatmap } from "./return-heatmap";
import { chainReturns, ttwror } from "./returns";
import { type ValuationPoint, type ValuationRow, valuationSeries } from "./valuation";

type Row = ValuationRow & { id: string };

let counter = 0;
function row(type: string, date: string, input: { quantity?: string; price?: string; amount?: string; tax?: string; securityId?: string } = {}): Row {
  const amount = input.amount ?? (input.quantity && input.price ? new ExactDecimal(input.quantity).times(input.price).toFixed() : "0");
  const trade = type === "BUY" || type === "SELL";
  return {
    id: `t${++counter}`,
    securityId: trade ? (input.securityId ?? "s1") : null,
    type,
    date,
    sequence: trade ? 2 : 1,
    quantity: input.quantity ?? null,
    price: input.price ?? null,
    amount,
    fee: "0",
    tax: input.tax ?? "0",
  };
}

const deposit = (date: string, amount: string) => row("DEPOSIT", date, { amount });
const withdrawal = (date: string, amount: string) => row("WITHDRAWAL", date, { amount });
const buy = (date: string, quantity: string, price: string) => row("BUY", date, { quantity, price });

const provider = (date: string, price: string): PriceObservation => ({ id: `p-${date}`, securityId: "s1", date, sequence: 0, price, source: "provider" });

/** As `returnSeries` builds it: one series from the day before the first ledger date to today. */
function build(rows: Row[], prices: PriceObservation[], today: string) {
  const first = rows.reduce((min, r) => (r.date < min ? r.date : min), rows[0].date);
  const observations: PriceObservation[] = [
    ...rows.filter((r) => r.price !== null).map((r) => ({ id: r.id, securityId: r.securityId!, date: r.date, sequence: r.sequence, price: r.price!, source: "transaction" as const })),
    ...prices,
  ];
  const points = valuationSeries(rows, observations, NO_CORPORATE_ACTIONS, addDays(first, -1), today);
  return { start: points[0], series: points.slice(1) };
}

/** A synthetic point; the other fields do not matter for returns. */
function point(date: string, value: string): ValuationPoint {
  return { date, value, positionsValue: "0", cash: value, investedCapital: "0" };
}

/** Points for every day `from..to` with the value of the last entry of `values` dated on or before the day. */
function points(from: string, to: string, values: Record<string, string>): ValuationPoint[] {
  const result: ValuationPoint[] = [];
  let current = "0";
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (values[date] !== undefined) current = values[date];
    result.push(point(date, current));
  }
  return result;
}

function expectClose(actual: string | null, expected: string, tolerance = "1e-15") {
  expect(actual).not.toBeNull();
  expect(new Decimal(actual!).minus(expected).abs().lessThanOrEqualTo(tolerance)).toBe(true);
}

describe("chainReturns", () => {
  it("chains the non-null ratios and gives null without any", () => {
    expect(chainReturns(["0.1", "-0.1", "0"])).toBe("-0.01");
    expect(chainReturns([null, "0.05", null])).toBe("0.05");
    expect(chainReturns([null, null])).toBeNull();
    expect(chainReturns([])).toBeNull();
  });
});

describe("returnHeatmap", () => {
  it("matches the hand reference: Jan +10 %, Feb −10 %, Mar 0 %, Q1 and year −1 %", () => {
    const rows = [deposit("2026-01-15", "1000"), buy("2026-01-15", "10", "100")];
    const { start, series } = build(rows, [provider("2026-01-31", "110"), provider("2026-02-28", "99"), provider("2026-03-31", "99")], "2026-03-31");
    const [year] = returnHeatmap(start, series, rows, "2026-03-31");
    expect(year.year).toBe(2026);
    expect(year.months.map((m) => m?.return ?? null)).toEqual(["0.1", "-0.1", "0", ...Array(9).fill(null)]);
    expect(year.quarters).toEqual(["-0.01", null, null, null]);
    expect(year.total).toBe("-0.01");
    expect(year.months[0]).toMatchObject({
      month: "2026-01",
      from: "2026-01-15",
      to: "2026-01-31",
      startValue: "0",
      endValue: "1100",
      netExternalFlows: "1000",
      transactions: 2,
      running: false,
    });
    expect(year.months[1]).toMatchObject({ from: "2026-02-01", to: "2026-02-28", startValue: "1100", endValue: "990", netExternalFlows: "0", transactions: 0 });
    expect(year.months[2]).toMatchObject({ startValue: "990", endValue: "990", running: true });
  });

  it("counts a mid-month Deposit as a flow, not as return", () => {
    const start = point("2026-03-31", "1000");
    const series = points("2026-04-01", "2026-04-30", { "2026-04-01": "1000", "2026-04-10": "1100", "2026-04-11": "2200", "2026-04-30": "2310" });
    const rows = [deposit("2026-04-11", "1100")];
    const month = returnHeatmap(start, series, rows, "2026-04-30")[0].months[3]!;
    expect(month.return).toBe("0.155");
    expect(month).toMatchObject({ startValue: "1000", endValue: "2310", netExternalFlows: "1100", transactions: 1 });
  });

  it("leaves the months before the first Transaction empty", () => {
    const rows = [deposit("2025-03-05", "500")];
    const { start, series } = build(rows, [], "2025-06-30");
    const [year] = returnHeatmap(start, series, rows, "2025-06-30");
    expect(year.months.slice(0, 2)).toEqual([null, null]);
    expect(year.months[2]).toMatchObject({ month: "2025-03", from: "2025-03-05", return: "0" });
    expect(year.months.slice(6)).toEqual(Array(6).fill(null));
  });

  it("marks the month of today as running and leaves later months empty", () => {
    const rows = [deposit("2026-10-01", "1000")];
    const { start, series } = build(rows, [], "2026-10-27");
    const [year] = returnHeatmap(start, series, rows, "2026-10-27");
    expect(year.months[9]).toMatchObject({ month: "2026-10", from: "2026-10-01", to: "2026-10-27", running: true });
    expect(year.months[10]).toBeNull();
    expect(year.months[11]).toBeNull();
    expect(year.months.slice(0, 9)).toEqual(Array(9).fill(null));
  });

  it("ignores rows dated after today, also in the running month", () => {
    const rows = [deposit("2026-10-01", "1000")];
    const { start, series } = build(rows, [], "2026-10-27");
    const future = [...rows, deposit("2026-10-30", "500"), withdrawal("2026-12-01", "100")];
    const years = returnHeatmap(start, series, future, "2026-10-27");
    expect(years).toEqual(returnHeatmap(start, series, rows, "2026-10-27"));
    expect(years[0].months[9]).toMatchObject({ netExternalFlows: "1000", transactions: 1, running: true });
    expect(returnHeatmap(start, series, [deposit("2026-11-02", "1")], "2026-10-27")).toEqual([]);
  });

  it("gives null for a month with nothing invested but keeps its figures", () => {
    const rows = [deposit("2026-01-10", "1000"), withdrawal("2026-01-31", "1000")];
    const { start, series } = build(rows, [], "2026-02-28");
    const [year] = returnHeatmap(start, series, rows, "2026-02-28");
    expect(year.months[0]).toMatchObject({ return: "0", netExternalFlows: "0", transactions: 2 });
    expect(year.months[1]).toMatchObject({ return: null, startValue: "0", endValue: "0", netExternalFlows: "0", transactions: 0 });
    expect(year.quarters[0]).toBe("0");
  });

  it("lists the years newest first and chains them to the period TTWROR", () => {
    const rows = [
      deposit("2024-05-20", "3000"),
      buy("2024-05-20", "20", "100"),
      row("TAX", "2024-12-30", { tax: "12.5" }),
      deposit("2025-02-14", "800"),
      buy("2025-03-03", "5", "123.45"),
      withdrawal("2025-09-09", "400"),
      row("DIVIDEND", "2026-04-01", { amount: "40", tax: "10", securityId: "s1" }),
    ];
    const prices = ["2024-07-01:104.2", "2024-11-30:97.15", "2025-01-31:111", "2025-06-15:131.7", "2025-12-31:118.25", "2026-05-05:140.01"].map(
      (entry) => provider(entry.split(":")[0], entry.split(":")[1]),
    );
    const today = "2026-10-27";
    const { start, series } = build(rows, prices, today);
    const years = returnHeatmap(start, series, rows, today);
    expect(years.map((y) => y.year)).toEqual([2026, 2025, 2024]);
    for (const year of years) {
      const index = series.findIndex((p) => p.date.startsWith(`${year.year}-`));
      const slice = series.filter((p) => p.date.startsWith(`${year.year}-`));
      const previous = index === 0 ? start : series[index - 1];
      expectClose(year.total, ttwror(previous, slice, rows)!);
      expectClose(year.total, chainReturns(year.quarters)!);
    }
    expectClose(chainReturns(years.flatMap((y) => y.months.map((m) => m?.return ?? null))), ttwror(start, series, rows)!);
    // Net flows: Deposits − Withdrawals − taxes of the month.
    expect(years[2].months[11]?.netExternalFlows).toBe("-12.5");
    expect(years[1].months[8]?.netExternalFlows).toBe("-400");
    expect(years[0].months[3]?.netExternalFlows).toBe("-10");
  });

  it("counts a holding correction's market value as a flow", () => {
    const start = point("2026-05-31", "100");
    const series = points("2026-06-01", "2026-06-30", { "2026-06-01": "100", "2026-06-15": "160", "2026-06-30": "176" });
    series[14] = { ...series[14], adjustmentValue: "50" };
    const rows = [row("ADJUSTMENT", "2026-06-15", { quantity: "1", price: "50", amount: "0", securityId: "s1" })];
    const month = returnHeatmap(start, series, rows, "2026-06-30")[0].months[5]!;
    expect(month.netExternalFlows).toBe("50");
    expectClose(month.return, new Decimal(160).dividedBy(150).times(new Decimal(176).dividedBy(160)).minus(1).toFixed(), "1e-18");
  });

  it("is empty without rows", () => {
    expect(returnHeatmap(point("2026-10-26", "0"), [point("2026-10-27", "0")], [], "2026-10-27")).toEqual([]);
  });
});
