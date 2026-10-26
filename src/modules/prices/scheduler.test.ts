import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PriceRunResult } from "./prices";
import { SCHEDULER_CHECK_INTERVAL_MS, startPriceScheduler, stopPriceScheduler } from "./scheduler";

const HOUR = SCHEDULER_CHECK_INTERVAL_MS;
const OK: PriceRunResult = { updated: 1, failed: [] };

let clock: Date;
const now = () => clock;

beforeEach(() => {
  vi.useFakeTimers();
  clock = new Date("2026-10-25T10:00:00.000Z");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  stopPriceScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Advances the fake clock and timers by `ms`, letting run promises settle. */
async function advance(ms: number) {
  clock = new Date(clock.getTime() + ms);
  await vi.advanceTimersByTimeAsync(ms);
}

describe("startPriceScheduler", () => {
  it("runs once immediately with the Berlin business date and ignores a second start", async () => {
    const run = vi.fn(async () => OK);
    expect(startPriceScheduler({ run, now })).toBe(true);
    expect(startPriceScheduler({ run, now })).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("2026-10-25");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("ignores a start from a second module copy while the first copy's scheduler runs", async () => {
    const run = vi.fn(async () => OK);
    expect(startPriceScheduler({ run, now })).toBe(true);
    vi.resetModules();
    const copy = await import("./scheduler");
    expect(copy.startPriceScheduler).not.toBe(startPriceScheduler);
    expect(copy.startPriceScheduler({ run, now })).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("runs once more on the first hourly check of a new Berlin day, never twice a day", async () => {
    const run = vi.fn(async () => OK);
    startPriceScheduler({ run, now });
    await advance(HOUR * 5);
    expect(run).toHaveBeenCalledTimes(1);
    // 2026-10-25T22:00Z is 23:00 in Berlin (UTC+1); 23:00Z is midnight → 2026-10-26.
    clock = new Date("2026-10-25T22:30:00.000Z");
    await advance(HOUR);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenLastCalledWith("2026-10-26");
    await advance(HOUR * 20);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs a rejected run without crashing and retries on the next day", async () => {
    const run = vi.fn(async (): Promise<PriceRunResult> => {
      throw new TypeError("boom 123.45");
    });
    startPriceScheduler({ run, now });
    await vi.advanceTimersByTimeAsync(0);
    expect(console.error).toHaveBeenCalledWith("Prices: scheduled run failed (TypeError)");
    await advance(HOUR);
    expect(run).toHaveBeenCalledTimes(1);
    await advance(HOUR * 24);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("logs the number of failed Securities only", async () => {
    const run = vi.fn(async () => ({
      updated: 0,
      failed: [{ securityId: "s", name: "SAP", provider: "YAHOO" as const, reason: "network" as const }],
    }));
    startPriceScheduler({ run, now });
    await vi.advanceTimersByTimeAsync(0);
    expect(console.warn).toHaveBeenCalledWith("Prices: scheduled run finished with 1 failed Securities");
  });

  it("unrefs its timer so it never keeps the process alive", () => {
    const unref = vi.fn();
    const realSetInterval = globalThis.setInterval;
    vi.spyOn(globalThis, "setInterval").mockImplementation(((handler: () => void, ms: number) => {
      const timer = realSetInterval(handler, ms);
      return Object.assign(timer, { unref });
    }) as unknown as typeof setInterval);
    startPriceScheduler({ run: vi.fn(async () => OK), now });
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it("starts afresh after stopPriceScheduler", async () => {
    const run = vi.fn(async () => OK);
    startPriceScheduler({ run, now });
    stopPriceScheduler();
    expect(vi.getTimerCount()).toBe(0);
    expect(startPriceScheduler({ run, now })).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
