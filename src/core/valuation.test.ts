import { describe, expect, it } from "vitest";
import { cashBalance } from "./cash";
import { type CorporateActions, NO_CORPORATE_ACTIONS as NONE } from "./corporate-actions";
import { addDays } from "./dates";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { computePositions } from "./positions";
import type { PriceObservation } from "./prices";
import { investedCapital, periodFlows, sumValuationSeries, type ValuationPoint, type ValuationRow, valuationSeries } from "./valuation";

type Row = ValuationRow & { id: string; price: string | null };

let counter = 0;
function row(
  type: string,
  date: string,
  input: { securityId?: string; quantity?: string; price?: string; amount?: string; fee?: string; tax?: string; sequence?: number } = {},
): Row {
  const amount = input.amount ?? (input.quantity && input.price ? new ExactDecimal(input.quantity).times(input.price).toFixed() : "0");
  return {
    id: `t${++counter}`,
    securityId: input.securityId ?? null,
    type,
    date,
    sequence: input.sequence ?? 1,
    quantity: input.quantity ?? null,
    price: input.price ?? null,
    amount,
    fee: input.fee ?? "0",
    tax: input.tax ?? "0",
  };
}

const buy = (date: string, quantity: string, price: string, securityId = "s1", fee = "0") =>
  row("BUY", date, { securityId, quantity, price, fee });
const sell = (date: string, quantity: string, price: string, securityId = "s1", fee = "0") =>
  row("SELL", date, { securityId, quantity, price, fee });
const deposit = (date: string, amount: string) => row("DEPOSIT", date, { amount });

const tradeObservations = (rows: Row[]): PriceObservation[] =>
  rows
    .filter((r) => r.price !== null && r.securityId !== null)
    .map((r) => ({ id: r.id, securityId: r.securityId!, date: r.date, sequence: r.sequence, price: r.price!, source: "transaction" }));

const provider = (securityId: string, date: string, price: string): PriceObservation => ({
  id: `p-${securityId}-${date}`,
  securityId,
  date,
  sequence: 0,
  price,
  source: "provider",
});
const manual = (securityId: string, date: string, price: string): PriceObservation => ({
  ...provider(securityId, date, price),
  id: `m-${securityId}-${date}`,
  source: "manual",
});

/** The per-day reference: Σ `computePositions` values + `cashBalance`, invested = Σ Cost Basis. */
function oracle(rows: Row[], observations: PriceObservation[], day: string, actions: CorporateActions) {
  const positions = computePositions(rows, observations, day, actions);
  const positionsValue = positions.reduce((sum, p) => sum.plus(p.value ?? "0"), new ExactDecimal(0));
  const cash = cashBalance(rows, day);
  return {
    value: canonicalDecimal(positionsValue.plus(cash)),
    positionsValue: canonicalDecimal(positionsValue),
    cash,
    investedCapital: canonicalDecimal(positions.reduce((sum, p) => sum.plus(p.costBasis), new ExactDecimal(0))),
  };
}

function expectMatchesOracle(rows: Row[], observations: PriceObservation[], actions: CorporateActions, from: string, to: string) {
  const series = valuationSeries(rows, observations, actions, from, to);
  let day = from;
  for (const point of series) {
    expect(point.date).toBe(day);
    expect({ day, ...oracle(rows, observations, day, actions) }).toEqual({
      day,
      value: point.value,
      positionsValue: point.positionsValue,
      cash: point.cash,
      investedCapital: point.investedCapital,
    });
    expect(point.investedCapital).toBe(investedCapital(rows, day, actions));
    day = addDays(day, 1);
  }
  expect(series.at(-1)?.date).toBe(to);
  return series;
}

describe("valuationSeries", () => {
  it("carries the latest Price forward", () => {
    const rows = [deposit("2026-01-01", "2000"), buy("2026-01-01", "10", "100")];
    const observations = [...tradeObservations(rows), provider("s1", "2026-01-03", "110")];
    const series = expectMatchesOracle(rows, observations, NONE, "2026-01-01", "2026-01-04");
    expect(series.map((p) => p.value)).toEqual(["2000", "2000", "2100", "2100"]);
    expect(series[3]).toEqual({ date: "2026-01-04", value: "2100", positionsValue: "1100", cash: "1000", investedCapital: "1000" });
  });

  it("follows a split mid-Period with the right units and prices", () => {
    const rows = [deposit("2026-01-01", "1000"), buy("2026-01-01", "10", "100")];
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-01-02", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const observations = [...tradeObservations(rows), provider("s1", "2026-01-03", "55")];
    const series = expectMatchesOracle(rows, observations, actions, "2026-01-01", "2026-01-04");
    expect(series[0].value).toBe("1000");
    expect(series[1].positionsValue).toBe("1000");
    expect(series[2].positionsValue).toBe("1100");
  });

  it("is all zero before the Depot's first row", () => {
    const rows = [deposit("2026-01-05", "500"), buy("2026-01-05", "1", "100")];
    const series = expectMatchesOracle(rows, tradeObservations(rows), NONE, "2026-01-01", "2026-01-06");
    expect(series[0]).toEqual({ date: "2026-01-01", value: "0", positionsValue: "0", cash: "0", investedCapital: "0" });
    expect(series[4]).toEqual({ date: "2026-01-05", value: "500", positionsValue: "100", cash: "400", investedCapital: "100" });
  });

  it("has no invested capital and value = cash once everything is sold", () => {
    const rows = [deposit("2026-01-01", "1000"), buy("2026-01-01", "10", "100", "s1", "5"), sell("2026-01-03", "10", "120", "s1", "5")];
    const series = expectMatchesOracle(rows, tradeObservations(rows), NONE, "2026-01-01", "2026-01-05");
    expect(series[0].investedCapital).toBe("1005");
    expect(series.at(-1)).toEqual({ date: "2026-01-05", value: "1190", positionsValue: "0", cash: "1190", investedCapital: "0" });
  });

  it("counts an open Position without any price as 0", () => {
    const rows = [deposit("2026-01-01", "100"), row("BUY", "2026-01-01", { securityId: "s1", quantity: "1", amount: "100" })];
    const series = expectMatchesOracle(rows, [], NONE, "2026-01-01", "2026-01-02");
    expect(series[1]).toEqual({ date: "2026-01-02", value: "0", positionsValue: "0", cash: "0", investedCapital: "100" });
  });

  it("is empty when from is after to", () => {
    expect(valuationSeries([], [], NONE, "2026-01-02", "2026-01-01")).toEqual([]);
  });

  it("matches computePositions on every day with Prices, a split, an ISIN change and SELLs over two Securities", () => {
    const rows = [
      deposit("2025-12-20", "10000"),
      buy("2026-01-02", "10", "100", "s1", "1"),
      buy("2026-01-05", "3", "50", "s2", "2"),
      buy("2026-01-09", "5", "105", "s1"),
      sell("2026-01-14", "12", "60", "s1", "1.5"),
      row("DIVIDEND", "2026-01-15", { securityId: "s2", amount: "6", tax: "1.58" }),
      row("TAX", "2026-01-16", { tax: "-0.5" }),
      buy("2026-01-25", "2", "30", "s3"),
      sell("2026-01-27", "1", "31", "s3"),
      row("FEE", "2026-01-28", { fee: "4.9" }),
      row("WITHDRAWAL", "2026-02-01", { amount: "100" }),
      buy("2026-02-03", "1", "33", "s3"),
    ];
    // Another Depot's trade of s2 counts as a Transaction price too.
    const elsewhere: PriceObservation = { id: "x1", securityId: "s2", date: "2026-01-07", sequence: 3, price: "52", source: "transaction" };
    const actions: CorporateActions = {
      splits: [{ securityId: "s1", date: "2026-01-12", ratioOld: "1", ratioNew: "3" }],
      isinChanges: [{ oldSecurityId: "s2", newSecurityId: "s3", date: "2026-01-20", oldQuantity: "3", newQuantity: "2" }],
    };
    const observations = [
      ...tradeObservations(rows),
      elsewhere,
      provider("s1", "2026-01-03", "101"),
      provider("s1", "2026-01-09", "104"),
      manual("s1", "2026-01-09", "106"),
      provider("s1", "2026-01-13", "36"),
      provider("s2", "2026-01-06", "51"),
      provider("s2", "2026-01-19", "57"),
      provider("s3", "2026-01-22", "29"),
      provider("s3", "2026-02-02", "31.5"),
    ];
    const series = expectMatchesOracle(rows, observations, actions, "2025-12-25", "2026-02-06");
    // s1: 30 split units costing 1001 minus 12 sold (600.6 left) + 525; s2 lots moved into s3: 152.
    const day21 = series.find((p) => p.date === "2026-01-21")!;
    expect(day21.investedCapital).toBe("1277.6");
    // s1 at its SELL price 60; before s3 is quoted, the moved lots (2 units) carry the last s2 price 57 × 3/2.
    expect(day21.positionsValue).toBe(canonicalDecimal(new ExactDecimal(33).times(60).plus(new ExactDecimal(57).times(3).dividedBy(2).times(2))));
    // A Period starting after the split, and after the ISIN change, begins mid-segment.
    expect(expectMatchesOracle(rows, observations, actions, "2026-01-13", "2026-02-06").at(-1)).toEqual(series.at(-1));
    expect(expectMatchesOracle(rows, observations, actions, "2026-01-21", "2026-02-06")[0]).toEqual(day21);
  });
});

describe("investedCapital", () => {
  it("is the FIFO Cost Basis of open Positions as of a date", () => {
    const rows = [buy("2026-01-10", "10", "100", "s1", "5"), buy("2026-02-10", "5", "120", "s1", "2"), sell("2026-03-10", "12", "130", "s1", "3")];
    expect(investedCapital(rows, "2026-01-09", NONE)).toBe("0");
    expect(investedCapital(rows, "2026-02-10", NONE)).toBe("1607");
    expect(investedCapital(rows, "2026-10-25", NONE)).toBe("361.2");
  });
});

describe("periodFlows", () => {
  it("sums gross dividends and net taxes (paid minus refunds) of rows inside the Period", () => {
    const rows = [
      row("DIVIDEND", "2025-12-31", { securityId: "s1", amount: "99", tax: "9" }),
      row("DIVIDEND", "2026-01-01", { securityId: "s1", amount: "50", tax: "15" }),
      row("TAX", "2026-03-01", { tax: "-20" }),
      row("SELL", "2026-06-30", { securityId: "s1", quantity: "1", amount: "10", tax: "2" }),
      row("DIVIDEND", "2026-07-01", { securityId: "s1", amount: "7", tax: "1" }),
    ];
    expect(periodFlows(rows, "2026-01-01", "2026-06-30")).toEqual({ dividends: "50", taxesPaid: "-3" });
    expect(periodFlows(rows.slice(1, 3), "2026-01-01", "2026-06-30")).toEqual({ dividends: "50", taxesPaid: "-5" });
    expect(periodFlows([], "2026-01-01", "2026-06-30")).toEqual({ dividends: "0", taxesPaid: "0" });
  });
});

describe("valuationSeries performance", () => {
  it("renders three years of a busy Depot quickly", () => {
    const rows: Row[] = [deposit("2023-01-01", "1000000")];
    const observations: PriceObservation[] = [];
    let day = "2023-01-02";
    for (let i = 0; i < 1095; i++) {
      for (let s = 0; s < 15; s++) observations.push(provider(`s${s}`, day, String(100 + ((i + s) % 17))));
      if (i % 7 === 0) for (let s = 0; s < 15; s++) rows.push(buy(day, "1.5", "100", `s${s}`, "1"));
      day = addDays(day, 1);
    }
    const started = performance.now();
    const series = valuationSeries(rows, observations, NONE, "2023-01-01", addDays(day, -1));
    expect(series).toHaveLength(1096);
    // Generous bound: catches a per-day full re-resolve, not machine speed.
    expect(performance.now() - started).toBeLessThan(10000);
  });
});

describe("sumValuationSeries", () => {
  const point = (date: string, positionsValue: string, cash: string, investedCapital: string): ValuationPoint => ({
    date,
    value: new ExactDecimal(positionsValue).plus(cash).toFixed(),
    positionsValue,
    cash,
    investedCapital,
  });

  it("sums every field per date exactly", () => {
    const a = [point("2026-01-01", "100.1", "0.2", "90"), point("2026-01-02", "110", "-5.55", "90")];
    const b = [point("2026-01-01", "0", "0", "0"), point("2026-01-02", "33.333", "1000", "30.01")];
    expect(sumValuationSeries([a, b])).toEqual([
      { date: "2026-01-01", value: "100.3", positionsValue: "100.1", cash: "0.2", investedCapital: "90" },
      { date: "2026-01-02", value: "1137.783", positionsValue: "143.333", cash: "994.45", investedCapital: "120.01" },
    ]);
  });

  it("returns a single series unchanged and nothing for no series", () => {
    const a = [point("2026-01-01", "1", "2", "1")];
    expect(sumValuationSeries([a])).toEqual(a);
    expect(sumValuationSeries([])).toEqual([]);
  });

  it("throws when lengths or dates differ", () => {
    const a = [point("2026-01-01", "1", "0", "1"), point("2026-01-02", "1", "0", "1")];
    expect(() => sumValuationSeries([a, a.slice(1)])).toThrow();
    expect(() => sumValuationSeries([a, [point("2026-01-01", "1", "0", "1"), point("2026-01-03", "1", "0", "1")]])).toThrow();
  });
});
