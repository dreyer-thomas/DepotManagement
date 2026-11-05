import { describe, expect, it } from "vitest";
import type { CorporateActions } from "./corporate-actions";
import { type DatedClose, tradingDayCloses } from "./key-figures";
import type { PriceObservation } from "./prices";
import { zigzag, ZIGZAG_THRESHOLDS, DEFAULT_ZIGZAG_THRESHOLD } from "./zigzag";

/** Closes on consecutive days from 2026-01-01. */
function series(...prices: string[]): DatedClose[] {
  return prices.map((price, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, price }));
}

describe("zigzag", () => {
  it("exports the thresholds and the default", () => {
    expect(ZIGZAG_THRESHOLDS).toEqual(["5", "8", "12"]);
    expect(DEFAULT_ZIGZAG_THRESHOLD).toBe("8");
  });

  it("up-down-up at 8 %: low, high, low and the levels of the last swing high 120 → low 100", () => {
    expect(zigzag(series("100", "110", "120", "108", "100", "112", "115"), "8")).toEqual({
      pivots: [
        { date: "2026-01-01", price: "100", kind: "low" },
        { date: "2026-01-03", price: "120", kind: "high" },
        { date: "2026-01-05", price: "100", kind: "low" },
      ],
      retracements: [
        { ratio: "0.382", price: "107.64" },
        { ratio: "0.5", price: "110" },
        { ratio: "0.618", price: "112.36" },
      ],
      extension: { ratio: "1.618", price: "87.64" },
    });
  });

  it("up-swing levels: A = 100, B = 150", () => {
    const result = zigzag(series("150", "100", "150", "130"), "8");
    expect(result.pivots.map((p) => `${p.kind} ${p.price}`)).toEqual(["high 150", "low 100", "high 150"]);
    expect(result.retracements).toEqual([
      { ratio: "0.382", price: "130.9" },
      { ratio: "0.5", price: "125" },
      { ratio: "0.618", price: "119.1" },
    ]);
    expect(result.extension).toEqual({ ratio: "1.618", price: "180.9" });
  });

  it("rounds levels half up to 10 decimal places", () => {
    const result = zigzag(series("10", "13.33333333333", "11"), "8");
    expect(result.pivots.map((p) => p.price)).toEqual(["10", "13.33333333333"]);
    // 13.33333333333 − 0.382 · 3.33333333333 = 12.05999999999794 → 12.06 (10 dp half up)
    expect(result.retracements[0]).toEqual({ ratio: "0.382", price: "12.06" });
    // 13.33333333333 − 0.5 · 3.33333333333 = 11.666666666665 → 11.6666666667
    expect(result.retracements[1]).toEqual({ ratio: "0.5", price: "11.6666666667" });
  });

  it("threshold edge: exactly 8 % confirms the high, 92.01 does not", () => {
    expect(zigzag(series("100", "92"), "8").pivots).toEqual([{ date: "2026-01-01", price: "100", kind: "high" }]);
    expect(zigzag(series("100", "92.01"), "8").pivots).toEqual([]);
    expect(zigzag(series("100", "108"), "8").pivots).toEqual([{ date: "2026-01-01", price: "100", kind: "low" }]);
    expect(zigzag(series("100", "107.99"), "8").pivots).toEqual([]);
  });

  it("flat series and moves below the threshold: no pivots, no levels", () => {
    const none = { pivots: [], retracements: [], extension: null };
    expect(zigzag(series("50", "50", "50", "50"), "5")).toEqual(none);
    expect(zigzag(series("100", "104", "100", "104.5", "101"), "5")).toEqual(none);
    expect(zigzag([], "8")).toEqual(none);
    expect(zigzag(series("100"), "8")).toEqual(none);
  });

  it("one pivot: no levels; the running extreme after it is not a pivot", () => {
    const result = zigzag(series("100", "120", "130", "125"), "8");
    expect(result.pivots).toEqual([{ date: "2026-01-01", price: "100", kind: "low" }]);
    expect(result.retracements).toEqual([]);
    expect(result.extension).toBeNull();
  });

  it("starts with a falling series: the first pivot is a high", () => {
    const result = zigzag(series("100", "95", "90", "85", "95"), "8");
    expect(result.pivots).toEqual([
      { date: "2026-01-01", price: "100", kind: "high" },
      { date: "2026-01-04", price: "85", kind: "low" },
    ]);
    // Last swing A = 100 (high) → B = 85 (low).
    expect(result.retracements.map((l) => l.price)).toEqual(["90.73", "92.5", "94.27"]);
    expect(result.extension).toEqual({ ratio: "1.618", price: "75.73" });
  });

  it("pivots alternate high/low", () => {
    const result = zigzag(series("100", "120", "100", "125", "90", "130", "80"), "5");
    const kinds = result.pivots.map((p) => p.kind);
    expect(kinds).toEqual(["low", "high", "low", "high", "low", "high"]);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i]).not.toBe(kinds[i - 1]);
  });

  it("equal extremes keep the earlier date", () => {
    expect(zigzag(series("100", "120", "120", "100"), "8").pivots).toEqual([
      { date: "2026-01-01", price: "100", kind: "low" },
      { date: "2026-01-02", price: "120", kind: "high" },
    ]);
    expect(zigzag(series("100", "90", "90", "100"), "8").pivots).toEqual([
      { date: "2026-01-01", price: "100", kind: "high" },
      { date: "2026-01-02", price: "90", kind: "low" },
    ]);
    // Before the first pivot as well.
    expect(zigzag(series("100", "100", "90"), "8").pivots).toEqual([{ date: "2026-01-01", price: "100", kind: "high" }]);
  });

  it("extension ≤ 0: down-swing 100 → 30 gives no extension, retracements stay", () => {
    const result = zigzag(series("100", "30", "40"), "8");
    expect(result.pivots.map((p) => p.price)).toEqual(["100", "30"]);
    expect(result.retracements).toEqual([
      { ratio: "0.382", price: "56.74" },
      { ratio: "0.5", price: "65" },
      { ratio: "0.618", price: "73.26" },
    ]);
    expect(result.extension).toBeNull();
  });

  it("a larger threshold finds fewer pivots", () => {
    const closes = series("100", "106", "100", "113", "99");
    expect(zigzag(closes, "5").pivots).toHaveLength(4);
    expect(zigzag(closes, "12").pivots).toHaveLength(2);
  });

  it("split: closes from tradingDayCloses are adjusted, so a 2:1 split is never a pivot", () => {
    const actions: CorporateActions = {
      splits: [{ securityId: "s1", date: "2026-03-02", ratioOld: "1", ratioNew: "2" }],
      isinChanges: [],
    };
    const provider = (date: string, price: string): PriceObservation => ({
      id: `p-${date}`,
      securityId: "s1",
      date,
      sequence: 0,
      price,
      source: "provider",
      fetchedAt: `${date}T18:00:00.000Z`,
      provider: "YAHOO",
    });
    const closes = tradingDayCloses([provider("2026-02-27", "200"), provider("2026-03-02", "95")], "s1", actions, "2026-03-31");
    expect(closes.map((close) => close.price)).toEqual(["100", "95"]);
    expect(zigzag(closes, "8").pivots).toEqual([]);
  });
});
