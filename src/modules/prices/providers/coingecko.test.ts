import { describe, expect, it } from "vitest";
import { fakeFetch, json, recorded } from "../../../../test/helpers/providers";
import { findCoinId } from "./coingecko";

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
