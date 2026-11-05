/**
 * Technical position of a Security (story 11.2, AD-23): trend against SMA200, RSI, MACD, TSI and the
 * 52-week position, each with a fixed German interpretation, plus the daily indicator series for the chart.
 * Computed on read from trading-day closes (`tradingDayCloses`: stored, split-adjusted, one per date);
 * indicators are index-based over the closes given, so missing dates never create values. Never a combined
 * verdict. Pure: `decimal.js` only, values as decimal strings rounded to 20 decimal places, "today" passed in.
 */
import { type DatedClose, FIFTY_TWO_WEEK_WINDOW_DAYS, fiftyTwoWeekFromCloses } from "./key-figures";
import { ratioString, ReturnDecimal, type ReturnValue } from "./returns";

/** Every parameter, minimum and threshold of the technical signals. */
export const TECHNICAL_PARAMETERS = {
  trend: {
    /** Closes in the simple moving average. */
    smaWindow: 200,
    /** The slope compares SMA200 now with SMA200 this many closes earlier. */
    slopeLookback: 20,
    /** smaWindow + slopeLookback. */
    minCloses: 220,
  },
  rsi: {
    /** Wilder period (first average = SMA of the first 14 gains/losses, then `(prev·13 + x)/14`). */
    period: 14,
    /** "überkauft" at RSI ≥ this. */
    overbought: "70",
    /** "überverkauft" at RSI ≤ this. */
    oversold: "30",
    /** period + 1. */
    minCloses: 15,
  },
  macd: {
    fast: 12,
    slow: 26,
    signal: 9,
    /** A cross among the last this many closes adds "dreht nach oben/unten". */
    crossLookback: 5,
    /** First signal value at close 34 (26 + 9 − 1); the 35th gives one prior point for cross detection. */
    minCloses: 35,
  },
  tsi: {
    /** First smoothing of the momentum (close − previous close). */
    long: 25,
    /** Second smoothing. */
    short: 13,
    signal: 7,
    /** TSI = scale · double-smoothed momentum ÷ double-smoothed absolute momentum. */
    scale: 100,
    /** First signal value at close 44 (1 + 25 + 13 + 7 − 2); 45 like MACD. */
    minCloses: 45,
  },
  fiftyTwoWeeks: {
    /** Window `today − 364 .. today` (the 52-week figures of story 9.6). */
    windowDays: FIFTY_TWO_WEEK_WINDOW_DAYS,
    /** "nahe Hoch" when close ≥ high · (1 − band); "nahe Tief" when close ≤ low · (1 + band). */
    nearBand: "0.05",
  },
} as const;

export type TrendKey = "up" | "down" | "sideways";
export type RsiKey = "overbought" | "oversold" | "neutral";
export type MacdKey = "positive" | "positive-turning-up" | "negative" | "negative-turning-down";
export type TsiKey = "positive" | "fading" | "negative" | "turning";
export type FiftyTwoWeeksKey = "near-high" | "near-low" | "between";

export const TREND_LABELS: Record<TrendKey, string> = { up: "Aufwärtstrend", down: "Abwärtstrend", sideways: "Seitwärts" };
export const RSI_LABELS: Record<RsiKey, string> = { overbought: "überkauft", oversold: "überverkauft", neutral: "neutral" };
export const MACD_LABELS: Record<MacdKey, string> = {
  positive: "positiv",
  "positive-turning-up": "positiv, dreht nach oben",
  negative: "negativ",
  "negative-turning-down": "negativ, dreht nach unten",
};
export const TSI_LABELS: Record<TsiKey, string> = {
  positive: "Schwung positiv",
  fading: "Schwung lässt nach",
  negative: "Schwung negativ",
  turning: "Schwung dreht",
};
export const FIFTY_TWO_WEEKS_LABELS: Record<FiftyTwoWeeksKey, string> = {
  "near-high": "nahe Hoch",
  "near-low": "nahe Tief",
  between: "dazwischen",
};

/** A signal without enough closes. */
export type InsufficientHistory = { value: null; reason: "insufficient-history" };

/** A signal: value (decimal string), last close date, interpretation key and German label, plus details. */
export type TechnicalSignal<K extends string, D> = ({ value: string; date: string; key: K; label: string } & D) | InsufficientHistory;

export type TrendSignal = TechnicalSignal<TrendKey, { sma200: string }>;
export type RsiSignal = TechnicalSignal<RsiKey, object>;
export type MacdSignal = TechnicalSignal<MacdKey, { signal: string; histogram: string }>;
export type TsiSignal = TechnicalSignal<TsiKey, { signal: string }>;
export type FiftyTwoWeeksSignal = TechnicalSignal<FiftyTwoWeeksKey, { high: DatedClose; low: DatedClose }>;

/** One close of the indicator series; each value a decimal string or `null` before it is available. */
export type TechnicalSeriesPoint = {
  date: string;
  rsi: string | null;
  macd: string | null;
  macdSignal: string | null;
  macdHistogram: string | null;
  tsi: string | null;
  tsiSignal: string | null;
};

/** The technical position: exactly the five signals and the series — no combined verdict. */
export type TechnicalPosition = {
  trend: TrendSignal;
  rsi: RsiSignal;
  macd: MacdSignal;
  tsi: TsiSignal;
  fiftyTwoWeeks: FiftyTwoWeeksSignal;
  series: TechnicalSeriesPoint[];
};

const INSUFFICIENT: InsufficientHistory = { value: null, reason: "insufficient-history" };

function insufficient(): InsufficientHistory {
  return { ...INSUFFICIENT };
}

type Series = (ReturnValue | null)[];

/** Simple moving average over `period` values ending at each index (`null` before the window is full). */
function sma(values: readonly ReturnValue[], period: number): Series {
  const result: Series = [];
  let sum = new ReturnDecimal(0);
  for (let i = 0; i < values.length; i++) {
    sum = sum.plus(values[i]);
    if (i >= period) sum = sum.minus(values[i - period]);
    result.push(i >= period - 1 ? sum.dividedBy(period) : null);
  }
  return result;
}

/**
 * EMA with k = 2/(n+1), seeded with the SMA of the first `period` available values. `values` is `null`
 * up to some index and available from there on; the result is `null` until the seed.
 */
function ema(values: Series, period: number): Series {
  const k = new ReturnDecimal(2).dividedBy(period + 1);
  const result: Series = [];
  let count = 0;
  let sum = new ReturnDecimal(0);
  let previous: ReturnValue | null = null;
  for (const value of values) {
    if (value === null) {
      result.push(null);
      continue;
    }
    count++;
    if (previous !== null) {
      previous = previous.plus(value.minus(previous).times(k));
    } else {
      sum = sum.plus(value);
      if (count === period) previous = sum.dividedBy(period);
    }
    result.push(previous);
  }
  return result;
}

/** RSI with Wilder smoothing; flat (no gain, no loss) → 50, no loss → 100. */
function rsiSeries(closes: readonly ReturnValue[], period: number): Series {
  const result: Series = closes.map(() => null);
  let averageGain = new ReturnDecimal(0);
  let averageLoss = new ReturnDecimal(0);
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i].minus(closes[i - 1]);
    const gain = change.greaterThan(0) ? change : new ReturnDecimal(0);
    const loss = change.lessThan(0) ? change.negated() : new ReturnDecimal(0);
    if (i <= period) {
      averageGain = averageGain.plus(gain);
      averageLoss = averageLoss.plus(loss);
      if (i < period) continue;
      averageGain = averageGain.dividedBy(period);
      averageLoss = averageLoss.dividedBy(period);
    } else {
      averageGain = averageGain.times(period - 1).plus(gain).dividedBy(period);
      averageLoss = averageLoss.times(period - 1).plus(loss).dividedBy(period);
    }
    if (averageLoss.isZero()) result[i] = new ReturnDecimal(averageGain.isZero() ? 50 : 100);
    else result[i] = new ReturnDecimal(100).minus(new ReturnDecimal(100).dividedBy(averageGain.dividedBy(averageLoss).plus(1)));
  }
  return result;
}

function toString(value: ReturnValue | null): string | null {
  return value === null ? null : ratioString(value);
}

/**
 * The series rounded to the 20 decimal places that are returned. Every interpretation compares these
 * rounded values, so a returned "0" never comes with a key that needs a non-zero value.
 */
function rounded(values: Series): Series {
  return values.map((value) => (value === null ? null : new ReturnDecimal(ratioString(value))));
}

function isAbove(a: ReturnValue | null, b: ReturnValue | null): boolean | null {
  return a === null || b === null ? null : a.greaterThan(b);
}

/**
 * The technical position as of `today` from trading-day closes (ascending by date, one per date; closes
 * after `today` are ignored). A signal without enough closes is `{ value: null, reason: "insufficient-history" }`.
 */
export function technicalPosition(closes: readonly DatedClose[], today: string): TechnicalPosition {
  const own = closes.filter((close) => close.date <= today);
  const prices = own.map((close) => new ReturnDecimal(close.price));
  const n = prices.length;
  const lastDate = n > 0 ? own[n - 1].date : "";
  const { trend: T, rsi: R, macd: M, tsi: S, fiftyTwoWeeks: W } = TECHNICAL_PARAMETERS;

  // RSI
  const rsiValues = rounded(rsiSeries(prices, R.period));

  // MACD
  const pricesSeries: Series = prices;
  const fast = ema(pricesSeries, M.fast);
  const slow = ema(pricesSeries, M.slow);
  const macdLineRaw: Series = prices.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f === null || s === null ? null : f.minus(s);
  });
  const macdSignalRaw = ema(macdLineRaw, M.signal);
  const macdLine = rounded(macdLineRaw);
  const macdSignalLine = rounded(macdSignalRaw);
  // Difference of the rounded lines: exact at 20 decimal places, positive exactly when MACD is above.
  const macdHistogram: Series = macdLine.map((value, i) => {
    const signal = macdSignalLine[i];
    return value === null || signal === null ? null : value.minus(signal);
  });

  // TSI
  const momentum: Series = prices.map((price, i) => (i === 0 ? null : price.minus(prices[i - 1])));
  const absoluteMomentum: Series = momentum.map((value) => (value === null ? null : value.abs()));
  const doubleSmoothed = ema(ema(momentum, S.long), S.short);
  const doubleSmoothedAbsolute = ema(ema(absoluteMomentum, S.long), S.short);
  const tsiLineRaw: Series = doubleSmoothed.map((value, i) => {
    const absolute = doubleSmoothedAbsolute[i];
    if (value === null || absolute === null) return null;
    return absolute.isZero() ? new ReturnDecimal(0) : value.dividedBy(absolute).times(S.scale);
  });
  const tsiSignalLine = rounded(ema(tsiLineRaw, S.signal));
  const tsiLine = rounded(tsiLineRaw);

  const series: TechnicalSeriesPoint[] = own.map((close, i) => ({
    date: close.date,
    rsi: toString(rsiValues[i]),
    macd: toString(macdLine[i]),
    macdSignal: toString(macdSignalLine[i]),
    macdHistogram: toString(macdHistogram[i]),
    tsi: toString(tsiLine[i]),
    tsiSignal: toString(tsiSignalLine[i]),
  }));

  const last = n - 1;

  // Trend
  let trend: TrendSignal = insufficient();
  if (n >= T.minCloses) {
    const averages = sma(prices, T.smaWindow);
    const [now, earlier] = rounded([averages[last], averages[last - T.slopeLookback]]);
    if (now !== null && earlier !== null && !now.isZero()) {
      // Classified on the returned values: the distance's sign and the rounded SMA200s.
      const value = ratioString(prices[last].dividedBy(now).minus(1));
      const distance = new ReturnDecimal(value);
      const key: TrendKey =
        distance.greaterThan(0) && now.greaterThan(earlier) ? "up" : distance.lessThan(0) && now.lessThan(earlier) ? "down" : "sideways";
      trend = { value, date: lastDate, key, label: TREND_LABELS[key], sma200: ratioString(now) };
    }
  }

  // RSI signal
  let rsi: RsiSignal = insufficient();
  const rsiNow = n >= R.minCloses ? rsiValues[last] : null;
  if (rsiNow !== null) {
    // rsiNow is already rounded: an RSI of exactly 70 is not lost to division noise.
    const value = ratioString(rsiNow);
    const key: RsiKey = rsiNow.greaterThanOrEqualTo(R.overbought)
      ? "overbought"
      : rsiNow.lessThanOrEqualTo(R.oversold)
        ? "oversold"
        : "neutral";
    rsi = { value, date: lastDate, key, label: RSI_LABELS[key] };
  }

  // MACD signal
  let macd: MacdSignal = insufficient();
  const macdNow = n >= M.minCloses ? macdLine[last] : null;
  const macdSignalNow = n >= M.minCloses ? macdSignalLine[last] : null;
  if (macdNow !== null && macdSignalNow !== null) {
    const above = macdNow.greaterThan(macdSignalNow);
    // Only the most recent cross counts; it always leads into the current state.
    let crossed = false;
    for (let i = last; i > last - M.crossLookback && i >= 1; i--) {
      const current = isAbove(macdLine[i], macdSignalLine[i]);
      const previous = isAbove(macdLine[i - 1], macdSignalLine[i - 1]);
      if (current !== null && previous !== null && current !== previous) {
        crossed = true;
        break;
      }
    }
    const key: MacdKey = above ? (crossed ? "positive-turning-up" : "positive") : crossed ? "negative-turning-down" : "negative";
    macd = {
      value: ratioString(macdNow),
      date: lastDate,
      key,
      label: MACD_LABELS[key],
      signal: ratioString(macdSignalNow),
      histogram: ratioString(macdNow.minus(macdSignalNow)),
    };
  }

  // TSI signal
  let tsi: TsiSignal = insufficient();
  const tsiNow = n >= S.minCloses ? tsiLine[last] : null;
  const tsiSignalNow = n >= S.minCloses ? tsiSignalLine[last] : null;
  if (tsiNow !== null && tsiSignalNow !== null) {
    const above = tsiNow.greaterThan(tsiSignalNow);
    const key: TsiKey = tsiNow.greaterThanOrEqualTo(0) ? (above ? "positive" : "fading") : above ? "turning" : "negative";
    tsi = { value: ratioString(tsiNow), date: lastDate, key, label: TSI_LABELS[key], signal: ratioString(tsiSignalNow) };
  }

  // 52 Wochen (the 52-week figures of story 9.6)
  let fiftyTwoWeeks: FiftyTwoWeeksSignal = insufficient();
  const figures = fiftyTwoWeekFromCloses(own, today);
  if (figures.high !== null && figures.low !== null && figures.distanceToHigh !== null && n > 0) {
    const close = prices[last];
    const band = new ReturnDecimal(W.nearBand);
    const key: FiftyTwoWeeksKey = close.greaterThanOrEqualTo(new ReturnDecimal(figures.high.price).times(new ReturnDecimal(1).minus(band)))
      ? "near-high"
      : close.lessThanOrEqualTo(new ReturnDecimal(figures.low.price).times(band.plus(1)))
        ? "near-low"
        : "between";
    fiftyTwoWeeks = {
      value: figures.distanceToHigh,
      date: lastDate,
      key,
      label: FIFTY_TWO_WEEKS_LABELS[key],
      high: figures.high,
      low: figures.low,
    };
  }

  return { trend, rsi, macd, tsi, fiftyTwoWeeks, series };
}
