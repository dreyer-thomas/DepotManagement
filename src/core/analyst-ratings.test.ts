import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  analystConsensus,
  analystConsensusOf,
  analystCountOf,
  type AnalystRatings,
  consensusMean,
  hasAnalystData,
  type PriceTarget,
  ratingShares,
  targetChange,
} from "./analyst-ratings";

const NO_TARGET: PriceTarget = { low: null, mean: null, median: null, high: null, currentPrice: null, currency: null };

function ratings(overrides: Partial<AnalystRatings> = {}): AnalystRatings {
  return { trend: [], analystCount: null, consensusMean: null, target: NO_TARGET, changes: [], ...overrides };
}

const current = (strongBuy: number, buy: number, hold: number, sell: number, strongSell: number) => ({
  period: "0m" as const,
  strongBuy,
  buy,
  hold,
  sell,
  strongSell,
});

describe("analystConsensus", () => {
  it("maps the mean at the boundaries", () => {
    expect(analystConsensus("1")).toBe("optimistic");
    expect(analystConsensus("2.0")).toBe("optimistic");
    expect(analystConsensus("2.0001")).toBe("neutral");
    expect(analystConsensus("3.0")).toBe("neutral");
    expect(analystConsensus("3.01")).toBe("pessimistic");
    expect(analystConsensus("5")).toBe("pessimistic");
  });
});

describe("consensusMean", () => {
  it("prefers the provider mean", () => {
    expect(consensusMean(ratings({ consensusMean: "1.9", trend: [current(0, 0, 0, 0, 10)] }))).toBe("1.9");
  });

  it("falls back to the count-weighted mean of the current month (4 dp)", () => {
    // (11·1 + 20·2 + 14·3 + 3·4 + 1·5) / 49 = 110 / 49 = 2.244897…
    const value = ratings({ trend: [{ ...current(0, 0, 0, 0, 0), period: "-1m" }, current(11, 20, 14, 3, 1)] });
    expect(consensusMean(value)).toBe("2.2449");
    expect(analystConsensusOf(value)).toBe("neutral");
  });

  it("is null without a mean and with a zero or missing current month", () => {
    expect(consensusMean(ratings())).toBeNull();
    expect(consensusMean(ratings({ trend: [current(0, 0, 0, 0, 0)] }))).toBeNull();
    expect(analystConsensusOf(ratings())).toBeNull();
  });
});

describe("hasAnalystData", () => {
  it("needs current-month counts, a target mean or a consensus mean", () => {
    expect(hasAnalystData(null)).toBe(false);
    expect(hasAnalystData(ratings())).toBe(false);
    expect(hasAnalystData(ratings({ trend: [current(0, 0, 0, 0, 0)] }))).toBe(false);
    expect(hasAnalystData(ratings({ trend: [{ ...current(0, 3, 0, 0, 0), period: "-1m" }] }))).toBe(false);
    expect(hasAnalystData(ratings({ trend: [current(0, 1, 0, 0, 0)] }))).toBe(true);
    expect(hasAnalystData(ratings({ target: { ...NO_TARGET, mean: "270" } }))).toBe(true);
    expect(hasAnalystData(ratings({ consensusMean: "2.1" }))).toBe(true);
  });
});

describe("analystCountOf", () => {
  it("is the provider count, else the current month's total", () => {
    expect(analystCountOf(ratings({ analystCount: 51, trend: [current(11, 20, 14, 3, 1)] }))).toBe(51);
    expect(analystCountOf(ratings({ trend: [current(11, 20, 14, 3, 1)] }))).toBe(49);
    expect(analystCountOf(ratings())).toBeNull();
  });
});

describe("ratingShares", () => {
  const sum = (shares: NonNullable<ReturnType<typeof ratingShares>>) =>
    new Decimal(shares.buy.share).plus(shares.hold.share).plus(shares.sell.share).toFixed();

  it("shares of the total and strong shares within each group, summing to 1", () => {
    const shares = ratingShares(current(11, 20, 14, 3, 1))!;
    expect(new Decimal(shares.buy.share).toDecimalPlaces(6).toFixed()).toBe("0.632653"); // 31 / 49
    expect(new Decimal(shares.hold.share).toDecimalPlaces(6).toFixed()).toBe("0.285714"); // 14 / 49
    expect(new Decimal(shares.sell.share).toDecimalPlaces(6).toFixed()).toBe("0.081633"); // 4 / 49
    expect(new Decimal(shares.buy.strongShare).toDecimalPlaces(6).toFixed()).toBe("0.354839"); // 11 / 31
    expect(shares.sell.strongShare).toBe("0.25");
    expect(shares.hold.strongShare).toBe("0");
    expect(sum(shares)).toBe("1");
  });

  it("sums to 1 with repeating fractions and empty groups", () => {
    expect(sum(ratingShares(current(1, 0, 1, 0, 1))!)).toBe("1");
    const noSell = ratingShares(current(0, 1, 2, 0, 0))!;
    expect(sum(noSell)).toBe("1");
    expect(noSell.sell).toEqual({ share: "0", strongShare: "0" });
  });

  it("strong counts zero: strong share 0", () => {
    expect(ratingShares(current(0, 20, 0, 0, 0))).toEqual({
      buy: { share: "1", strongShare: "0" },
      hold: { share: "0", strongShare: "0" },
      sell: { share: "0", strongShare: "0" },
    });
  });

  it("is null for a zero total", () => {
    expect(ratingShares(current(0, 0, 0, 0, 0))).toBeNull();
  });
});

describe("targetChange", () => {
  it("is mean ÷ current price − 1", () => {
    expect(targetChange({ ...NO_TARGET, mean: "270", currentPrice: "240" })).toBe("0.125");
    expect(targetChange({ ...NO_TARGET, mean: "200", currentPrice: "250" })).toBe("-0.2");
  });

  it("is null without a mean, without a price or with a zero price", () => {
    expect(targetChange({ ...NO_TARGET, mean: "270" })).toBeNull();
    expect(targetChange({ ...NO_TARGET, currentPrice: "240" })).toBeNull();
    expect(targetChange({ ...NO_TARGET, mean: "270", currentPrice: "0" })).toBeNull();
  });
});
