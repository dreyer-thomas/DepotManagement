import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS as NONE } from "./corporate-actions";
import { addDays, daysBetween } from "./dates";
import { ExactDecimal } from "./decimal";
import type { PriceObservation } from "./prices";
import { externalFlow, periodPerformance, ttwror, xirr } from "./returns";
import { type ValuationPoint, type ValuationRow, valuationSeries } from "./valuation";

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

const buy = (date: string, quantity: string, price: string, input: { securityId?: string; fee?: string; sequence?: number } = {}) =>
  row("BUY", date, { securityId: "s1", quantity, price, sequence: 2, ...input });
const sell = (date: string, quantity: string, price: string, input: { securityId?: string; fee?: string; sequence?: number } = {}) =>
  row("SELL", date, { securityId: "s1", quantity, price, sequence: 2, ...input });
const deposit = (date: string, amount: string, sequence = 1) => row("DEPOSIT", date, { amount, sequence });
const withdrawal = (date: string, amount: string, sequence = 3) => row("WITHDRAWAL", date, { amount, sequence });

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

/** As the ledger shell does it: one series from the day before `from`, split into start + Period. */
function evaluate(rows: Row[], prices: PriceObservation[], from: string, to: string, actions: CorporateActions = NONE) {
  const points = valuationSeries(rows, [...tradeObservations(rows), ...prices], actions, addDays(from, -1), to);
  const start = points[0];
  const series = points.slice(1);
  return { start, series, performance: periodPerformance(rows, start, series, actions) };
}

function expectIdentity(performance: ReturnType<typeof periodPerformance>) {
  const sum = new ExactDecimal(performance.realized)
    .plus(performance.unrealized)
    .plus(performance.dividends)
    .minus(performance.fees);
  expect(sum.equals(performance.gain)).toBe(true);
}

function expectClose(actual: string | null, expected: string, tolerance = "1e-9") {
  expect(actual).not.toBeNull();
  expect(new Decimal(actual!).minus(expected).abs().lessThanOrEqualTo(tolerance)).toBe(true);
}

describe("externalFlow", () => {
  it("counts Deposits in, Withdrawals out and taxes out (refunds in)", () => {
    expect(externalFlow(deposit("2026-01-01", "500"))).toBe("500");
    expect(externalFlow(withdrawal("2026-01-01", "200"))).toBe("-200");
    expect(externalFlow(row("TAX", "2026-01-01", { tax: "-20" }))).toBe("20");
    expect(externalFlow(row("DIVIDEND", "2026-01-01", { securityId: "s1", amount: "30", fee: "1", tax: "5" }))).toBe("-5");
    expect(externalFlow(buy("2026-01-01", "1", "100", { fee: "2" }))).toBe("0");
    expect(externalFlow(row("FEE", "2026-01-01", { fee: "3" }))).toBe("0");
  });
});

describe("periodPerformance", () => {
  it("matches the hand-calculated reference: gain 320, TTWROR 0.21, XIRR 0.1", () => {
    const rows = [
      deposit("2021-01-01", "1000"),
      buy("2021-01-01", "10", "100"),
      deposit("2022-01-01", "1100"),
      buy("2022-01-01", "10", "110"),
    ];
    const { start, series, performance } = evaluate(rows, [provider("2021-12-31", "110"), provider("2023-01-01", "121")], "2021-01-02", "2023-01-01");
    expect(start).toMatchObject({ date: "2021-01-01", value: "1000", cash: "0" });
    expect(series.at(-1)!.value).toBe("2420");
    expect(performance).toMatchObject({
      gain: "320",
      unrealized: "320",
      realized: "0",
      dividends: "0",
      fees: "0",
      taxesPaid: "0",
      netExternalFlows: "1100",
      ttwror: "0.21",
    });
    expectClose(performance.xirr, "0.1");
    expectIdentity(performance);
  });

  it("does not count a Deposit as gain", () => {
    const { performance } = evaluate([deposit("2026-01-10", "5000")], [], "2026-01-01", "2026-01-31");
    expect(performance).toMatchObject({ gain: "0", netExternalFlows: "5000", ttwror: "0", xirr: "0" });
  });

  it("treats a tax refund as an external inflow, not as gain", () => {
    const { performance } = evaluate([row("TAX", "2026-01-10", { tax: "-20" })], [], "2026-01-01", "2026-01-31");
    expect(performance).toMatchObject({ gain: "0", taxesPaid: "-20", netExternalFlows: "20" });
    expectIdentity(performance);
  });

  it("satisfies (1 + XIRR)^(days/365) = 1 + TTWROR = V(to)/V(start) for a Period without flows", () => {
    const rows = [deposit("2025-03-01", "1000"), buy("2025-03-01", "8", "100")];
    const prices = [provider("2025-06-01", "95"), provider("2025-11-15", "131.7"), provider("2026-02-10", "118.25")];
    const { start, series, performance } = evaluate(rows, prices, "2025-05-01", "2026-03-31");
    expect(performance.netExternalFlows).toBe("0");
    const end = series.at(-1)!;
    expectClose(performance.ttwror, new Decimal(end.value).dividedBy(start.value).minus(1).toFixed());
    const days = daysBetween(start.date, end.date);
    const grown = new Decimal(1).plus(performance.xirr!).pow(new Decimal(days).dividedBy(365));
    expectClose(grown.minus(1).toFixed(), performance.ttwror!);
    expectIdentity(performance);
  });

  it("splits a sale, a dividend and fees and keeps the identity", () => {
    const rows = [
      deposit("2026-01-01", "2000"),
      buy("2026-01-02", "10", "100", { fee: "5" }),
      sell("2026-02-10", "4", "130", { fee: "3" }),
      row("DIVIDEND", "2026-03-01", { securityId: "s1", amount: "30", fee: "1", tax: "5" }),
      row("FEE", "2026-03-02", { fee: "2" }),
    ];
    const { performance } = evaluate(rows, [provider("2026-03-20", "125")], "2026-02-01", "2026-03-31");
    // 517 proceeds − 4/10 of 1005.
    expect(performance).toMatchObject({
      realized: "115",
      dividends: "30",
      fees: "3",
      feesContribution: "-3",
      taxesPaid: "5",
      netExternalFlows: "-5",
    });
    // Unrealized: at start 10 × 100 − 1005 = −5; at the end 6 × 125 − 603 = 147.
    expect(performance.unrealized).toBe("152");
    expectIdentity(performance);
    expect(performance.gain).toBe("294");
  });

  it("starts from zero for MAX: the first day's denominator is the Deposit", () => {
    const rows = [deposit("2026-01-05", "1000"), buy("2026-01-05", "10", "100")];
    const { start, series, performance } = evaluate(rows, [provider("2026-01-20", "110")], "2026-01-05", "2026-01-31");
    expect(start).toMatchObject({ date: "2026-01-04", value: "0" });
    // First day: (V 1000 + out 0) / (V(start) 0 + in 1000) = 1; later 1100 / 1000.
    expect(ttwror(start, series.slice(0, 1), rows)).toBe("0");
    expect(performance).toMatchObject({ gain: "100", ttwror: "0.1", unrealized: "100" });
    expect(performance.xirr).not.toBeNull();
  });

  it("gives null returns and zero gain when nothing was invested", () => {
    const rows = [deposit("2025-01-01", "100"), withdrawal("2025-01-02", "100")];
    const { performance } = evaluate(rows, [], "2026-01-01", "2026-01-31");
    expect(performance).toMatchObject({ gain: "0", ttwror: null, xirr: null, netExternalFlows: "0" });
  });

  it("skips the day of a full Withdrawal instead of dividing by zero", () => {
    const rows = [
      deposit("2025-12-01", "1000"),
      withdrawal("2026-01-10", "1000"),
      deposit("2026-01-15", "500"),
      buy("2026-01-15", "5", "100"),
    ];
    const { performance } = evaluate(rows, [provider("2026-01-25", "120")], "2026-01-01", "2026-01-31");
    expect(performance).toMatchObject({ gain: "100", ttwror: "0.2", netExternalFlows: "-500" });
    expect(performance.xirr).not.toBeNull();
  });

  it("measures a same-day SELL + full WITHDRAWAL against the prior value (liquidation on a down day)", () => {
    const rows = [
      deposit("2026-01-01", "1000"),
      buy("2026-01-01", "10", "100"),
      sell("2026-01-03", "10", "99"),
      withdrawal("2026-01-03", "990"),
    ];
    const { series, performance } = evaluate(rows, [], "2026-01-02", "2026-01-06");
    expect(series.map((point) => point.value)).toEqual(["1000", "0", "0", "0", "0"]);
    expect(performance).toMatchObject({ gain: "-10", realized: "-10", ttwror: "-0.01", netExternalFlows: "-990" });
    expectIdentity(performance);
  });

  it("keeps the identity exactly across a split, an ISIN change, SELLs, dividends and taxes for many Periods", () => {
    const actions: CorporateActions = {
      splits: [{ securityId: "s1", date: "2026-01-12", ratioOld: "1", ratioNew: "3" }],
      isinChanges: [{ oldSecurityId: "s2", newSecurityId: "s3", date: "2026-01-20", oldQuantity: "3", newQuantity: "2" }],
    };
    const rows = [
      deposit("2026-01-01", "3000"),
      buy("2026-01-05", "10", "100.1", { fee: "1.23" }),
      buy("2026-01-06", "3", "50", { securityId: "s2", fee: "0.77" }),
      sell("2026-01-15", "12", "40.07", { fee: "2.01" }),
      buy("2026-01-16", "7", "33.3", { fee: "1" }),
      row("DIVIDEND", "2026-01-28", { securityId: "s3", amount: "10.11", fee: "0.5", tax: "2.53" }),
      row("FEE", "2026-01-29", { fee: "1.5" }),
      row("TAX", "2026-01-29", { tax: "-1.07" }),
      withdrawal("2026-01-30", "100"),
      sell("2026-02-03", "2", "91", { securityId: "s3", fee: "0.9" }),
    ];
    const prices = [
      provider("2026-01-08", "104.2"),
      provider("2026-01-14", "36.9"),
      provider("2026-01-25", "90", "s3"),
      provider("2026-01-27", "35.55"),
    ];
    for (const [from, to] of [
      ["2026-01-01", "2026-02-10"],
      ["2026-01-10", "2026-02-05"],
      ["2026-01-13", "2026-01-21"],
      ["2026-01-21", "2026-02-03"],
      ["2026-01-16", "2026-01-16"],
    ]) {
      const { performance } = evaluate(rows, prices, from, to, actions);
      expectIdentity(performance);
    }
    const { performance } = evaluate(rows, prices, "2026-01-01", "2026-02-10", actions);
    expect(performance.realized).not.toBe("0");
    expect(performance.ttwror).not.toBeNull();
  });

  it("evaluates a 3-year daily series with ~50 flow days quickly", () => {
    const rows: Row[] = [];
    const prices: PriceObservation[] = [];
    let day = "2023-01-01";
    for (let i = 0; i < 50; i++) {
      rows.push(deposit(day, String(500 + i * 10)));
      rows.push(buy(day, "4", String(100 + (i % 7) * 3)));
      day = addDays(day, 21);
    }
    for (let d = "2023-01-01", i = 0; d <= "2025-12-31"; d = addDays(d, 1), i++) {
      prices.push(provider(d, String(100 + ((i * 37) % 41) - 20 + i / 50)));
    }
    const started = performance.now();
    const { performance: result } = evaluate(rows, prices, "2023-01-01", "2025-12-31");
    const elapsed = performance.now() - started;
    expect(result.ttwror).not.toBeNull();
    expect(result.xirr).not.toBeNull();
    expectIdentity(result);
    expect(elapsed).toBeLessThan(5000);
  });

  it("is zero with null returns for an empty Period", () => {
    const start: ValuationPoint = { date: "2026-01-31", value: "10", positionsValue: "0", cash: "10", investedCapital: "0" };
    expect(periodPerformance([], start, [], NONE)).toMatchObject({ gain: "0", ttwror: null, xirr: null });
  });
});

describe("ttwror", () => {
  const point = (date: string, value: string): ValuationPoint => ({ date, value, positionsValue: value, cash: "0", investedCapital: "0" });

  it("counts an inflow at the start of its day", () => {
    // Day 2: 100 + 100 deposited → 220: +10 %.
    expect(ttwror(point("2026-01-01", "100"), [point("2026-01-02", "220")], [deposit("2026-01-02", "100")])).toBe("0.1");
  });

  it("counts an outflow (Withdrawal, tax paid) at the end of its day", () => {
    // Day 2: 100 → 110 before 60 withdrawn and 5 tax paid on a dividend: (45 + 65) / 100.
    const rows = [withdrawal("2026-01-02", "60"), row("DIVIDEND", "2026-01-02", { securityId: "s1", amount: "0", tax: "5" })];
    expect(ttwror(point("2026-01-01", "100"), [point("2026-01-02", "45")], rows)).toBe("0.1");
  });

  it("measures a liquidation on a down day against the full prior value", () => {
    // V(p) 1000 in Positions; on d SELL for 990 and WITHDRAWAL 990 → V(d) 0: factor 990 / 1000.
    const rows = [sell("2026-01-02", "10", "99"), withdrawal("2026-01-02", "990")];
    expect(ttwror(point("2026-01-01", "1000"), [point("2026-01-02", "0"), point("2026-01-03", "0")], rows)).toBe("-0.01");
  });

  it("keeps the gain of a liquidation on an up day", () => {
    const rows = [sell("2026-01-02", "10", "101"), withdrawal("2026-01-02", "1010")];
    expect(ttwror(point("2026-01-01", "1000"), [point("2026-01-02", "0")], rows)).toBe("0.01");
  });

  it("counts a full Withdrawal day as its price move only and skips the empty days after it", () => {
    const rows = [withdrawal("2026-01-02", "1050")];
    expect(ttwror(point("2026-01-01", "1000"), [point("2026-01-02", "0"), point("2026-01-03", "0")], rows)).toBe("0.05");
  });

  it("skips an overdrawn day without flipping the chain's sign", () => {
    // Day 2: a FEE larger than the Depot value → V(d) −5; day 3: back to 10 after a Deposit of 15.
    const rows = [row("FEE", "2026-01-02", { fee: "15" }), deposit("2026-01-03", "15")];
    const result = ttwror(point("2026-01-01", "10"), [point("2026-01-02", "-5"), point("2026-01-03", "10")], rows);
    // Day 2 skipped (numerator < 0); day 3: 10 / (−5 + 15) = 1.
    expect(result).toBe("0");
  });

  it("is null when no day had anything invested", () => {
    expect(ttwror(point("2026-01-01", "0"), [point("2026-01-02", "0")], [])).toBeNull();
  });
});

describe("xirr", () => {
  it("solves a one-year doubling and a multi-year schedule", () => {
    expectClose(xirr([{ date: "2021-01-01", amount: "-100" }, { date: "2022-01-01", amount: "200" }]), "1");
    expectClose(
      xirr([
        { date: "2021-01-01", amount: "-1000" },
        { date: "2022-01-01", amount: "-1100" },
        { date: "2023-01-01", amount: "2420" },
      ]),
      "0.1",
    );
  });

  it("finds strongly negative rates", () => {
    expectClose(xirr([{ date: "2021-01-01", amount: "-100" }, { date: "2022-01-01", amount: "1" }]), "-0.99");
  });

  it("solves steep annualised rates of 1–2-day Periods beyond 1e7", () => {
    // +5 % in one day: 1.05^365 − 1 ≈ 5.4e7.
    const rate = xirr([{ date: "2026-01-01", amount: "-100" }, { date: "2026-01-02", amount: "105" }]);
    expect(rate).not.toBeNull();
    const grown = new Decimal(1).plus(rate!).pow(new Decimal(1).dividedBy(365));
    expectClose(grown.toFixed(), "1.05");
    expect(new Decimal(rate!).greaterThan("1e7")).toBe(true);
  });

  it("solves steep annualised losses of short Periods", () => {
    // −10 % in one day: 0.9^365 − 1 ≈ −1 + 1.9e-17.
    const rate = xirr([{ date: "2026-01-01", amount: "-100" }, { date: "2026-01-02", amount: "90" }]);
    expect(rate).not.toBeNull();
    // The ratio keeps 20 decimals, so 1 + rate has only a few significant digits left here.
    expect(new Decimal(rate!).greaterThan(-1)).toBe(true);
    expect(new Decimal(rate!).lessThan("-0.9999999999")).toBe(true);
    const Precise = Decimal.clone({ precision: 40 });
    const grown = new Precise(1).plus(rate!).pow(new Precise(1).dividedBy(365));
    expectClose(grown.toFixed(), "0.9", "1e-5");
  });

  it("solves hundreds of flow dates quickly", () => {
    const flows = [];
    let day = "2010-01-01";
    for (let i = 0; i < 600; i++) {
      flows.push({ date: day, amount: i % 5 === 4 ? "12.5" : String(-100 - (i % 13)) });
      day = addDays(day, 9);
    }
    flows.push({ date: day, amount: "90000" });
    const started = performance.now();
    const rate = xirr(flows);
    const elapsed = performance.now() - started;
    expect(rate).not.toBeNull();
    expect(elapsed).toBeLessThan(2000);
  });

  it("returns null without both a positive and a negative flow", () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ date: "2021-01-01", amount: "-100" }, { date: "2022-01-01", amount: "0" }])).toBeNull();
    expect(xirr([{ date: "2021-01-01", amount: "100" }, { date: "2022-01-01", amount: "200" }])).toBeNull();
  });

  it("is order independent and accepts several flows on one date", () => {
    const flows = [
      { date: "2023-06-30", amount: "1300" },
      { date: "2022-01-01", amount: "-500" },
      { date: "2022-01-01", amount: "-500" },
      { date: "2022-09-15", amount: "-200" },
    ];
    const rate = xirr(flows)!;
    const npv = flows.reduce(
      (sum, flow) =>
        sum.plus(new Decimal(flow.amount).dividedBy(new Decimal(1).plus(rate).pow(new Decimal(daysBetween("2022-01-01", flow.date)).dividedBy(365)))),
      new Decimal(0),
    );
    expect(npv.abs().lessThan("1e-9")).toBe(true);
  });
});
