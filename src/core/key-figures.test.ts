import { describe, expect, it } from "vitest";
import { type CorporateActions, NO_CORPORATE_ACTIONS } from "./corporate-actions";
import {
  emptyKeyFigures,
  fiftyTwoWeekFigures,
  hasProviderKeyFigures,
  isKeyFiguresStale,
  KEY_FIGURES_STALE_AFTER_DAYS,
  upcomingEarningsDate,
} from "./key-figures";
import type { PriceObservation } from "./prices";

const TODAY = "2026-10-28";

function provider(date: string, price: string, securityId = "s1"): PriceObservation {
  return { id: `p-${securityId}-${date}`, securityId, date, sequence: 0, price, source: "provider" };
}

describe("fiftyTwoWeekFigures", () => {
  it("high, low (with dates), distance to high and performance over today − 364 .. today", () => {
    const observations = [
      provider("2025-10-01", "50"), // before the base: ignored
      provider("2025-10-29", "80"), // base (on the window start)
      provider("2026-01-15", "120"),
      provider("2026-05-04", "70"),
      provider("2026-10-27", "108"),
    ];
    expect(fiftyTwoWeekFigures(observations, "s1", NO_CORPORATE_ACTIONS, TODAY)).toEqual({
      high: { price: "120", date: "2026-01-15" },
      low: { price: "70", date: "2026-05-04" },
      distanceToHigh: "-0.1",
      performance: "0.35",
    });
  });

  it("base is the last close on or before the window start", () => {
    const observations = [provider("2025-10-20", "90"), provider("2025-10-27", "100"), provider("2026-10-28", "110")];
    expect(fiftyTwoWeekFigures(observations, "s1", NO_CORPORATE_ACTIONS, TODAY)).toMatchObject({
      high: { price: "110", date: "2026-10-28" },
      low: { price: "110", date: "2026-10-28" },
      distanceToHigh: "0",
      performance: "0.1",
    });
  });

  it("a tie takes the later date", () => {
    const observations = [provider("2026-03-01", "100"), provider("2026-04-01", "100"), provider("2026-05-01", "100")];
    expect(fiftyTwoWeekFigures(observations, "s1", NO_CORPORATE_ACTIONS, TODAY)).toMatchObject({
      high: { date: "2026-05-01" },
      low: { date: "2026-05-01" },
    });
  });

  it("split inside the window: closes before the split are adjusted (no fake drop)", () => {
    const actions: CorporateActions = { splits: [{ securityId: "s1", date: "2026-07-28", ratioOld: "1", ratioNew: "2" }], isinChanges: [] };
    const observations = [provider("2025-10-28", "180"), provider("2026-06-01", "200"), provider("2026-08-01", "95"), provider("2026-10-27", "99")];
    expect(fiftyTwoWeekFigures(observations, "s1", actions, TODAY)).toEqual({
      high: { price: "100", date: "2026-06-01" },
      low: { price: "95", date: "2026-08-01" },
      distanceToHigh: "-0.01",
      performance: "0.1",
    });
  });

  it("less than 52 weeks of closes: high/low over the available closes, performance null", () => {
    const observations = [provider("2026-08-28", "40"), provider("2026-09-15", "50"), provider("2026-10-27", "45")];
    expect(fiftyTwoWeekFigures(observations, "s1", NO_CORPORATE_ACTIONS, TODAY)).toEqual({
      high: { price: "50", date: "2026-09-15" },
      low: { price: "40", date: "2026-08-28" },
      distanceToHigh: "-0.1",
      performance: null,
    });
  });

  it("no stored Price (Transaction prices are ignored): all null", () => {
    const transaction: PriceObservation = { id: "t", securityId: "s1", date: "2026-10-01", sequence: 3, price: "999", source: "transaction" };
    expect(fiftyTwoWeekFigures([transaction, provider("2026-10-01", "5", "s2")], "s1", NO_CORPORATE_ACTIONS, TODAY)).toEqual({
      high: null,
      low: null,
      distanceToHigh: null,
      performance: null,
    });
  });

  it("Transaction prices never set a high; a manual Price wins on its date; later dates ignored", () => {
    const observations: PriceObservation[] = [
      provider("2026-09-01", "100"),
      { id: "t", securityId: "s1", date: "2026-09-02", sequence: 1, price: "500", source: "transaction" },
      provider("2026-09-03", "120"),
      { id: "m", securityId: "s1", date: "2026-09-03", sequence: 0, price: "110", source: "manual" },
      provider("2026-10-29", "300"),
    ];
    expect(fiftyTwoWeekFigures(observations, "s1", NO_CORPORATE_ACTIONS, TODAY)).toMatchObject({
      high: { price: "110", date: "2026-09-03" },
      low: { price: "100", date: "2026-09-01" },
      distanceToHigh: "0",
    });
  });

  it("ISIN change: the old Security's closes count for the successor it maps to today", () => {
    const actions: CorporateActions = {
      splits: [],
      isinChanges: [{ oldSecurityId: "old", newSecurityId: "new", date: "2026-06-01", oldQuantity: "1", newQuantity: "1" }],
    };
    // 2025-10-28 lies before the window start (2025-10-29): the base only.
    const observations = [provider("2025-10-28", "50", "old"), provider("2026-03-01", "80", "old"), provider("2026-10-27", "60", "new")];
    const expected = {
      high: { price: "80", date: "2026-03-01" },
      low: { price: "60", date: "2026-10-27" },
      distanceToHigh: "-0.25",
      performance: "0.2",
    };
    expect(fiftyTwoWeekFigures(observations, "old", actions, TODAY)).toEqual(expected);
    expect(fiftyTwoWeekFigures(observations, "new", actions, TODAY)).toEqual(expected);
  });
});

describe("isKeyFiguresStale", () => {
  it("is stale when the fetched date + 7 days is before today", () => {
    expect(KEY_FIGURES_STALE_AFTER_DAYS).toBe(7);
    expect(isKeyFiguresStale("2026-10-21", "2026-10-28")).toBe(false);
    expect(isKeyFiguresStale("2026-10-21", "2026-10-29")).toBe(true);
    expect(isKeyFiguresStale("2026-10-28", "2026-10-28")).toBe(false);
  });
});

describe("helpers", () => {
  it("only STOCK, ETF and FUND get provider key figures", () => {
    expect(["STOCK", "ETF", "FUND", "CRYPTO", "CERTIFICATE"].map(hasProviderKeyFigures)).toEqual([true, true, true, false, false]);
  });

  it("an earnings date before today is not upcoming", () => {
    expect(upcomingEarningsDate("2026-10-27", TODAY)).toBeNull();
    expect(upcomingEarningsDate(TODAY, TODAY)).toBe(TODAY);
    expect(upcomingEarningsDate(null, TODAY)).toBeNull();
  });

  it("an empty snapshot has every field null", () => {
    expect(Object.values(emptyKeyFigures()).every((value) => value === null)).toBe(true);
  });
});
