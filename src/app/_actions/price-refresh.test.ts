import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.hoisted(() => vi.fn());
const prices = vi.hoisted(() => ({ backfillHeldPrices: vi.fn(), refetchPriceHistory: vi.fn() }));

vi.mock("next/server", () => ({ after }));
vi.mock("@/modules/prices", () => prices);

import { schedulePriceBackfill, schedulePriceRefetch } from "./price-refresh";

/** Runs the callback registered with `after()` (the work after the response). */
async function runScheduled() {
  expect(after).toHaveBeenCalledTimes(1);
  const callback = after.mock.calls[0][0] as () => Promise<void>;
  await callback();
}

beforeEach(() => {
  after.mockReset();
  prices.backfillHeldPrices.mockReset();
  prices.refetchPriceHistory.mockReset();
  vi.useFakeTimers({ now: new Date("2026-10-25T23:30:00.000Z"), toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("schedulePriceBackfill", () => {
  it("runs the backfill for today's Berlin business date after the response", async () => {
    prices.backfillHeldPrices.mockResolvedValue({ updated: 1, failed: [] });
    schedulePriceBackfill();
    expect(prices.backfillHeldPrices).not.toHaveBeenCalled();
    await runScheduled();
    expect(prices.backfillHeldPrices).toHaveBeenCalledExactlyOnceWith("2026-10-26");
  });

  it("logs a failing backfill instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    prices.backfillHeldPrices.mockRejectedValue(new Error("database locked"));
    schedulePriceBackfill();
    await expect(runScheduled()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Prices: backfill failed (Error)");
  });

  it("logs the number of failed Securities, never prices or names", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    prices.backfillHeldPrices.mockResolvedValue({ updated: 0, failed: [{ securityId: "s1", name: "SAP SE", reason: "network" }] });
    schedulePriceBackfill();
    await runScheduled();
    expect(warn).toHaveBeenCalledWith("Prices: backfill finished with 1 failed Securities");
  });

  it("never throws when after() is unavailable", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    after.mockImplementation(() => {
      throw new Error("outside a request scope");
    });
    expect(() => schedulePriceBackfill()).not.toThrow();
    expect(error).toHaveBeenCalledWith("Prices: scheduling backfill failed (Error)");
  });
});

describe("schedulePriceRefetch", () => {
  it("refetches the Security's history after the response; a failure is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    prices.refetchPriceHistory.mockRejectedValue(new Error("boom"));
    schedulePriceRefetch("sec-1");
    await runScheduled();
    expect(prices.refetchPriceHistory).toHaveBeenCalledExactlyOnceWith("sec-1", "2026-10-26");
    expect(error).toHaveBeenCalledWith("Prices: refetch failed (Error)");
  });
});
