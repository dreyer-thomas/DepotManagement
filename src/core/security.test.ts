import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS as NONE } from "./corporate-actions";
import { addDays } from "./dates";
import { ExactDecimal } from "./decimal";
import { computePositions } from "./positions";
import type { PriceObservation } from "./prices";
import {
  currentSecurityId,
  securityChain,
  securityFlowRows,
  securityLots,
  securityPerformance,
  securityPrice,
  securityPriceSeries,
  securitySeries,
  securitySnapshot,
  securityTotal,
  securityTrades,
  sumSecurityPerformance,
} from "./security";
import { type ValuationRow, valuationSeries } from "./valuation";

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
    securityId: input.securityId ?? "s1",
    type,
    date,
    sequence: input.sequence ?? ++counter,
    quantity: input.quantity ?? null,
    price: input.price ?? null,
    amount,
    fee: input.fee ?? "0",
    tax: input.tax ?? "0",
  };
}

const buy = (date: string, quantity: string, price: string, input: { securityId?: string; fee?: string } = {}) =>
  row("BUY", date, { quantity, price, ...input });
const sell = (date: string, quantity: string, price: string, input: { securityId?: string; fee?: string } = {}) =>
  row("SELL", date, { quantity, price, ...input });

const tradeObservations = (rows: Row[]): PriceObservation[] =>
  rows
    .filter((r) => r.price !== null && r.securityId !== null)
    .map((r) => ({ id: r.id, securityId: r.securityId!, date: r.date, sequence: r.sequence, price: r.price!, source: "transaction" }));

const provider = (date: string, price: string, securityId = "s1"): PriceObservation => ({
  id: `p-${securityId}-${date}`,
  securityId,
  date,
  sequence: 0,
  price,
  source: "provider",
});

/** As the ledger shell does it per Depot: one series from the day before `from`, as the Security series. */
function evaluate(rows: Row[], observations: PriceObservation[], from: string, to: string, actions: CorporateActions = NONE) {
  const points = securitySeries(valuationSeries(rows, observations, actions, addDays(from, -1), to));
  const start = points[0];
  const series = points.slice(1);
  return { rows, start, series, performance: securityPerformance(rows, start, series, actions) };
}

function expectIdentity(performance: ReturnType<typeof securityPerformance>) {
  const sum = new ExactDecimal(performance.realized)
    .plus(performance.unrealized)
    .plus(performance.dividends)
    .minus(performance.fees);
  expect(sum.equals(performance.gain)).toBe(true);
}

const isinChange = (oldSecurityId: string, newSecurityId: string, date: string, oldQuantity = "1", newQuantity = "1") => ({
  oldSecurityId,
  newSecurityId,
  date,
  oldQuantity,
  newQuantity,
});

describe("securityChain", () => {
  it("connects Securities by ISIN changes in both directions, transitively", () => {
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [isinChange("w", "x", "2025-01-01"), isinChange("x", "y", "2026-01-01")],
    };
    expect(securityChain("y", actions)).toEqual(["y", "x", "w"]);
    expect(securityChain("x", actions).sort()).toEqual(["w", "x", "y"]);
    expect(securityChain("z", actions)).toEqual(["z"]);
  });
});

describe("currentSecurityId", () => {
  it("follows the ISIN changes dated on or before the date", () => {
    const actions: CorporateActions = { splits: [], isinChanges: [isinChange("x", "y", "2026-05-01"), isinChange("y", "z", "2026-08-01")] };
    expect(currentSecurityId("x", actions, "2026-04-30")).toBe("x");
    expect(currentSecurityId("x", actions, "2026-05-01")).toBe("y");
    expect(currentSecurityId("x", actions, "2026-10-26")).toBe("z");
    expect(currentSecurityId("z", actions, "2026-10-26")).toBe("z");
  });
});

describe("securityFlowRows", () => {
  it("turns buys and fees into money in, sells and dividends into money out, ignoring taxes", () => {
    const flows = securityFlowRows([
      row("BUY", "2026-01-02", { quantity: "10", amount: "1000", fee: "1", tax: "3" }),
      row("SELL", "2026-02-02", { quantity: "10", amount: "1200", fee: "1", tax: "40" }),
      row("DIVIDEND", "2026-03-02", { amount: "20", fee: "0.5", tax: "5" }),
      row("FEE", "2026-04-02", { fee: "2" }),
      row("TAX", "2026-05-02", { tax: "7" }),
    ]);
    expect(flows.map(({ type, date, amount, tax }) => ({ type, date, amount, tax }))).toEqual([
      { type: "DEPOSIT", date: "2026-01-02", amount: "1001", tax: "0" },
      { type: "WITHDRAWAL", date: "2026-02-02", amount: "1199", tax: "0" },
      { type: "WITHDRAWAL", date: "2026-03-02", amount: "19.5", tax: "0" },
      { type: "DEPOSIT", date: "2026-04-02", amount: "2", tax: "0" },
    ]);
  });
});

describe("Security figures", () => {
  it("Two Depots: sums quantity, Cost Basis, value and unrealized per Depot", () => {
    const a = [buy("2026-02-02", "10", "100")];
    const b = [buy("2026-03-02", "5", "120")];
    const observations = [...tradeObservations([...a, ...b]), provider("2026-06-01", "110")];
    const today = "2026-10-26";

    const positionsA = computePositions(a, observations, today, NONE);
    const positionsB = computePositions(b, observations, today, NONE);
    expect(securitySnapshot([...positionsA, ...positionsB])).toEqual({
      quantity: "15",
      costBasis: "1600",
      value: "1650",
      unrealized: "50",
      averagePrice: new ExactDecimal(1600).dividedBy(15).toFixed(),
    });
    expect(securitySnapshot(positionsA)).toMatchObject({ quantity: "10", value: "1100", unrealized: "100", averagePrice: "100" });

    const partA = evaluate(a, observations, "2026-01-01", today);
    const partB = evaluate(b, observations, "2026-01-01", today);
    const total = sumSecurityPerformance([partA, partB]);
    expect(total.series.at(-1)).toMatchObject({ value: "1650", cash: "0", investedCapital: "1600" });
    expect(total.performance.gain).toBe("50");
    expect(total.performance.netExternalFlows).toBe("1600");
    expectIdentity(total.performance);
    expect(partA.performance.gain).toBe("100");
    expect(partB.performance.gain).toBe("-50");
  });

  it("Fully sold: realized gain, zero value, no lots", () => {
    const rows = [buy("2026-02-02", "10", "100", { fee: "1" }), sell("2026-05-04", "10", "120", { fee: "1" })];
    const observations = tradeObservations(rows);
    const result = evaluate(rows, observations, "2026-01-01", "2026-10-26");
    expect(result.performance.realized).toBe("198");
    expect(result.performance.gain).toBe("198");
    expect(result.performance.unrealized).toBe("0");
    expectIdentity(result.performance);
    expect(result.series.at(-1)?.value).toBe("0");
    expect(securitySnapshot(computePositions(rows, observations, "2026-10-26", NONE))).toEqual({
      quantity: "0",
      costBasis: "0",
      value: "0",
      unrealized: "0",
      averagePrice: null,
    });
    expect(securityLots(rows, "2026-10-26", NONE)).toEqual([]);
  });

  it("Dividend: counts the gross dividend in the gain, taxes separately", () => {
    const rows = [buy("2025-06-02", "10", "100"), row("DIVIDEND", "2026-04-01", { amount: "20", tax: "5" })];
    const result = evaluate(rows, tradeObservations(rows), "2026-01-01", "2026-10-26");
    expect(result.performance.dividends).toBe("20");
    expect(result.performance.taxesPaid).toBe("5");
    expect(result.performance.gain).toBe("20");
    expect(result.performance.fees).toBe("0");
    expectIdentity(result.performance);
    // 1000 → 1000 with 20 taken out: +2 %.
    expect(new ExactDecimal(result.performance.ttwror!).toDecimalPlaces(10).toFixed()).toBe("0.02");
  });

  it("Split: quantities and lots in the units after the split", () => {
    const rows = [buy("2026-02-02", "10", "100")];
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-06-01", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const snapshot = securitySnapshot(computePositions(rows, tradeObservations(rows), "2026-10-26", actions));
    expect(snapshot).toMatchObject({ quantity: "20", costBasis: "1000", averagePrice: "50", value: "1000" });
    expect(securityLots(rows, "2026-10-26", actions)).toEqual([{ date: "2026-02-02", sequence: rows[0].sequence, quantity: "20", costBasis: "1000", price: "50" }]);
    expect(securityPrice(tradeObservations(rows), "s1", actions, "2026-10-26")?.price).toBe("50");
    const result = evaluate(rows, tradeObservations(rows), "2026-01-01", "2026-10-26", actions);
    expect(result.performance.gain).toBe("0");
  });

  it("ISIN change: the old and the new Security give the same figures as the new one", () => {
    const rows = [buy("2026-02-02", "10", "100", { securityId: "x" })];
    const actions: CorporateActions = { splits: [], isinChanges: [isinChange("x", "y", "2026-06-01", "10", "10")] };
    const observations = [...tradeObservations(rows), provider("2026-09-01", "110", "y")];
    for (const page of ["x", "y"]) {
      expect(securityChain(page, actions).sort()).toEqual(["x", "y"]);
      const current = currentSecurityId(page, actions, "2026-10-26");
      expect(current).toBe("y");
      expect(securityPrice(observations, current, actions, "2026-10-26")).toMatchObject({ price: "110", date: "2026-09-01" });
    }
    const positions = computePositions(rows, observations, "2026-10-26", actions);
    expect(positions.map((position) => position.securityId)).toEqual(["y"]);
    expect(securitySnapshot(positions)).toMatchObject({ quantity: "10", value: "1100", unrealized: "100" });
    const result = evaluate(rows, observations, "2026-01-01", "2026-10-26", actions);
    expect(result.performance.gain).toBe("100");
    expect(new ExactDecimal(result.performance.ttwror!).toDecimalPlaces(10).toFixed()).toBe("0.1");
  });

  it("TTWROR of one buy and a price rise is the price change; XIRR is positive", () => {
    const rows = [buy("2026-01-10", "10", "100")];
    const observations = [...tradeObservations(rows), provider("2026-07-10", "110")];
    const result = evaluate(rows, observations, "2026-01-01", "2026-07-10");
    expect(result.start.value).toBe("0");
    expect(result.performance.ttwror).toBe("0.1");
    expect(result.performance.netExternalFlows).toBe("1000");
    expect(result.performance.gain).toBe("100");
    // 1000 paid on 10.01., 1100 back on 10.07. (181 days): (1.1)^(365/181) − 1.
    const expected = Math.pow(1.1, 365 / 181) - 1;
    expect(Number(result.performance.xirr)).toBeCloseTo(expected, 8);
  });

  it("keeps the gain identity with trades, fees and dividends across the Period start", () => {
    const rows = [
      buy("2025-11-03", "10", "90", { fee: "2" }),
      buy("2026-02-02", "5", "100", { fee: "1.5" }),
      sell("2026-04-01", "8", "105", { fee: "3" }),
      row("DIVIDEND", "2026-05-02", { amount: "12.34", fee: "0.5", tax: "3" }),
      row("FEE", "2026-06-02", { fee: "4.9" }),
    ];
    const observations = [...tradeObservations(rows), provider("2026-01-15", "95.5"), provider("2026-08-20", "111.11")];
    const result = evaluate(rows, observations, "2026-01-01", "2026-10-26");
    expectIdentity(result.performance);
    expect(result.performance.fees).toBe("5.4");
    expect(result.performance.feesContribution).toBe("-5.4");
  });

  it("sums no price as unknown value", () => {
    const rows = [buy("2026-02-02", "10", "100")];
    const snapshot = securitySnapshot(computePositions(rows, [], "2026-10-26", NONE));
    expect(snapshot).toMatchObject({ quantity: "10", value: null, unrealized: null, averagePrice: "100" });
  });
});

describe("securityTotal", () => {
  const today = "2026-10-26";

  it("Fully sold: realized 198, total 198, invested 1001, ratio and one-year XIRR 198/1001", () => {
    const rows = [buy("2025-01-02", "10", "100", { fee: "1" }), sell("2026-01-02", "10", "120", { fee: "1" })];
    const total = securityTotal([rows], tradeObservations(rows), NONE, today);
    expect(total).toMatchObject({
      realized: "198",
      unrealized: "0",
      dividends: "0",
      fees: "0",
      taxesPaid: "0",
      total: "198",
      totalInvested: "1001",
      value: "0",
    });
    expect(Number(total.returnRatio)).toBeCloseTo(198 / 1001, 12);
    // −1001 on 02.01.2025, +1199 on 02.01.2026 (365 days): 1199/1001 − 1.
    expect(Number(total.xirr)).toBeCloseTo(1199 / 1001 - 1, 10);
  });

  it("Two Depots: sums per Depot; XIRR over the merged flows and the summed value", () => {
    const a = [buy("2026-02-02", "10", "100")];
    const b = [buy("2026-03-02", "5", "120")];
    const observations = [...tradeObservations([...a, ...b]), provider("2026-06-01", "110")];
    const all = securityTotal([a, b], observations, NONE, today);
    expect(all).toMatchObject({ totalInvested: "1600", unrealized: "50", total: "50", value: "1650", realized: "0" });
    expect(all.returnRatio).toBe(canonical(new ExactDecimal(50).dividedBy(1600)));
    // Merged flows: −1000 on 02.02., −600 on 02.03. (28 days later), +1650 on 26.10. (266 days later).
    const r = Number(all.xirr);
    const npv = -1000 - 600 * Math.pow(1 + r, -28 / 365) + 1650 * Math.pow(1 + r, -266 / 365);
    expect(npv).toBeCloseTo(0, 6);
    const depotA = securityTotal([a], observations, NONE, today);
    expect(depotA).toMatchObject({ totalInvested: "1000", unrealized: "100", total: "100", returnRatio: "0.1" });
  });

  it("Dividend + fee: dividends 20, fees 3, taxes 5 separate", () => {
    const rows = [
      buy("2025-06-02", "10", "100"),
      row("DIVIDEND", "2026-04-01", { amount: "20", fee: "1", tax: "5" }),
      row("FEE", "2026-05-01", { fee: "2" }),
    ];
    const total = securityTotal([rows], tradeObservations(rows), NONE, today);
    expect(total).toMatchObject({ dividends: "20", fees: "3", taxesPaid: "5", unrealized: "0", total: "17", totalInvested: "1000" });
    expect(total.returnRatio).toBe("0.017");
  });

  it("hand-checked XIRR: buy, dividend and current value", () => {
    // −1000 on 26.10.2025, +19 (dividend 20 − fee 1) on 26.04.2026 (182 days), +1100 on 26.10.2026 (365 days).
    const rows = [buy("2025-10-26", "10", "100"), row("DIVIDEND", "2026-04-26", { amount: "20", fee: "1" })];
    const total = securityTotal([rows], [...tradeObservations(rows), provider("2026-10-01", "110")], NONE, today);
    const r = Number(total.xirr);
    const npv = -1000 + 19 * Math.pow(1 + r, -182 / 365) + 1100 * Math.pow(1 + r, -1);
    expect(npv).toBeCloseTo(0, 6);
    expect(r).toBeGreaterThan(0.1);
    expect(r).toBeLessThan(0.13);
  });

  it("Split: total unaffected", () => {
    const rows = [buy("2026-02-02", "10", "100")];
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-06-01", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const total = securityTotal([rows], [...tradeObservations(rows), provider("2026-09-01", "55")], actions, today);
    expect(total).toMatchObject({ value: "1100", unrealized: "100", total: "100", totalInvested: "1000" });
  });

  it("No price: unrealized, total, ratio and XIRR are null", () => {
    const rows = [row("BUY", "2026-02-02", { quantity: "10", amount: "1000" })];
    const total = securityTotal([rows], [], NONE, today);
    expect(total).toMatchObject({ value: null, unrealized: null, total: null, returnRatio: null, xirr: null, totalInvested: "1000" });
  });

  it("ignores rows dated after today", () => {
    const rows = [buy("2026-02-02", "10", "100"), row("DIVIDEND", "2026-04-01", { amount: "20" })];
    const observations = [...tradeObservations(rows), provider("2026-10-01", "110")];
    const without = securityTotal([rows], observations, NONE, today);
    const later = [...rows, buy("2026-11-02", "5", "120"), row("DIVIDEND", "2026-11-03", { amount: "7" })];
    const withLater = securityTotal([later], observations, NONE, today);
    expect(withLater.totalInvested).toBe(without.totalInvested);
    expect(withLater.dividends).toBe(without.dividends);
    expect(withLater.xirr).toBe(without.xirr);
    expect(without.xirr).not.toBeNull();
  });

  it("no buys: ratio null", () => {
    expect(securityTotal([[]], [], NONE, today)).toMatchObject({ totalInvested: "0", total: "0", returnRatio: null, xirr: null });
  });
});

describe("securityPriceSeries", () => {
  it("carries the resolver price forward, null before the first observation", () => {
    const observations = [provider("2026-01-03", "10"), provider("2026-01-05", "12"), { ...provider("2026-01-05", "13"), id: "m", source: "manual" as const }];
    expect(securityPriceSeries(observations, "s1", NONE, "2026-01-01", "2026-01-06")).toEqual([
      { date: "2026-01-01", price: null },
      { date: "2026-01-02", price: null },
      { date: "2026-01-03", price: "10" },
      { date: "2026-01-04", price: "10" },
      { date: "2026-01-05", price: "13" },
      { date: "2026-01-06", price: "13" },
    ]);
    // Earlier observations carry into the range; other Securities are ignored.
    expect(securityPriceSeries([...observations, provider("2026-01-08", "99", "s2")], "s1", NONE, "2026-01-07", "2026-01-08")).toEqual([
      { date: "2026-01-07", price: "13" },
      { date: "2026-01-08", price: "13" },
    ]);
    expect(securityPriceSeries(observations, "s1", NONE, "2026-01-02", "2026-01-01")).toEqual([]);
  });

  it("Split: prices before the split are adjusted to the units as of the end", () => {
    const rows = [buy("2026-02-02", "10", "100")];
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-02-04", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const observations = [...tradeObservations(rows), provider("2026-02-05", "52")];
    expect(securityPriceSeries(observations, "s1", actions, "2026-02-02", "2026-02-05").map((point) => point.price)).toEqual([
      "50",
      "50",
      "50",
      "52",
    ]);
  });

  it("ISIN change: the old Security's observations continue the new one's line", () => {
    const actions: CorporateActions = { splits: [], isinChanges: [isinChange("x", "y", "2026-03-01", "1", "2")] };
    const observations = [provider("2026-02-27", "100", "x"), provider("2026-03-02", "51", "y")];
    expect(securityPriceSeries(observations, "y", actions, "2026-02-28", "2026-03-02").map((point) => point.price)).toEqual(["50", "50", "51"]);
  });
});

describe("securityTrades", () => {
  const trade = (r: Row, depotName = "Depot A") => ({ ...r, depotName });

  it("Split: quantity and price in the units after the split, flagged as adjusted", () => {
    const rows = [buy("2026-02-02", "10", "100")];
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-06-01", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    expect(securityTrades(rows.map((r) => trade(r)), actions, "2026-10-26")).toEqual([
      { depotName: "Depot A", type: "BUY", date: "2026-02-02", sequence: rows[0].sequence, quantity: "20", price: "50", adjusted: true },
    ]);
    expect(securityTrades(rows.map((r) => trade(r)), actions, "2026-05-31")[0]).toMatchObject({ quantity: "10", price: "100", adjusted: false });
  });

  it("ISIN change: quantity and price in the new Security's units, flagged as adjusted", () => {
    const rows = [buy("2026-02-02", "10", "100", { securityId: "x" })];
    const actions: CorporateActions = { splits: [], isinChanges: [isinChange("x", "y", "2026-06-01", "1", "2")] };
    expect(securityTrades(rows.map((r) => trade(r)), actions, "2026-10-26")[0]).toMatchObject({
      quantity: "20",
      price: "50",
      adjusted: true,
    });
  });

  it("orders BUY/SELL by date and sequence, derives a missing price from the amount, skips other types", () => {
    const rows = [
      sell("2026-03-02", "4", "120"),
      row("BUY", "2026-01-02", { quantity: "8", amount: "1000" }),
      row("DIVIDEND", "2026-02-02", { amount: "5" }),
    ];
    const trades = securityTrades(
      rows.map((r) => trade(r, "B")),
      NONE,
      "2026-10-26",
    );
    expect(trades.map(({ type, date, quantity, price, adjusted, depotName }) => ({ type, date, quantity, price, adjusted, depotName }))).toEqual([
      { type: "BUY", date: "2026-01-02", quantity: "8", price: "125", adjusted: false, depotName: "B" },
      { type: "SELL", date: "2026-03-02", quantity: "4", price: "120", adjusted: false, depotName: "B" },
    ]);
  });
});

function canonical(value: InstanceType<typeof ExactDecimal>): string {
  return value.toFixed();
}
