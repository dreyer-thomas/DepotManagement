import { describe, expect, it } from "vitest";
import { fakeFetch, json, recorded } from "../../../../test/helpers/providers";
import { coingeckoPrices, findCoinId } from "./coingecko";

describe("findCoinId", () => {
  it("returns the id of the first coin with the exact symbol (recorded BTC search)", async () => {
    const { fetch, calls } = fakeFetch(json(recorded("coingecko-search-btc")));
    expect(await findCoinId("btc", { fetch })).toEqual({ status: "found", value: "bitcoin" });
    // Privacy (AD-13): only the symbol is sent; no key header without a key.
    expect(calls).toEqual([
      { url: "https://api.coingecko.com/api/v3/search?query=BTC", method: "GET", headers: { accept: "application/json" }, body: undefined },
    ]);
  });

  it("sends the demo key header only when set", async () => {
    const { fetch, calls } = fakeFetch(json(recorded("coingecko-search-btc")));
    await findCoinId("BTC", { fetch, apiKey: "demo-key" });
    expect(calls[0].headers["x-cg-demo-api-key"]).toBe("demo-key");
  });

  it("skips coins whose symbol only contains the query", async () => {
    const { fetch } = fakeFetch(json({ coins: [{ id: "wrapped-btc", symbol: "WBTC" }, { id: "bitcoin", symbol: "btc" }] }));
    expect(await findCoinId("BTC", { fetch })).toEqual({ status: "found", value: "bitcoin" });
  });

  it("skips a symbol match whose id is invalid", async () => {
    const { fetch } = fakeFetch(json({ coins: [{ id: "bad id!", symbol: "BTC" }, { id: "bitcoin", symbol: "BTC" }] }));
    expect(await findCoinId("BTC", { fetch })).toEqual({ status: "found", value: "bitcoin" });
  });

  it("is not found when no coin matches (recorded empty search)", async () => {
    const { fetch } = fakeFetch(json(recorded("coingecko-search-not-found")));
    expect(await findCoinId("ZZQQXX", { fetch })).toEqual({ status: "not-found" });
  });

  it.each([
    ["HTTP 429", json({ status: { error_code: 429 } }, 429)],
    ["a network error", new TypeError("fetch failed")],
    ["a schema mismatch", json({ coins: [{ id: 1 }] })],
  ])("returns error on %s", async (_label, reply) => {
    const { fetch } = fakeFetch(reply);
    expect(await findCoinId("BTC", { fetch })).toEqual({ status: "error" });
  });
});

describe("coingeckoPrices", () => {
  const CTX = { securityId: "s1", splits: [] };
  // The recorded chart was fetched on 2026-10-26 at 00:15 UTC with days=10.
  const NOW = () => new Date("2026-10-26T00:20:00Z");

  it("dates each point by the UTC date of its instant minus 1 ms (recorded bitcoin chart)", async () => {
    const { fetch, calls } = fakeFetch(json(recorded("coingecko-market-chart-bitcoin")));
    const result = await coingeckoPrices({ fetch, now: NOW }).fetchHistory("bitcoin", "2026-10-16", "2026-10-26", CTX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toHaveLength(11);
    expect(result.value[0]).toEqual({ date: "2026-10-16", close: "72537.3051996502" });
    // The 00:00 UTC point of 2026-10-25 closes 2026-10-24; the one of 2026-10-26 closes 2026-10-25.
    expect(result.value[8]).toEqual({ date: "2026-10-24", close: "72126.50530116288" });
    expect(result.value[9]).toEqual({ date: "2026-10-25", close: "71362.90754813094" });
    // The intraday point dates today.
    expect(result.value[10]).toEqual({ date: "2026-10-26", close: "71371.56349320017" });
    // Privacy (AD-13): only the coin id and a day count; no key header without a key.
    expect(calls).toEqual([
      {
        url: "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=11&interval=daily",
        method: "GET",
        headers: { accept: "application/json" },
        body: undefined,
      },
    ]);
  });

  it("limits closes to the requested range", async () => {
    const { fetch } = fakeFetch(json(recorded("coingecko-market-chart-bitcoin")));
    const result = await coingeckoPrices({ fetch, now: NOW }).fetchHistory("bitcoin", "2026-10-20", "2026-10-21", CTX);
    expect(result).toEqual({
      ok: true,
      value: [
        { date: "2026-10-20", close: "73884.45739183653" },
        { date: "2026-10-21", close: "74846.24990354716" },
      ],
    });
  });

  it.each([
    ["2026-10-26", 1],
    ["2026-10-27", 1],
    ["2025-10-27", 365],
    ["2024-01-01", 365],
  ])("requests days for from %s as %i (clamped to 1..365)", async (from, days) => {
    const { fetch, calls } = fakeFetch(json(recorded("coingecko-market-chart-bitcoin")));
    await coingeckoPrices({ fetch, now: NOW }).fetchHistory("bitcoin", from, "2026-10-26", CTX);
    expect(calls[0].url).toContain(`days=${days}&`);
  });

  it("sends the demo key header only when set", async () => {
    const { fetch, calls } = fakeFetch(json(recorded("coingecko-market-chart-bitcoin")));
    await coingeckoPrices({ fetch, apiKey: "demo-key", now: NOW }).fetchHistory("bitcoin", "2026-10-16", "2026-10-26", CTX);
    expect(calls[0].headers["x-cg-demo-api-key"]).toBe("demo-key");
  });

  it.each([
    ["the recorded 404", json(recorded("coingecko-market-chart-not-found"), 404), "not-found"],
    ["HTTP 429", json({ status: { error_code: 429 } }, 429), "network"],
    ["a network error", new TypeError("fetch failed"), "network"],
    ["a schema mismatch", json({ prices: [["x", 1]] }), "schema"],
    ["no prices", json({ prices: [] }), "not-found"],
  ])("maps %s", async (_label, reply, reason) => {
    const { fetch } = fakeFetch(reply);
    expect(await coingeckoPrices({ fetch, now: NOW }).fetchHistory("nope", "2026-10-16", "2026-10-26", CTX)).toEqual({ ok: false, reason });
  });

  it("fetchLatest returns the newest close", async () => {
    const { fetch } = fakeFetch(json(recorded("coingecko-market-chart-bitcoin")));
    expect(await coingeckoPrices({ fetch, now: NOW }).fetchLatest("bitcoin", CTX)).toEqual({
      ok: true,
      value: { date: "2026-10-26", close: "71371.56349320017" },
    });
  });
});
