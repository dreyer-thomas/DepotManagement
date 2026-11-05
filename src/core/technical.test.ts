import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS } from "./corporate-actions";
import { addDays } from "./dates";
import { type DatedClose, tradingDayCloses } from "./key-figures";
import type { PriceObservation } from "./prices";
import { TECHNICAL_PARAMETERS, type TechnicalPosition, technicalPosition } from "./technical";

const START = "2026-01-01";

/** Closes on consecutive calendar days from `start` (dates do not matter to the indicators). */
function closes(prices: readonly (string | number)[], start = START): DatedClose[] {
  return prices.map((price, i) => ({ date: addDays(start, i), price: String(price) }));
}

/** The date of the last of `count` consecutive closes from START. */
function lastDay(count: number): string {
  return addDays(START, count - 1);
}

/** Closes from cumulative changes starting at `base`. */
function fromChanges(changes: readonly number[], base = 100): DatedClose[] {
  const prices = [base];
  for (const change of changes) prices.push(prices[prices.length - 1] + change);
  return closes(prices.map((price) => price.toFixed(4)));
}

/** A varied series of `count` closes (deterministic). */
function varied(count: number): string[] {
  return Array.from({ length: count }, (_, i) => (100 + 10 * Math.sin(i / 7) + i / 10).toFixed(2));
}

function position(series: readonly DatedClose[], today = series.length > 0 ? series[series.length - 1].date : START) {
  return technicalPosition(series, today);
}

/** The position without dates, for comparing series that differ only in their dates. */
function undated(result: TechnicalPosition): unknown {
  return JSON.parse(JSON.stringify(result, (key, value: unknown) => (key === "date" ? undefined : value)));
}

const INSUFFICIENT = { value: null, reason: "insufficient-history" };

describe("technicalPosition", () => {
  it("has one parameter table with the AD-23 minimums", () => {
    expect(TECHNICAL_PARAMETERS.trend.minCloses).toBe(220);
    expect(TECHNICAL_PARAMETERS.rsi.minCloses).toBe(15);
    expect(TECHNICAL_PARAMETERS.macd.minCloses).toBe(35);
    expect(TECHNICAL_PARAMETERS.tsi.minCloses).toBe(45);
    expect(TECHNICAL_PARAMETERS.fiftyTwoWeeks.windowDays).toBe(364);
  });

  it("returns exactly the five signals and the series, no combined verdict", () => {
    for (const count of [0, 20, 300]) {
      expect(Object.keys(position(closes(varied(count)))).sort()).toEqual(["fiftyTwoWeeks", "macd", "rsi", "series", "trend", "tsi"]);
    }
  });

  it("no closes: every signal insufficient-history, empty series", () => {
    expect(technicalPosition([], "2026-10-28")).toEqual({
      trend: INSUFFICIENT,
      rsi: INSUFFICIENT,
      macd: INSUFFICIENT,
      tsi: INSUFFICIENT,
      fiftyTwoWeeks: INSUFFICIENT,
      series: [],
    });
  });

  it("last close more than 364 days before today: only 52 Wochen is insufficient-history", () => {
    const series = closes(varied(60), "2025-01-01");
    const result = technicalPosition(series, "2026-10-28");
    expect(result.fiftyTwoWeeks).toEqual(INSUFFICIENT);
    expect(result.rsi.value).not.toBeNull();
    expect(result.macd.value).not.toBeNull();
    expect(result.tsi.value).not.toBeNull();
    // Exactly 364 days back is still in the window.
    expect(technicalPosition(series, addDays(series[59].date, 364)).fiftyTwoWeeks.value).not.toBeNull();
  });

  it.each([
    ["trend", 220],
    ["rsi", 15],
    ["macd", 35],
    ["tsi", 45],
  ] as const)("%s flips from insufficient-history to a value exactly at %i closes", (signal, minimum) => {
    const prices = varied(minimum);
    expect(position(closes(prices.slice(0, minimum - 1)))[signal]).toEqual(INSUFFICIENT);
    const result = position(closes(prices))[signal];
    expect(result.value).toEqual(expect.any(String));
    expect(result).toMatchObject({ date: lastDay(minimum) });
  });

  it("series: one entry per close, values null before they are available", () => {
    const result = position(closes(varied(50)));
    expect(result.series).toHaveLength(50);
    const firstIndex = (field: keyof (typeof result.series)[number]) => result.series.findIndex((point) => point[field] !== null);
    expect(firstIndex("rsi")).toBe(14);
    expect(firstIndex("macd")).toBe(25);
    expect(firstIndex("macdSignal")).toBe(33);
    expect(firstIndex("macdHistogram")).toBe(33);
    expect(firstIndex("tsi")).toBe(37);
    expect(firstIndex("tsiSignal")).toBe(43);
    expect(result.series[49].date).toBe(lastDay(50));
  });

  it("ignores closes after today", () => {
    const series = closes(varied(60));
    const today = series[49].date;
    expect(technicalPosition(series, today)).toEqual(technicalPosition(series.slice(0, 50), today));
  });

  it("flat series: RSI 50 neutral, TSI 0 fading, trend 0 sideways, MACD 0 negative, near-high", () => {
    const result = position(closes(Array(230).fill("100")));
    expect(result.rsi).toMatchObject({ value: "50", key: "neutral", label: "neutral" });
    expect(result.tsi).toMatchObject({ value: "0", signal: "0", key: "fading", label: "Schwung lässt nach" });
    expect(result.trend).toMatchObject({ value: "0", sma200: "100", key: "sideways", label: "Seitwärts" });
    expect(result.macd).toMatchObject({ value: "0", signal: "0", histogram: "0", key: "negative", label: "negativ" });
    expect(result.fiftyTwoWeeks).toMatchObject({ value: "0", key: "near-high", label: "nahe Hoch" });
  });

  it("classifies on the returned 20-decimal values: a difference that rounds to 0 is a tie", () => {
    // A last move of 1e-30: raw MACD is above its signal and the raw SMA200 rises, but both round to 0.
    const tiny = "100.000000000000000000000000000001";
    const macd = position(closes([...Array(39).fill("100"), tiny])).macd;
    expect(macd).toMatchObject({ value: "0", signal: "0", histogram: "0", key: "negative" });
    const trend = position(closes([...Array(219).fill("100"), tiny])).trend;
    expect(trend).toMatchObject({ value: "0", sma200: "100", key: "sideways" });
  });

  describe("trend", () => {
    const rising = Array.from({ length: 220 }, (_, i) => i + 1);

    it("up: close above a rising SMA200; value = close ÷ SMA200 − 1", () => {
      const result = position(closes(rising));
      // SMA200 = mean(21..220) = 120.5
      expect(result.trend).toMatchObject({ key: "up", label: "Aufwärtstrend", sma200: "120.5", date: lastDay(220) });
      expect(Number(result.trend.value)).toBeCloseTo(220 / 120.5 - 1, 12);
    });

    it("down: close below a falling SMA200", () => {
      expect(position(closes([...rising].reverse())).trend).toMatchObject({ key: "down", label: "Abwärtstrend" });
    });

    it("sideways: close above a falling SMA200, or below a rising one", () => {
      const falling = Array.from({ length: 219 }, (_, i) => 300 - i);
      expect(position(closes([...falling, 300])).trend).toMatchObject({ key: "sideways" });
      expect(position(closes([...rising.slice(0, 219), 1])).trend).toMatchObject({ key: "sideways" });
    });

    it("slope compares SMA200 with the value exactly 20 closes earlier", () => {
      // 221 closes, last 101: SMA200 now covers closes 21..220, 20 closes earlier 1..200, 21 earlier 0..199.
      const prices = Array(221).fill(100);
      prices[220] = 101;
      prices[1] = 200; // raises SMA200 20 closes earlier above today's → falling → sideways
      expect(position(closes(prices)).trend).toMatchObject({ key: "sideways" });
      prices[1] = 100;
      prices[0] = 200; // only 21 closes back: not compared → rising → up
      expect(position(closes(prices)).trend).toMatchObject({ key: "up" });
    });
  });

  describe("RSI thresholds", () => {
    const zeros = Array(12).fill(0);
    it.each([
      [[7, -3], "70", "overbought", "überkauft"],
      [[7, -3.1], null, "neutral", "neutral"],
      [[3, -7], "30", "oversold", "überverkauft"],
      [[3.1, -7], null, "neutral", "neutral"],
      [[1, 1], "100", "overbought", "überkauft"],
    ] as const)("changes %j → %s %s", (changes, value, key, label) => {
      const result = position(fromChanges([...changes, ...zeros])).rsi;
      expect(result).toMatchObject({ key, label });
      if (value !== null) expect(result.value).toBe(value);
    });

    it("Wilder smoothing after the first 14 changes", () => {
      // First 14 changes: 7 × +1, 7 × −1 → avg gain = avg loss = 0.5; then +2 → gain (0.5·13 + 2)/14, loss 0.5·13/14.
      const changes = [...Array(7).fill(1), ...Array(7).fill(-1), 2];
      const result = position(fromChanges(changes)).rsi;
      expect(Number(result.value)).toBeCloseTo(100 - 100 / (1 + 8.5 / 6.5), 12);
    });
  });

  describe("MACD", () => {
    /** 60 flat closes at 100, then a step to `to` at index `stepAt` (and an optional second step). */
    function stepped(stepAt: number, to: number, second?: { at: number; to: number }): DatedClose[] {
      return closes(Array.from({ length: 60 }, (_, i) => (second && i >= second.at ? second.to : i >= stepAt ? to : 100)));
    }

    it("up cross within the last 5 closes → positiv, dreht nach oben; 6 closes back → positiv", () => {
      expect(position(stepped(55, 101)).macd).toMatchObject({ key: "positive-turning-up", label: "positiv, dreht nach oben" });
      expect(position(stepped(54, 101)).macd).toMatchObject({ key: "positive", label: "positiv" });
    });

    it("down cross within the last 5 closes → negativ, dreht nach unten; 6 closes back → negativ", () => {
      // Up first (MACD above its signal), then down: the down cross is at the second step.
      expect(position(stepped(50, 101, { at: 55, to: 95 })).macd).toMatchObject({ key: "negative-turning-down", label: "negativ, dreht nach unten" });
      expect(position(stepped(49, 101, { at: 54, to: 95 })).macd).toMatchObject({ key: "negative", label: "negativ" });
      // A step down from a flat series is no cross (equal is not above, before and after).
      expect(position(stepped(55, 99)).macd).toMatchObject({ key: "negative" });
    });

    it("both crosses in the last 5 closes: only the most recent counts", () => {
      const result = position(stepped(55, 101, { at: 57, to: 90 })).macd;
      expect(result).toMatchObject({ key: "negative-turning-down" });
    });

    it("histogram = MACD − signal; MACD equal to the signal is not above", () => {
      const result = position(stepped(55, 101)).macd;
      if (result.value === null) throw new Error("macd missing");
      expect(Number(result.histogram)).toBeCloseTo(Number(result.value) - Number(result.signal), 15);
      expect(position(closes(Array(40).fill(100))).macd).toMatchObject({ key: "negative" });
    });
  });

  describe("TSI", () => {
    it("TSI = signal ≥ 0 is not above → Schwung lässt nach; TSI = signal < 0 → Schwung negativ", () => {
      expect(position(fromChanges(Array(50).fill(1))).tsi).toMatchObject({ value: "100", signal: "100", key: "fading" });
      expect(position(fromChanges(Array(50).fill(-1))).tsi).toMatchObject({ value: "-100", signal: "-100", key: "negative" });
    });

    it("rising above the signal while positive → Schwung positiv; falling below while positive → Schwung lässt nach", () => {
      const choppy = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 2 : -1));
      const up = position(fromChanges([...choppy, 3, 3])).tsi;
      expect(up).toMatchObject({ key: "positive", label: "Schwung positiv" });
      const fading = position(fromChanges([...Array(50).fill(1), -1])).tsi;
      expect(fading).toMatchObject({ key: "fading", label: "Schwung lässt nach" });
      if (fading.value === null) throw new Error("tsi missing");
      expect(Number(fading.value)).toBeGreaterThan(0);
      expect(Number(fading.value)).toBeLessThan(Number(fading.signal));
    });

    it("rising above the signal while negative → Schwung dreht; falling while negative → Schwung negativ", () => {
      const turning = position(fromChanges([...Array(50).fill(-1), 1])).tsi;
      expect(turning).toMatchObject({ key: "turning", label: "Schwung dreht" });
      if (turning.value === null) throw new Error("tsi missing");
      expect(Number(turning.value)).toBeLessThan(0);
      expect(Number(turning.value)).toBeGreaterThan(Number(turning.signal));
      const choppy = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? -2 : 1));
      expect(position(fromChanges([...choppy, -3, -3])).tsi).toMatchObject({ key: "negative", label: "Schwung negativ" });
    });
  });

  describe("52 Wochen", () => {
    it.each([
      [["100", "60", "95"], "near-high", "nahe Hoch"],
      [["100", "60", "94.99"], "between", "dazwischen"],
      [["100", "60", "63"], "near-low", "nahe Tief"],
      [["100", "60", "63.01"], "between", "dazwischen"],
      [["100", "96", "96"], "near-high", "nahe Hoch"], // within 5 % of both: near-high wins
    ] as const)("%j → %s", (prices, key, label) => {
      const result = position(closes(prices)).fiftyTwoWeeks;
      expect(result).toMatchObject({ key, label, high: { price: "100", date: START }, date: lastDay(3) });
    });

    it("reuses the 52-week figures (value = distance to high, high and low with dates)", () => {
      expect(position(closes(["100", "60", "95"])).fiftyTwoWeeks).toEqual({
        value: "-0.05",
        date: lastDay(3),
        key: "near-high",
        label: "nahe Hoch",
        high: { price: "100", date: START },
        low: { price: "60", date: addDays(START, 1) },
      });
    });
  });

  describe("with tradingDayCloses", () => {
    const TODAY = "2026-12-31";
    function provider(date: string, price: string): PriceObservation {
      return { id: `p-${date}`, securityId: "s1", date, sequence: 0, price, source: "provider" };
    }
    /** Business days (Mon–Fri) from Monday 2026-01-05: weekends are gaps. */
    function businessDays(count: number): string[] {
      const days: string[] = [];
      for (let offset = 0; days.length < count; offset++) if (offset % 7 < 5) days.push(addDays("2026-01-05", offset));
      return days;
    }

    it("gaps, a transaction price and two observations on one date: same signals as the gapless series", () => {
      const prices = varied(240);
      const days = businessDays(240);
      const observations: PriceObservation[] = days.map((day, i) => provider(day, prices[i]));
      observations.push({ id: "t", securityId: "s1", date: "2026-01-10", sequence: 1, price: "999", source: "transaction" });
      observations.push({ id: "m", securityId: "s1", date: days[100], sequence: 0, price: "1", source: "manual" });
      const series = tradingDayCloses(observations, "s1", NO_CORPORATE_ACTIONS, TODAY);
      expect(series.map((close) => close.date)).toEqual(days);
      expect(undated(technicalPosition(series, TODAY))).toEqual(undated(technicalPosition(closes(prices), lastDay(240))));
    });

    it("split inside the window: adjusted closes give the signals of the unsplit series (no fake drop)", () => {
      const prices = varied(240);
      const days = businessDays(240);
      const splitDate = days[200];
      const actions: CorporateActions = { splits: [{ securityId: "s1", date: splitDate, ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
      const observations = days.map((day, i) => provider(day, day < splitDate ? String(Number(prices[i]) * 2) : prices[i]));
      const series = tradingDayCloses(observations, "s1", actions, TODAY);
      const unsplit = days.map((day, i) => ({ date: day, price: prices[i] }));
      expect(technicalPosition(series, TODAY)).toEqual(technicalPosition(unsplit, TODAY));
    });
  });
});
