import { describe, expect, it } from "vitest";
import { fakeFetch, json, recorded } from "../../../../test/helpers/providers";
import { binancePrices } from "./binance";

const CTX = { securityId: "s1", splits: [] };

describe("binancePrices", () => {
  it("returns the recorded BTCEUR closes dated by the UTC open time", async () => {
    const { fetch, calls } = fakeFetch(json(recorded("binance-klines-btceur")));
    const result = await binancePrices({ fetch }).fetchHistory("BTCEUR", "2024-01-01", "2024-01-05", CTX);
    expect(result).toEqual({
      ok: true,
      value: [
        { date: "2024-01-01", close: "40113.43" },
        { date: "2024-01-02", close: "41145.87" },
        { date: "2024-01-03", close: "39384.84" },
        { date: "2024-01-04", close: "40438.6" },
        { date: "2024-01-05", close: "40463.66" },
      ],
    });
    // Privacy (AD-13): only the pair and dates are sent.
    expect(calls).toEqual([
      {
        url: "https://api.binance.com/api/v3/klines?symbol=BTCEUR&interval=1d&startTime=1704067200000&endTime=1704412800000&limit=1000",
        method: "GET",
        headers: { accept: "application/json" },
        body: undefined,
      },
    ]);
  });

  it("is not found for an invalid symbol (recorded -1121)", async () => {
    const { fetch } = fakeFetch(json(recorded("binance-klines-invalid-symbol"), 400));
    expect(await binancePrices({ fetch }).fetchHistory("ZZQQXXEUR", "2024-01-01", "2024-01-05", CTX)).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it.each(["btceur", "BTCUSD", "BTC-EUR", "EUR"])("rejects the malformed symbol %s without a request", async (symbol) => {
    const { fetch, calls } = fakeFetch(json(recorded("binance-klines-btceur")));
    expect(await binancePrices({ fetch }).fetchHistory(symbol, "2024-01-01", "2024-01-05", CTX)).toEqual({ ok: false, reason: "not-found" });
    expect(calls).toHaveLength(0);
  });

  it("paginates while a page is full", async () => {
    const DAY = 86_400_000;
    const start = Date.UTC(2020, 0, 1);
    const kline = (open: number, close: string) => [open, "1", "1", "1", close, "1", open + DAY - 1, "1", 1, "1", "1", "0"];
    const page1 = Array.from({ length: 1000 }, (_, i) => kline(start + i * DAY, "100"));
    const page2 = [kline(start + 1000 * DAY, "200"), kline(start + 1001 * DAY, "201")];
    const { fetch, calls } = fakeFetch(json(page1), json(page2));
    const result = await binancePrices({ fetch }).fetchHistory("BTCEUR", "2020-01-01", "2022-12-31", CTX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toHaveLength(1002);
    expect(result.value[0]).toEqual({ date: "2020-01-01", close: "100" });
    expect(result.value[1001]).toEqual({ date: "2022-09-28", close: "201" });
    expect(calls).toHaveLength(2);
    expect(calls[1].url).toContain(`startTime=${start + 1000 * DAY}`);
  });

  it.each([
    ["a network error", new TypeError("fetch failed"), "network"],
    ["HTTP 429", json({ code: -1003, msg: "Too many requests" }, 429), "network"],
    ["HTTP 400 with another code", json({ code: -1100, msg: "Illegal characters" }, 400), "network"],
    ["a schema mismatch", json([["x"]]), "schema"],
    ["an empty result", json([]), "not-found"],
  ])("maps %s", async (_label, reply, reason) => {
    const { fetch } = fakeFetch(reply);
    expect(await binancePrices({ fetch }).fetchHistory("BTCEUR", "2024-01-01", "2024-01-05", CTX)).toEqual({ ok: false, reason });
  });

  it("fetchLatest returns the last close of the last 7 days", async () => {
    const { fetch } = fakeFetch(json(recorded("binance-klines-btceur")));
    const adapter = binancePrices({ fetch, now: () => new Date("2024-01-06T10:00:00Z") });
    expect(await adapter.fetchLatest("BTCEUR", CTX)).toEqual({ ok: true, value: { date: "2024-01-05", close: "40463.66" } });
  });
});
