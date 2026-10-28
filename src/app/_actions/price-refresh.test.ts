import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.hoisted(() => vi.fn());
const prices = vi.hoisted(() => ({ backfillHeldPrices: vi.fn(), refetchPriceHistory: vi.fn() }));
const logos = vi.hoisted(() => ({ fetchMissingLogos: vi.fn() }));
const classification = vi.hoisted(() => ({ refreshClassifications: vi.fn() }));

vi.mock("next/server", () => ({ after }));
vi.mock("@/modules/prices", () => prices);
vi.mock("@/modules/logos", () => logos);
vi.mock("@/modules/classification", () => classification);
const watchlist = vi.hoisted(() => ({ watchlistPriceTargets: vi.fn() }));
vi.mock("@/modules/watchlist", () => watchlist);

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
  logos.fetchMissingLogos.mockReset();
  logos.fetchMissingLogos.mockResolvedValue({ stored: 0, notFound: 0, failed: 0 });
  classification.refreshClassifications.mockReset();
  classification.refreshClassifications.mockResolvedValue({ updated: 0, unchanged: 0, failed: 0 });
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
    expect(prices.backfillHeldPrices).toHaveBeenCalledExactlyOnceWith("2026-10-26", { watched: watchlist.watchlistPriceTargets });
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

  it("fetches logos in the same callback only after the backfill has finished", async () => {
    const order: string[] = [];
    let finishBackfill!: () => void;
    prices.backfillHeldPrices.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishBackfill = () => {
            order.push("backfill done");
            resolve({ updated: 1, failed: [] });
          };
        }),
    );
    logos.fetchMissingLogos.mockImplementation(async () => {
      order.push("logos start");
      return { stored: 0, notFound: 0, failed: 0 };
    });
    schedulePriceBackfill();
    const running = runScheduled();
    await Promise.resolve();
    expect(logos.fetchMissingLogos).not.toHaveBeenCalled();
    finishBackfill();
    await running;
    expect(order).toEqual(["backfill done", "logos start"]);
  });

  it("still fetches logos when the backfill rejects, logging each failure separately", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    prices.backfillHeldPrices.mockRejectedValue(new Error("database locked"));
    logos.fetchMissingLogos.mockRejectedValue(new TypeError("fetch failed"));
    schedulePriceBackfill();
    await expect(runScheduled()).resolves.toBeUndefined();
    expect(logos.fetchMissingLogos).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith("Prices: backfill failed (Error)");
    expect(error).toHaveBeenCalledWith("Logos: fetch failed (TypeError)");
  });

  it("refreshes classifications after the logo fetch, also when backfill and logo fetch fail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const order: string[] = [];
    prices.backfillHeldPrices.mockImplementation(async () => {
      order.push("backfill");
      throw new Error("database locked");
    });
    logos.fetchMissingLogos.mockImplementation(async () => {
      order.push("logos");
      throw new TypeError("fetch failed");
    });
    classification.refreshClassifications.mockImplementation(async () => {
      order.push("classification");
      throw new RangeError("boom");
    });
    schedulePriceBackfill();
    await expect(runScheduled()).resolves.toBeUndefined();
    expect(order).toEqual(["backfill", "logos", "classification"]);
    expect(error).toHaveBeenCalledWith("Classification: refresh failed (RangeError)");
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
    expect(logos.fetchMissingLogos).not.toHaveBeenCalled();
    expect(classification.refreshClassifications).not.toHaveBeenCalled();
  });
});
