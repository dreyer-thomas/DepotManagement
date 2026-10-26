// ADJUSTMENT (holding correction, story 2.9) across every lot book and the returns: one replay rule.
import { describe, expect, it } from "vitest";
import { canArchive, heldSecurities, isFlat } from "./archive";
import { cashBalance, cashEffect } from "./cash";
import { NO_CORPORATE_ACTIONS as NONE } from "./corporate-actions";
import { addDays } from "./dates";
import { ExactDecimal } from "./decimal";
import { saleFees } from "./fee-attribution";
import { fifo } from "./fifo";
import { firstOversell, sellableAt, sellableQuantity } from "./holdings";
import { computePositions } from "./positions";
import type { PriceObservation } from "./prices";
import { periodCashFlows, periodPerformance, portfolioPerformance, type PeriodPerformance, xirr } from "./returns";
import { securityPerformance, securitySeries, securityTotal } from "./security";
import { sumValuationSeries, type ValuationRow, valuationSeries } from "./valuation";

type Row = ValuationRow & { id: string; price: string | null };

let counter = 0;
function row(
  type: string,
  date: string,
  input: { securityId?: string | null; quantity?: string; price?: string; amount?: string; fee?: string } = {},
): Row {
  const amount =
    input.amount ??
    (type !== "ADJUSTMENT" && input.quantity && input.price
      ? new ExactDecimal(input.quantity).times(input.price).toFixed()
      : "0");
  return {
    id: `t${++counter}`,
    securityId: input.securityId === undefined ? "s1" : input.securityId,
    type,
    date,
    sequence: ++counter,
    quantity: input.quantity ?? null,
    price: input.price ?? null,
    amount,
    fee: input.fee ?? "0",
    tax: "0",
  };
}

const buy = (date: string, quantity: string, price: string, securityId = "s1") => row("BUY", date, { quantity, price, securityId });
const sell = (date: string, quantity: string, price: string) => row("SELL", date, { quantity, price });
const adjust = (date: string, quantity: string, price?: string, securityId = "s1") =>
  row("ADJUSTMENT", date, { quantity, price, securityId });
const deposit = (date: string, amount: string) => row("DEPOSIT", date, { amount, securityId: null });

const provider = (date: string, price: string, securityId = "s1"): PriceObservation => ({
  id: `p-${securityId}-${date}`,
  securityId,
  date,
  sequence: 0,
  price,
  source: "provider",
});

function expectIdentity(performance: PeriodPerformance) {
  const sum = new ExactDecimal(performance.realized)
    .plus(performance.unrealized)
    .plus(performance.dividends)
    .minus(performance.fees);
  expect(sum.equals(performance.gain)).toBe(true);
}

function evaluate(rows: Row[], observations: PriceObservation[], from: string, to: string) {
  const points = valuationSeries(rows, observations, NONE, addDays(from, -1), to);
  const start = points[0];
  const series = points.slice(1);
  return { rows, start, series, performance: periodPerformance(rows, start, series, NONE) };
}

describe("ADJUSTMENT in FIFO", () => {
  it("positive correction adds a lot at quantity × unit cost, no sale", () => {
    const rows = [buy("2026-01-10", "10", "100"), adjust("2026-02-01", "2", "100")];
    expect(fifo(rows, "2026-10-25", NONE)).toEqual([
      {
        securityId: "s1",
        lots: [
          { date: "2026-01-10", sequence: rows[0].sequence, quantity: "10", costBasis: "1000" },
          { date: "2026-02-01", sequence: rows[1].sequence, quantity: "2", costBasis: "200" },
        ],
        sales: [],
      },
    ]);
    const [position] = computePositions(rows, [], "2026-10-25", NONE);
    expect(position).toMatchObject({ quantity: "12", costBasis: "1200", averagePrice: "100" });
  });

  it("negative correction consumes the oldest units at their Cost Basis and realizes nothing", () => {
    const rows = [buy("2026-01-10", "10", "100"), buy("2026-02-10", "10", "120"), adjust("2026-03-01", "-15")];
    const [result] = fifo(rows, "2026-10-25", NONE);
    expect(result.sales).toEqual([]);
    expect(result.lots).toEqual([{ date: "2026-02-10", sequence: rows[1].sequence, quantity: "5", costBasis: "600" }]);
    expect(saleFees(rows, "2026-10-25", NONE).size).toBe(0);
  });

  it("a later SELL consumes the corrected lots", () => {
    const rows = [buy("2026-01-10", "10", "100"), adjust("2026-02-01", "-4"), sell("2026-03-01", "6", "150")];
    const [result] = fifo(rows, "2026-10-25", NONE);
    expect(result.sales).toEqual([
      { date: "2026-03-01", sequence: rows[2].sequence, quantity: "6", proceeds: "900", costBasis: "600", gain: "300" },
    ]);
  });

  it("throws when a positive correction was loaded without its price", () => {
    const rows = [{ securityId: "s1", type: "ADJUSTMENT", date: "2026-01-01", sequence: 1, quantity: "1", amount: "0", fee: "0" }];
    expect(() => fifo(rows, "2026-10-25", NONE)).toThrow(TypeError);
  });
});

describe("ADJUSTMENT in holdings and the archive guard", () => {
  const trade = (type: string, date: string, quantity: string, sequence = 1) => ({ securityId: "s1", type, date, sequence, quantity });

  it("a negative correction beyond the holding is limited by sellableAt", () => {
    const trades = [trade("BUY", "2026-01-10", "5")];
    expect(sellableAt(trades, "s1", { date: "2026-02-01", sequence: 1 }, NONE)).toBe("5");
  });

  it("corrections change the sellable quantity", () => {
    const trades = [trade("BUY", "2026-01-10", "5"), trade("ADJUSTMENT", "2026-01-11", "2"), trade("ADJUSTMENT", "2026-01-12", "-3")];
    expect(sellableQuantity(trades, "s1", "2026-02-01", NONE)).toBe("4");
  });

  it("firstOversell reports a negative correction that oversells, never a positive one", () => {
    const over = trade("ADJUSTMENT", "2026-02-01", "-6");
    expect(firstOversell([trade("BUY", "2026-01-10", "5"), over], NONE)).toBe(over);
    expect(firstOversell([trade("BUY", "2026-01-10", "5"), trade("ADJUSTMENT", "2026-02-01", "3")], NONE)).toBeNull();
  });

  it("a Position corrected to zero is flat; a correction alone makes a Security held", () => {
    const rows = [buy("2026-01-10", "5", "0"), adjust("2026-02-01", "-5")];
    expect(isFlat(rows, "2026-10-25", NONE)).toBe(true);
    expect(canArchive(rows, "2026-10-25", NONE)).toBe(true);
    const held = heldSecurities(
      { depots: [{ id: "d1", archived: false }], trades: [{ ...adjust("2026-01-01", "1", "10", "s9"), depotId: "d1" }] },
      "2026-10-25",
      NONE,
    );
    expect(held).toEqual(["s9"]);
  });

  it("has no cash effect", () => {
    const correction = adjust("2026-02-01", "2", "100");
    expect(cashEffect(correction)).toBe("0");
    expect(cashBalance([deposit("2026-01-01", "50"), correction], "2026-10-25")).toBe("50");
  });
});

describe("ADJUSTMENT in the valuation series and returns", () => {
  it("returns unaffected: gain 0, TTWROR 0, netExternalFlows 200, identity holds", () => {
    const rows = [deposit("2026-01-01", "1000"), buy("2026-01-01", "10", "100"), adjust("2026-01-03", "2", "100")];
    const observations = [provider("2026-01-01", "100")];
    const { series, performance } = evaluate(rows, observations, "2026-01-01", "2026-01-05");
    expect(series[2]).toMatchObject({ date: "2026-01-03", value: "1200", adjustmentValue: "200", adjustmentCost: "200" });
    expect(series[1].adjustmentValue).toBeUndefined();
    expect(performance).toMatchObject({ gain: "0", unrealized: "0", realized: "0", ttwror: "0", netExternalFlows: "1200" });
    expectIdentity(performance);
    // The Period after the deposit: only the correction is an external flow.
    const later = evaluate(rows, observations, "2026-01-02", "2026-01-05").performance;
    expect(later).toMatchObject({ gain: "0", ttwror: "0", netExternalFlows: "200" });
  });

  it("negative correction at a market price above cost: an outflow, the gain stays the price move", () => {
    const rows = [deposit("2026-01-01", "1000"), buy("2026-01-01", "10", "100"), adjust("2026-01-03", "-5")];
    const observations = [provider("2026-01-01", "100"), provider("2026-01-02", "120")];
    const { series, performance } = evaluate(rows, observations, "2026-01-01", "2026-01-03");
    expect(series[2]).toMatchObject({ value: "600", adjustmentValue: "-600", adjustmentCost: "-500" });
    expect(performance).toMatchObject({ gain: "200", realized: "0", unrealized: "200", netExternalFlows: "400" });
    expect(Number(performance.ttwror)).toBeCloseTo(0.2, 12);
    expectIdentity(performance);
    expect(periodCashFlows(rows, series[0], series.slice(1))).toEqual([
      { date: "2026-01-01", amount: "-1000" },
      { date: "2026-01-03", amount: "600" },
      { date: "2026-01-03", amount: "600" },
    ]);
  });

  it("a correction without any price is a zero flow and leaves gain and unrealized at 0", () => {
    const rows = [deposit("2026-01-01", "1000"), buy("2026-01-01", "10", "100"), adjust("2026-01-02", "3", "50", "s2")];
    const observations = [provider("2026-01-01", "100")];
    const { series, performance } = evaluate(rows, observations, "2026-01-01", "2026-01-03");
    expect(series[1]).toMatchObject({ adjustmentValue: "0", adjustmentCost: "150", investedCapital: "1150" });
    expect(performance).toMatchObject({ gain: "0", unrealized: "0", ttwror: "0", netExternalFlows: "1000" });
    expectIdentity(performance);
  });

  it("Portfolio: the summed series carries the corrections; TTWROR and gain stay 0", () => {
    const a = [deposit("2026-01-01", "1000"), buy("2026-01-01", "10", "100"), adjust("2026-01-03", "2", "90")];
    const b = [deposit("2026-01-01", "500"), buy("2026-01-01", "5", "100", "s2"), adjust("2026-01-03", "-1", undefined, "s2")];
    const observations = [provider("2026-01-01", "100"), provider("2026-01-01", "100", "s2")];
    const parts = [evaluate(a, observations, "2026-01-02", "2026-01-04"), evaluate(b, observations, "2026-01-02", "2026-01-04")];
    const summed = sumValuationSeries(parts.map((part) => part.series));
    expect(summed[1]).toMatchObject({ adjustmentValue: "100", adjustmentCost: "80" });
    expect(summed[0].adjustmentValue).toBeUndefined();
    const portfolio = portfolioPerformance(parts);
    expect(portfolio.performance).toMatchObject({ gain: "0", ttwror: "0", netExternalFlows: "100", unrealized: "0" });
    expectIdentity(portfolio.performance);
  });
});

describe("ADJUSTMENT in the Security figures", () => {
  it("securityPerformance counts the correction as a flow: gain 0, TTWROR 0", () => {
    const rows = [buy("2026-01-01", "10", "100"), adjust("2026-01-03", "2", "80")];
    const observations = [provider("2026-01-01", "100")];
    const points = securitySeries(valuationSeries(rows, observations, NONE, "2026-01-01", "2026-01-05"));
    const performance = securityPerformance(rows, points[0], points.slice(1), NONE);
    expect(performance).toMatchObject({ gain: "0", unrealized: "0", ttwror: "0", netExternalFlows: "200" });
    expectIdentity(performance);
  });

  it("securityTotal XIRR adds −(quantity × price as of its date) per correction", () => {
    const rows = [buy("2025-01-01", "10", "100"), adjust("2025-07-01", "10", "100")];
    const observations = [provider("2025-01-01", "100"), provider("2025-07-01", "110"), provider("2026-01-01", "121")];
    const total = securityTotal([rows], observations, NONE, "2026-01-01");
    expect(total).toMatchObject({ value: "2420", unrealized: "420", realized: "0" });
    const expected = xirr([
      { date: "2025-01-01", amount: "-1000" },
      { date: "2025-07-01", amount: "-1100" },
      { date: "2026-01-01", amount: "2420" },
    ]);
    expect(total.xirr).toBe(expected);
  });

  it("securityTotal counts a positive correction's Cost Basis as invested, a negative one not", () => {
    const rows = [buy("2025-01-01", "10", "100"), adjust("2025-07-01", "2", "80"), adjust("2025-08-01", "-1")];
    const total = securityTotal([rows], [provider("2025-01-01", "100")], NONE, "2026-01-01");
    expect(total.totalInvested).toBe("1160");
    expect(total.returnRatio).toBe(new ExactDecimal(total.total!).dividedBy(1160).toFixed());
  });
});
