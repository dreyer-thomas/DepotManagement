import { describe, expect, it } from "vitest";
import { priceHistoryStart } from "./price-history";

const TODAY = "2026-10-23";

describe("priceHistoryStart", () => {
  it("starts a recent holding at the buffered 3J start", () => {
    expect(priceHistoryStart({ firstActivity: "2026-10-13" }, TODAY)).toBe("2023-10-13");
  });

  it("keeps an old holding's first activity date", () => {
    expect(priceHistoryStart({ firstActivity: "2020-05-04" }, TODAY)).toBe("2020-05-04");
  });

  it("uses the earliest start of a held and watched Security", () => {
    expect(priceHistoryStart({ firstActivity: "2026-10-13", watchedFrom: "2020-01-01" }, TODAY)).toBe("2020-01-01");
    expect(priceHistoryStart({ firstActivity: "2026-10-13", watchedFrom: "2025-01-01" }, TODAY)).toBe("2023-10-13");
  });

  it("starts a benchmark at benchmarkStartDate", () => {
    expect(priceHistoryStart({ firstLedger: "2026-10-13" }, TODAY)).toBe("2023-10-13");
    expect(priceHistoryStart({ firstLedger: "2020-05-04" }, TODAY)).toBe("2020-04-24");
  });

  it("returns null without any role", () => {
    expect(priceHistoryStart({}, TODAY)).toBeNull();
    expect(priceHistoryStart({ firstActivity: null, watchedFrom: null, firstLedger: null }, TODAY)).toBeNull();
  });

  it("keeps a holding exactly at the buffered 3J start and one just before it", () => {
    expect(priceHistoryStart({ firstActivity: "2023-10-13" }, TODAY)).toBe("2023-10-13");
    expect(priceHistoryStart({ firstActivity: "2023-10-12" }, TODAY)).toBe("2023-10-12");
    expect(priceHistoryStart({ firstActivity: "2023-10-14" }, TODAY)).toBe("2023-10-13");
  });
});
