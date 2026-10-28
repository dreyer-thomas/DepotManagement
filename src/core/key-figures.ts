/**
 * Key figures of a Security (story 9.6): the provider snapshot's shape (a disposable cache owned by the
 * `classification` module, never input to any calculation), its staleness, and the 52-week figures, which
 * are always computed here from the stored, split-adjusted closes — never taken from the provider. Pure:
 * decimal strings and business dates only, "today" is passed in.
 */
import type { CorporateActions } from "./corporate-actions";
import { addDays } from "./dates";
import { canonicalDecimal, ExactDecimal } from "./decimal";
import { compareObservations, type PriceObservation } from "./prices";
import { ratioString, ReturnDecimal } from "./returns";
import { adjustedObservations, currentSecurityId } from "./security";

/** Asset types that get provider key figures (CRYPTO and CERTIFICATE only show the 52-week figures). */
export const KEY_FIGURE_ASSET_TYPES = ["STOCK", "ETF", "FUND"] as const;

/** True when Securities of `assetType` get provider key figures. */
export function hasProviderKeyFigures(assetType: string): boolean {
  return (KEY_FIGURE_ASSET_TYPES as readonly string[]).includes(assetType);
}

/** A snapshot is stale when its fetched business date + this many days lies before today. */
export const KEY_FIGURES_STALE_AFTER_DAYS = 7;

/**
 * Provider key figures as stored (all `null` = not delivered, shown as "–", never 0). Amounts and ratios
 * are plain decimal strings as delivered (ratios like `dividendYield` 0.0118 = 1,18 %; `debtToEquity` is
 * already in percent units, 22.789 = 22,79 %); dates are business dates `YYYY-MM-DD`. Each amount keeps its
 * own currency (revenue is in the financial currency, which can differ from the listing's).
 */
export type ProviderKeyFigures = {
  trailingPE: string | null;
  forwardPE: string | null;
  priceToBook: string | null;
  priceToSales: string | null;
  pegRatio: string | null;
  marketCap: string | null;
  marketCapCurrency: string | null;
  revenue: string | null;
  revenueCurrency: string | null;
  dividendYield: string | null;
  payoutRatio: string | null;
  exDividendDate: string | null;
  profitMargin: string | null;
  returnOnEquity: string | null;
  revenueGrowth: string | null;
  debtToEquity: string | null;
  beta: string | null;
  /** Next earnings date: the earliest delivered on or after the fetch day, else the latest (see `upcomingEarningsDate`). */
  nextEarningsDate: string | null;
  fundFamily: string | null;
  expenseRatio: string | null;
  inceptionDate: string | null;
};

export const PROVIDER_KEY_FIGURE_FIELDS = [
  "trailingPE",
  "forwardPE",
  "priceToBook",
  "priceToSales",
  "pegRatio",
  "marketCap",
  "marketCapCurrency",
  "revenue",
  "revenueCurrency",
  "dividendYield",
  "payoutRatio",
  "exDividendDate",
  "profitMargin",
  "returnOnEquity",
  "revenueGrowth",
  "debtToEquity",
  "beta",
  "nextEarningsDate",
  "fundFamily",
  "expenseRatio",
  "inceptionDate",
] as const satisfies readonly (keyof ProviderKeyFigures)[];

/** A snapshot without any figure (Yahoo's "no data" answer). */
export function emptyKeyFigures(): ProviderKeyFigures {
  return Object.fromEntries(PROVIDER_KEY_FIGURE_FIELDS.map((field) => [field, null])) as ProviderKeyFigures;
}

/** True when the snapshot fetched on business date `fetchedDate` is older than 7 days on `today`. */
export function isKeyFiguresStale(fetchedDate: string, today: string): boolean {
  return addDays(fetchedDate, KEY_FIGURES_STALE_AFTER_DAYS) < today;
}

/** The next earnings date when it is on or after `today`; `null` otherwise. */
export function upcomingEarningsDate(date: string | null, today: string): string | null {
  return date !== null && date >= today ? date : null;
}

/** A close with its date. */
export type DatedClose = { price: string; date: string };

/** The 52-week figures on closing-price basis (never stored). Ratios as plain decimal strings. */
export type FiftyTwoWeekFigures = {
  /** Highest close in the window (tie → later date). */
  high: DatedClose | null;
  /** Lowest close in the window (tie → later date). */
  low: DatedClose | null;
  /** Latest close ÷ high − 1. */
  distanceToHigh: string | null;
  /** Latest close ÷ last close on or before the window start − 1; `null` with less than 52 weeks of closes. */
  performance: string | null;
};

export const NO_FIFTY_TWO_WEEK_FIGURES: FiftyTwoWeekFigures = { high: null, low: null, distanceToHigh: null, performance: null };

/** Days back from today to the window start (`today − 364` .. `today` = 52 weeks + 1 day of closes). */
const WINDOW_DAYS = 364;

/**
 * The 52-week figures of `securityId` as of `today`: stored closes only (provider/manual Prices, never
 * Transaction prices), carried to the Security it maps to today and its units as of today (a split is
 * never a drop); one close per date (the resolver winner, as `securityMovingAverage`). Window =
 * `today − 364 .. today`. All `null` without a close in the window.
 */
export function fiftyTwoWeekFigures(
  observations: readonly PriceObservation[],
  securityId: string,
  actions: CorporateActions,
  today: string,
): FiftyTwoWeekFigures {
  const target = currentSecurityId(securityId, actions, today);
  const own = adjustedObservations(
    observations.filter((observation) => observation.source !== "transaction"),
    actions,
    today,
  )
    .filter((observation) => observation.securityId === target && observation.date <= today)
    .sort(compareObservations);
  const closes: DatedClose[] = [];
  for (const observation of own) {
    const last = closes[closes.length - 1];
    if (last && last.date === observation.date) last.price = observation.price;
    else closes.push({ date: observation.date, price: observation.price });
  }

  const start = addDays(today, -WINDOW_DAYS);
  let base: DatedClose | null = null;
  let high: DatedClose | null = null;
  let low: DatedClose | null = null;
  let latest: DatedClose | null = null;
  for (const close of closes) {
    if (close.date <= start) base = close;
    if (close.date < start) continue;
    const price = new ExactDecimal(close.price);
    if (high === null || price.greaterThanOrEqualTo(high.price)) high = close;
    if (low === null || price.lessThanOrEqualTo(low.price)) low = close;
    latest = close;
  }
  if (high === null || low === null || latest === null) return NO_FIFTY_TWO_WEEK_FIGURES;

  const ratio = (from: string): string | null => {
    const divisor = new ReturnDecimal(from);
    return divisor.isZero() ? null : ratioString(new ReturnDecimal(latest.price).dividedBy(divisor).minus(1));
  };
  return {
    high: { price: canonicalDecimal(high.price), date: high.date },
    low: { price: canonicalDecimal(low.price), date: low.date },
    distanceToHigh: ratio(high.price),
    performance: base === null ? null : ratio(base.price),
  };
}
