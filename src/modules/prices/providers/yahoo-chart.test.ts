import { describe, expect, it, vi } from "vitest";
import { recorded } from "../../../../test/helpers/providers";
import type { Split } from "@/core/corporate-actions";
import { ExactDecimal } from "@/core/decimal";
import { type YahooChart, yahooPrices } from "./yahoo";

const chartReturning = (body: unknown) => vi.fn<YahooChart>(async () => body);
const chartThrowing = (error: unknown) =>
  vi.fn<YahooChart>(async () => {
    throw error;
  });

const ctx = (splits: Split[] = []) => ({ securityId: "s1", splits });

type RecordedChart = { meta: { currency: string }; quotes: { date: string; close: number | null }[] };
const recordedChart = (name: string) => recorded(name) as RecordedChart;

describe("yahooPrices().fetchHistory", () => {
  it("returns one EUR close per trading day, rounded to 4 dp (recorded SAP.DE chart)", async () => {
    const chart = chartReturning(recorded("yahoo-chart-sap-de"));
    const result = await yahooPrices({ chart }).fetchHistory("SAP.DE", "2026-10-13", "2026-10-23", ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((close) => close.date)).toEqual([
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-19",
      "2026-10-20",
      "2026-10-21",
      "2026-10-22",
      "2026-10-23",
    ]);
    expect(result.value[0]).toEqual({ date: "2026-10-13", close: "197.28" });
    expect(result.value[2]).toEqual({ date: "2026-10-15", close: "201.25" });
    // Privacy (AD-13): only the symbol and the date range leave the server; with a timeout signal.
    expect(chart).toHaveBeenCalledTimes(1);
    const [symbol, query, options] = chart.mock.calls[0];
    expect(symbol).toBe("SAP.DE");
    expect(query).toEqual({ period1: "2026-10-13", period2: "2026-10-24", interval: "1d" });
    expect(options.validateResult).toBe(false);
    expect(options.fetchOptions.signal).toBeInstanceOf(AbortSignal);
  });

  it("stores unadjusted closes around a recorded 1:10 split (contract test, recorded NVD.DE chart)", async () => {
    const fixture = recordedChart("yahoo-chart-nvd-de-split");
    const close = (date: string) => fixture.quotes.find((quote) => quote.date.startsWith(date))!.close!;
    const split: Split = { securityId: "s1", date: "2024-06-10", ratioOld: "1", ratioNew: "10" };
    const result = await yahooPrices({ chart: chartReturning(fixture) }).fetchHistory("NVD.DE", "2024-06-03", "2024-06-14", ctx([split]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = new Map(result.value.map((row) => [row.date, row.close]));
    expect(stored.size).toBe(10);
    const round4 = (value: InstanceType<typeof ExactDecimal>) => value.toDecimalPlaces(4, ExactDecimal.ROUND_HALF_UP).toFixed();
    expect(stored.get("2024-06-07")).toBe(round4(new ExactDecimal(String(close("2024-06-07"))).times(10)));
    expect(stored.get("2024-06-07")).toBe("1104.4");
    expect(stored.get("2024-06-10")).toBe(round4(new ExactDecimal(String(close("2024-06-10")))));
    expect(stored.get("2024-06-10")).toBe("114.22");
    // Another Security's split does not apply.
    const other = await yahooPrices({ chart: chartReturning(fixture) }).fetchHistory("NVD.DE", "2024-06-03", "2024-06-14", {
      securityId: "other",
      splits: [split],
    });
    expect(other.ok && other.value.find((row) => row.date === "2024-06-07")?.close).toBe("110.44");
  });

  it("limits bars to the requested range, drops null closes and keeps the last bar of a date", async () => {
    const chart = chartReturning({
      meta: { currency: "EUR" },
      quotes: [
        { date: "2026-10-12T07:00:00.000Z", close: 1 },
        { date: "2026-10-13T07:00:00.000Z", close: 2 },
        { date: "2026-10-13T15:35:00.000Z", close: 2.5 },
        { date: "2026-10-14T07:00:00.000Z", close: null },
        { date: "2026-10-14T22:30:00.000Z", close: 3 },
        { date: "2026-10-16T07:00:00.000Z", close: 4 },
      ],
    });
    const result = await yahooPrices({ chart }).fetchHistory("X.DE", "2026-10-13", "2026-10-15", ctx());
    // 2026-10-14T22:30Z is 2026-10-15 in Berlin.
    expect(result).toEqual({
      ok: true,
      value: [
        { date: "2026-10-13", close: "2.5" },
        { date: "2026-10-15", close: "3" },
      ],
    });
  });

  it("is a currency failure for a non-EUR listing (recorded AAPL chart, no conversion)", async () => {
    const result = await yahooPrices({ chart: chartReturning(recorded("yahoo-chart-aapl-usd")) }).fetchHistory(
      "AAPL",
      "2026-10-19",
      "2026-10-23",
      ctx(),
    );
    expect(result).toEqual({ ok: false, reason: "currency" });
  });

  it("is not found when the range has no bar (recorded weekend chart: Yahoo returns only the last bar before it)", async () => {
    const result = await yahooPrices({ chart: chartReturning(recorded("yahoo-chart-sap-de-weekend")) }).fetchHistory(
      "SAP.DE",
      "2026-10-24",
      "2026-10-25",
      ctx(),
    );
    expect(result).toEqual({ ok: false, reason: "not-found" });
    expect(await yahooPrices({ chart: chartReturning({ meta: { currency: "EUR" }, quotes: [] }) }).fetchHistory("X", "2026-10-01", "2026-10-02", ctx())).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("classifies thrown errors: Yahoo's no-data answers are not found, anything else is a network failure", async () => {
    const fetchWith = (error: unknown) => yahooPrices({ chart: chartThrowing(error) }).fetchHistory("X.DE", "2026-10-01", "2026-10-02", ctx());
    expect(await fetchWith(new Error("No data found, symbol may be delisted"))).toEqual({ ok: false, reason: "not-found" });
    const badRequest = Object.assign(new Error("Data doesn't exist for startDate = 1, endDate = 2"), { name: "BadRequestError" });
    expect(await fetchWith(badRequest)).toEqual({ ok: false, reason: "not-found" });
    expect(await fetchWith(new TypeError("fetch failed"))).toEqual({ ok: false, reason: "network" });
    expect(await fetchWith(new DOMException("timed out", "TimeoutError"))).toEqual({ ok: false, reason: "network" });
    expect(await fetchWith(Object.assign(new Error("Too Many Requests"), { name: "HTTPError" }))).toEqual({ ok: false, reason: "network" });
    expect(await fetchWith("boom")).toEqual({ ok: false, reason: "unexpected" });
  });

  it("is a schema failure for a malformed result", async () => {
    for (const body of [null, {}, { meta: {}, quotes: [] }, { meta: { currency: "EUR" }, quotes: [{ date: "not a date", close: 1 }] }]) {
      expect(await yahooPrices({ chart: chartReturning(body) }).fetchHistory("X", "2026-10-01", "2026-10-02", ctx())).toEqual({
        ok: false,
        reason: "schema",
      });
    }
  });
});

describe("yahooPrices().fetchLatest", () => {
  it("fetches the last 7 days and returns the newest bar (recorded SAP.DE chart)", async () => {
    const chart = chartReturning(recorded("yahoo-chart-sap-de"));
    const adapter = yahooPrices({ chart, now: () => new Date("2026-10-23T18:00:00.000Z") });
    expect(await adapter.fetchLatest("SAP.DE", ctx())).toEqual({ ok: true, value: { date: "2026-10-23", close: "214.4" } });
    expect(chart.mock.calls[0][1]).toEqual({ period1: "2026-10-16", period2: "2026-10-24", interval: "1d" });
  });

  it("passes failures through", async () => {
    const adapter = yahooPrices({ chart: chartReturning(recorded("yahoo-chart-aapl-usd")), now: () => new Date("2026-10-23T18:00:00.000Z") });
    expect(await adapter.fetchLatest("AAPL", ctx())).toEqual({ ok: false, reason: "currency" });
  });
});
