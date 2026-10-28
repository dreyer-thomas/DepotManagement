import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const classification = vi.hoisted(() => ({ refreshClassifications: vi.fn() }));
const after = vi.hoisted(() => vi.fn());
vi.mock("@/modules/classification", () => classification);
vi.mock("next/server", () => ({ after }));
const watchedSecurityIds = vi.hoisted(() => vi.fn(async () => [] as string[]));
vi.mock("@/modules/watchlist", () => ({ watchedSecurityIds }));

import { runClassificationRefresh, scheduleClassificationRefresh } from "./classification-refresh";

beforeEach(() => {
  classification.refreshClassifications.mockReset();
  after.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runClassificationRefresh", () => {
  it("runs the refresh", async () => {
    classification.refreshClassifications.mockResolvedValue({ updated: 1, unchanged: 0, failed: 0 });
    await runClassificationRefresh();
    expect(classification.refreshClassifications).toHaveBeenCalledTimes(1);
    expect(classification.refreshClassifications).toHaveBeenCalledWith({ watched: watchedSecurityIds });
  });

  it("logs a failing refresh instead of throwing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    classification.refreshClassifications.mockRejectedValue(new RangeError("database locked"));
    await expect(runClassificationRefresh()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith("Classification: refresh failed (RangeError)");
  });
});

describe("scheduleClassificationRefresh", () => {
  it("runs the refresh after the response", async () => {
    classification.refreshClassifications.mockResolvedValue({ updated: 0, unchanged: 0, failed: 0 });
    scheduleClassificationRefresh();
    expect(classification.refreshClassifications).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    await (after.mock.calls[0][0] as () => Promise<void>)();
    expect(classification.refreshClassifications).toHaveBeenCalledTimes(1);
  });

  it("never throws when after() is unavailable", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    after.mockImplementation(() => {
      throw new Error("outside a request scope");
    });
    expect(() => scheduleClassificationRefresh()).not.toThrow();
    expect(error).toHaveBeenCalledWith("Classification: scheduling the refresh failed (Error)");
  });
});
