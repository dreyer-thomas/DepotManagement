import { describe, expect, it } from "vitest";
import { DEFAULT_PERIOD, parsePeriod, periodLabel, type PeriodSelection, resolvePeriod, serializePeriod } from "./period";

const TODAY = "2026-10-26";

describe("parsePeriod / serializePeriod", () => {
  it.each(["1T", "1W", "1M", "YTD", "1J", "3J", "MAX"])("reads the preset %s and writes it back", (text) => {
    const selection = parsePeriod(text, TODAY);
    expect(selection).toEqual({ kind: "preset", preset: text });
    expect(serializePeriod(selection!)).toBe(text);
  });

  it("reads a custom range and writes it back", () => {
    const selection = parsePeriod("custom:2026-01-01:2026-06-30", TODAY);
    expect(selection).toEqual({ kind: "custom", from: "2026-01-01", to: "2026-06-30" });
    expect(serializePeriod(selection!)).toBe("custom:2026-01-01:2026-06-30");
    expect(parsePeriod("custom:2026-10-26:2026-10-26", TODAY)).toEqual({ kind: "custom", from: TODAY, to: TODAY });
  });

  it.each([
    "custom:2026-13-01:x",
    "custom:2026-01-01:2026-10-27",
    "custom:2026-06-30:2026-01-01",
    "custom:2026-02-30:2026-03-01",
    "custom:2026-01-01",
    "custom:2026-01-01:2026-02-01:x",
    "1j",
    "Max",
    "",
    undefined,
    42,
  ])("rejects %j", (text) => {
    expect(parsePeriod(text, TODAY)).toBeNull();
  });

  it("defaults to 1J", () => {
    expect(DEFAULT_PERIOD).toEqual({ kind: "preset", preset: "1J" });
  });
});

describe("resolvePeriod", () => {
  const preset = (value: string) => parsePeriod(value, TODAY) as PeriodSelection;

  it("ends presets today and starts them by calendar arithmetic", () => {
    expect(resolvePeriod(preset("1T"), TODAY, null)).toEqual({ from: "2026-10-25", to: TODAY });
    expect(resolvePeriod(preset("1W"), TODAY, null)).toEqual({ from: "2026-10-19", to: TODAY });
    expect(resolvePeriod(preset("1M"), TODAY, null)).toEqual({ from: "2026-09-26", to: TODAY });
    expect(resolvePeriod(preset("YTD"), TODAY, null)).toEqual({ from: "2026-01-01", to: TODAY });
    expect(resolvePeriod(preset("1J"), TODAY, null)).toEqual({ from: "2025-10-26", to: TODAY });
    expect(resolvePeriod(preset("3J"), TODAY, null)).toEqual({ from: "2023-10-26", to: TODAY });
  });

  it("clamps the day to the month end", () => {
    expect(resolvePeriod(preset("1M"), "2026-03-31", null)).toEqual({ from: "2026-02-28", to: "2026-03-31" });
    expect(resolvePeriod(preset("1J"), "2024-02-29", null)).toEqual({ from: "2023-02-28", to: "2024-02-29" });
  });

  it("starts MAX on the first ledger date, or today without one", () => {
    expect(resolvePeriod(preset("MAX"), TODAY, "2019-04-02")).toEqual({ from: "2019-04-02", to: TODAY });
    expect(resolvePeriod(preset("MAX"), TODAY, null)).toEqual({ from: TODAY, to: TODAY });
    expect(resolvePeriod(preset("MAX"), TODAY, "2099-01-01")).toEqual({ from: TODAY, to: TODAY });
  });

  it("returns a custom range as is", () => {
    expect(resolvePeriod({ kind: "custom", from: "2026-01-01", to: "2026-06-30" }, TODAY, "2019-04-02")).toEqual({
      from: "2026-01-01",
      to: "2026-06-30",
    });
  });
});

describe("periodLabel", () => {
  it("names presets and formats custom ranges de-DE", () => {
    expect(periodLabel({ kind: "preset", preset: "1J" })).toBe("1J");
    expect(periodLabel({ kind: "preset", preset: "MAX" })).toBe("Max");
    expect(periodLabel({ kind: "custom", from: "2026-01-01", to: "2026-06-30" })).toBe("01.01.2026 – 30.06.2026");
  });
});
