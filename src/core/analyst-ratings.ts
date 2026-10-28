/**
 * Analyst ratings of a stock (story 9.7): the shape stored in the key-figures snapshot (a disposable
 * cache owned by `classification`, never input to any calculation), the consensus mapping, the shares of
 * the Kaufen/Halten/Verkaufen chart and the implied price-target change. Pure: counts are integers,
 * prices decimal strings, dates business dates `YYYY-MM-DD`; every ratio is computed with `decimal.js`.
 */
import { ratioString, ReturnDecimal } from "./returns";

/** Analyst recommendations of one month. */
export type RatingCounts = { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number };

export type TrendPeriod = "0m" | "-1m" | "-2m" | "-3m";

/** Months of the trend, oldest first ("0m" = current month). */
export const TREND_PERIODS: readonly TrendPeriod[] = ["-3m", "-2m", "-1m", "0m"];

/** One up-/downgrade by an analyst firm. */
export type AnalystChange = {
  date: string;
  firm: string;
  fromGrade: string | null;
  toGrade: string;
  action: string | null;
  priceTargetFrom: string | null;
  priceTargetTo: string | null;
};

/** Price targets of the analyst listing, in its quote currency (never converted). */
export type PriceTarget = {
  low: string | null;
  mean: string | null;
  median: string | null;
  high: string | null;
  /** Current price of the SAME listing (the base of the implied change). */
  currentPrice: string | null;
  currency: string | null;
};

/** Analyst data of a stock as stored (`null` = not delivered). */
export type AnalystRatings = {
  /** Up to four months, oldest → current. */
  trend: (RatingCounts & { period: TrendPeriod })[];
  analystCount: number | null;
  /** Provider's recommendation mean (1 = strong buy … 5 = strong sell). */
  consensusMean: string | null;
  target: PriceTarget;
  /** Newest first, at most `MAX_ANALYST_CHANGES`. */
  changes: AnalystChange[];
};

export type AnalystConsensus = "optimistic" | "neutral" | "pessimistic";

/** Number of recent up-/downgrades kept. */
export const MAX_ANALYST_CHANGES = 10;

/** Sum of the five counts. */
export function ratingTotal(counts: RatingCounts): number {
  return counts.strongBuy + counts.buy + counts.hold + counts.sell + counts.strongSell;
}

/** The current month ("0m") of the trend; `null` when not delivered. */
export function currentTrend(ratings: AnalystRatings): (RatingCounts & { period: TrendPeriod }) | null {
  return ratings.trend.find((month) => month.period === "0m") ?? null;
}

/** True when there is something to show: current-month recommendations, a target mean or a consensus mean. */
export function hasAnalystData(ratings: AnalystRatings | null): ratings is AnalystRatings {
  if (ratings === null) return false;
  const current = currentTrend(ratings);
  return (current !== null && ratingTotal(current) > 0) || ratings.target.mean !== null || ratings.consensusMean !== null;
}

/**
 * The consensus mean: the provider's mean, else the count-weighted mean of the current month (strong buy
 * 1 … strong sell 5, four decimal places); `null` without either.
 */
export function consensusMean(ratings: AnalystRatings): string | null {
  if (ratings.consensusMean !== null) return ratings.consensusMean;
  const current = currentTrend(ratings);
  if (current === null) return null;
  const total = ratingTotal(current);
  if (total === 0) return null;
  const weighted = new ReturnDecimal(current.strongBuy)
    .plus(new ReturnDecimal(current.buy).times(2))
    .plus(new ReturnDecimal(current.hold).times(3))
    .plus(new ReturnDecimal(current.sell).times(4))
    .plus(new ReturnDecimal(current.strongSell).times(5));
  return weighted.dividedBy(total).toDecimalPlaces(4, ReturnDecimal.ROUND_HALF_UP).toFixed();
}

/** Mean ≤ 2,0 optimistic, ≤ 3,0 neutral, else pessimistic. */
export function analystConsensus(mean: string): AnalystConsensus {
  const value = new ReturnDecimal(mean);
  if (value.lessThanOrEqualTo(2)) return "optimistic";
  if (value.lessThanOrEqualTo(3)) return "neutral";
  return "pessimistic";
}

/** The consensus of `ratings` (via `consensusMean`); `null` without a mean. */
export function analystConsensusOf(ratings: AnalystRatings): AnalystConsensus | null {
  const mean = consensusMean(ratings);
  return mean === null ? null : analystConsensus(mean);
}

/** Number of analysts: the provider's count, else the current month's total; `null` without either. */
export function analystCountOf(ratings: AnalystRatings): number | null {
  if (ratings.analystCount !== null) return ratings.analystCount;
  const current = currentTrend(ratings);
  return current === null ? null : ratingTotal(current);
}

/** A group's share of the total and the share of its strong part within the group (decimal strings). */
export type GroupShare = { share: string; strongShare: string };
export type RatingShares = { buy: GroupShare; hold: GroupShare; sell: GroupShare };

/**
 * Shares of Kaufen (strong buy + buy), Halten and Verkaufen (sell + strong sell) of the total, summing to
 * exactly 1 (Verkaufen = 1 − Kaufen − Halten); `strongShare` = strong ÷ group total ("0" for an empty
 * group and for Halten). `null` when the total is 0.
 */
export function ratingShares(counts: RatingCounts): RatingShares | null {
  const total = ratingTotal(counts);
  if (total === 0) return null;
  const buyGroup = counts.strongBuy + counts.buy;
  const sellGroup = counts.sell + counts.strongSell;
  const groups = [buyGroup, counts.hold, sellGroup];
  // The last non-empty group takes the remainder, so the rounded shares sum to exactly 1.
  const last = groups.findLastIndex((group) => group > 0);
  let assigned = new ReturnDecimal(0);
  const shares = groups.map((group, index) => {
    if (group === 0) return "0";
    const value = index === last ? new ReturnDecimal(1).minus(assigned) : new ReturnDecimal(ratioString(new ReturnDecimal(group).dividedBy(total)));
    assigned = assigned.plus(value);
    return ratioString(value);
  });
  const strong = (strongPart: number, group: number) => (group === 0 ? "0" : ratioString(new ReturnDecimal(strongPart).dividedBy(group)));
  return {
    buy: { share: shares[0], strongShare: strong(counts.strongBuy, buyGroup) },
    hold: { share: shares[1], strongShare: "0" },
    sell: { share: shares[2], strongShare: strong(counts.strongSell, sellGroup) },
  };
}

/** Implied change of the target mean against the listing's current price (mean ÷ price − 1); `null` without both or a zero price. */
export function targetChange(target: PriceTarget): string | null {
  if (target.mean === null || target.currentPrice === null) return null;
  const price = new ReturnDecimal(target.currentPrice);
  if (price.isZero()) return null;
  return ratioString(new ReturnDecimal(target.mean).dividedBy(price).minus(1));
}
