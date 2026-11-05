/**
 * Story 11.2 reference AC: `technicalPosition` against the independent float reference in
 * `test/fixtures/technical/reference.py` (kept outside `src/core`, which may not read test fixtures).
 */
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { technicalPosition, type TechnicalSeriesPoint } from "@/core/technical";
import reference from "../fixtures/technical/reference-series.json";

const TOLERANCE = new Decimal("1e-8");

function expectClose(actual: string | null | undefined, expected: number | null, what: string): void {
  if (expected === null) {
    expect(actual ?? null, what).toBeNull();
    return;
  }
  expect(actual, what).toEqual(expect.any(String));
  const diff = new Decimal(actual as string).minus(expected).abs();
  expect(diff.lessThanOrEqualTo(TOLERANCE), `${what}: ${actual} vs ${expected}`).toBe(true);
}

describe("technicalPosition reference series", () => {
  const position = technicalPosition(reference.closes, reference.today);
  const expected = reference.expected;
  const lastDate = reference.closes[reference.closes.length - 1].date;

  it("uses a series of at least 250 closes", () => {
    expect(reference.closes.length).toBeGreaterThanOrEqual(250);
    expect(position.series).toHaveLength(reference.closes.length);
  });

  it("trend matches the reference", () => {
    const trend = position.trend;
    if (trend.value === null) throw new Error("trend missing");
    expectClose(trend.value, expected.trend.value, "trend");
    expectClose(trend.sma200, expected.trend.sma200, "sma200");
    expect(trend).toMatchObject({ date: lastDate, key: expected.trend.key });
  });

  it("RSI matches the reference", () => {
    const rsi = position.rsi;
    if (rsi.value === null) throw new Error("rsi missing");
    expectClose(rsi.value, expected.rsi.value, "rsi");
    expect(rsi).toMatchObject({ date: lastDate, key: expected.rsi.key });
  });

  it("MACD matches the reference", () => {
    const macd = position.macd;
    if (macd.value === null) throw new Error("macd missing");
    expectClose(macd.value, expected.macd.value, "macd");
    expectClose(macd.signal, expected.macd.signal, "macd signal");
    expectClose(macd.histogram, expected.macd.histogram, "macd histogram");
    expect(macd).toMatchObject({ date: lastDate, key: expected.macd.key });
  });

  it("TSI matches the reference", () => {
    const tsi = position.tsi;
    if (tsi.value === null) throw new Error("tsi missing");
    expectClose(tsi.value, expected.tsi.value, "tsi");
    expectClose(tsi.signal, expected.tsi.signal, "tsi signal");
    expect(tsi).toMatchObject({ date: lastDate, key: expected.tsi.key });
  });

  it("52 Wochen matches the reference", () => {
    const weeks = position.fiftyTwoWeeks;
    if (weeks.value === null) throw new Error("52 weeks missing");
    expectClose(weeks.value, expected.fiftyTwoWeeks.value, "distance to high");
    expect(weeks.high.date).toBe(expected.fiftyTwoWeeks.high.date);
    expect(new Decimal(weeks.high.price).equals(expected.fiftyTwoWeeks.high.price)).toBe(true);
    expect(weeks.low.date).toBe(expected.fiftyTwoWeeks.low.date);
    expect(new Decimal(weeks.low.price).equals(expected.fiftyTwoWeeks.low.price)).toBe(true);
    expect(weeks).toMatchObject({ date: lastDate, key: expected.fiftyTwoWeeks.key });
  });

  it("series matches the reference at every checkpoint", () => {
    const fields = ["rsi", "macd", "macdSignal", "macdHistogram", "tsi", "tsiSignal"] as const;
    for (const checkpoint of reference.checkpoints) {
      const point: TechnicalSeriesPoint = position.series[checkpoint.index];
      expect(point.date).toBe(checkpoint.date);
      for (const field of fields) expectClose(point[field], checkpoint[field], `${field} at ${checkpoint.index}`);
    }
  });
});
