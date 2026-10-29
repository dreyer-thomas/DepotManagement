import { describe, expect, it } from "vitest";
import { type FetchCall, fakeFetch, json, recorded } from "../../../../test/helpers/providers";
import { onvistaPrices } from "./onvista";

const ISIN = "DE000A0S9GB0";
const CTX = { securityId: "s1", splits: [] };
const QUERY_URL = `https://api.onvista.de/api/v1/instruments/query?searchValue=${ISIN}`;
const EOD_URL = "https://api.onvista.de/api/v1/instruments/DERIVATIVE/18869269/eod_history?range=MAX&startDate=2026-10-01";

/** Routes query and eod requests to the given replies. */
function routes(query: Response | Error, eod: Response | Error = json(recorded("onvista-eod-xetra-gold"))) {
  return (call: FetchCall) => (call.url.includes("/query?") ? query : eod);
}

describe("onvistaPrices", () => {
  it("returns the recorded EUR closes and sends only the ISIN, instrument id and start date", async () => {
    const { fetch, calls } = fakeFetch(routes(json(recorded("onvista-query-xetra-gold"))));
    const result = await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-23", CTX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toHaveLength(17);
    expect(result.value[0]).toEqual({ date: "2026-10-01", close: "119.05" });
    expect(result.value[16]).toEqual({ date: "2026-10-23", close: "114.81" });
    expect(result.value.map((close) => close.date)).toEqual([...result.value.map((close) => close.date)].sort());
    expect(calls).toEqual([
      { url: QUERY_URL, method: "GET", headers: { accept: "application/json" }, body: undefined },
      { url: EOD_URL, method: "GET", headers: { accept: "application/json" }, body: undefined },
    ]);
  });

  it("limits closes to the requested range", async () => {
    const { fetch } = fakeFetch(routes(json(recorded("onvista-query-xetra-gold"))));
    const result = await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-05", CTX);
    expect(result).toEqual({
      ok: true,
      value: [
        { date: "2026-10-01", close: "119.05" },
        { date: "2026-10-02", close: "118.35" },
        { date: "2026-10-05", close: "118.69" },
      ],
    });
  });

  it("is not found for an unknown ISIN without a history request (recorded empty query)", async () => {
    const { fetch, calls } = fakeFetch(routes(json(recorded("onvista-query-not-found"))));
    expect(await onvistaPrices({ fetch }).fetchHistory("DE000ZZ00000", "2026-10-01", "2026-10-23", CTX)).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(calls).toHaveLength(1);
  });

  it("skips query entries of another ISIN or with an invalid instrument id", async () => {
    const query = json({
      list: [
        { isin: "DE000XXXXXX0", entityType: "DERIVATIVE", entityValue: "1" },
        { isin: ISIN.toLowerCase(), entityType: "DERIVATIVE", entityValue: "../x" },
      ],
    });
    const { fetch, calls } = fakeFetch(routes(query));
    expect(await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-23", CTX)).toEqual({ ok: false, reason: "not-found" });
    expect(calls).toHaveLength(1);
  });

  it("rejects a non-EUR listing", async () => {
    const eod = { ...(recorded("onvista-eod-xetra-gold") as object), isoCurrency: "USD" };
    const { fetch } = fakeFetch(routes(json(recorded("onvista-query-xetra-gold")), json(eod)));
    expect(await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-23", CTX)).toEqual({ ok: false, reason: "currency" });
  });

  it("skips eod entries with a null close or timestamp", async () => {
    const base = recorded("onvista-eod-xetra-gold") as { datetimeLast: (number | null)[]; last: (number | null)[] };
    const last = [...base.last];
    last[1] = null;
    const datetimeLast = [...base.datetimeLast];
    datetimeLast[2] = null;
    const eod = { ...base, datetimeLast, last };
    const { fetch } = fakeFetch(routes(json(recorded("onvista-query-xetra-gold")), json(eod)));
    const result = await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-23", CTX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toHaveLength(15);
    const dates = result.value.map((close) => close.date);
    expect(dates).not.toContain("2026-10-02");
    expect(dates).not.toContain("2026-10-05");
    expect(result.value[0]).toEqual({ date: "2026-10-01", close: "119.05" });
    expect(result.value[14]).toEqual({ date: "2026-10-23", close: "114.81" });
  });

  it.each([
    ["close", "last", 1, "2026-10-02"],
    ["timestamp", "datetimeLast", 2, "2026-10-05"],
  ] as const)("skips only the day with a null %s", async (_label, field, index, date) => {
    const base = recorded("onvista-eod-xetra-gold") as Record<"datetimeLast" | "last", (number | null)[]>;
    const values = [...base[field]];
    values[index] = null;
    const { fetch } = fakeFetch(routes(json(recorded("onvista-query-xetra-gold")), json({ ...base, [field]: values })));
    const result = await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-23", CTX);
    if (!result.ok) throw new Error(result.reason);
    expect(result.value).toHaveLength(16);
    expect(result.value.map((close) => close.date)).not.toContain(date);
  });

  it("is not found when every eod entry is null", async () => {
    const eod = json({ isoCurrency: "EUR", datetimeLast: [null], last: [null] });
    const { fetch } = fakeFetch(routes(json(recorded("onvista-query-xetra-gold")), eod));
    expect(await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-23", CTX)).toEqual({ ok: false, reason: "not-found" });
  });

  it.each([
    ["a malformed query", json({ list: "nope" }), json(recorded("onvista-eod-xetra-gold"))],
    ["arrays of different length", json(recorded("onvista-query-xetra-gold")), json({ isoCurrency: "EUR", datetimeLast: [1], last: [] })],
    ["arrays of different length with null entries", json(recorded("onvista-query-xetra-gold")), json({ isoCurrency: "EUR", datetimeLast: [null], last: [] })],
    ["a non-number close", json(recorded("onvista-query-xetra-gold")), json({ isoCurrency: "EUR", datetimeLast: [1], last: ["1.0"] })],
    ["a non-JSON eod", json(recorded("onvista-query-xetra-gold")), new Response("<html>", { status: 200 })],
  ])("returns schema on %s", async (_label, query, eod) => {
    const { fetch } = fakeFetch(routes(query, eod));
    expect(await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-23", CTX)).toEqual({ ok: false, reason: "schema" });
  });

  it.each([
    ["HTTP 404 on the query", json({}, 404), json(recorded("onvista-eod-xetra-gold")), "not-found"],
    ["HTTP 404 on the history", json(recorded("onvista-query-xetra-gold")), json({}, 404), "not-found"],
    ["HTTP 429", json({}, 429), json({}, 429), "network"],
    ["a network error", new TypeError("fetch failed"), new TypeError("fetch failed"), "network"],
    ["a network error on the history", json(recorded("onvista-query-xetra-gold")), new TypeError("fetch failed"), "network"],
  ])("maps %s", async (_label, query, eod, reason) => {
    const { fetch } = fakeFetch(routes(query, eod));
    expect(await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-10-01", "2026-10-23", CTX)).toEqual({ ok: false, reason });
  });

  it("is not found when no close falls in the range", async () => {
    const { fetch } = fakeFetch(routes(json(recorded("onvista-query-xetra-gold"))));
    expect(await onvistaPrices({ fetch }).fetchHistory(ISIN, "2026-09-01", "2026-09-30", CTX)).toEqual({ ok: false, reason: "not-found" });
  });

  it("fetchLatest returns the last close of the last 7 days", async () => {
    const { fetch, calls } = fakeFetch(routes(json(recorded("onvista-query-xetra-gold"))));
    const adapter = onvistaPrices({ fetch, now: () => new Date("2026-10-26T08:00:00Z") });
    expect(await adapter.fetchLatest(ISIN, CTX)).toEqual({ ok: true, value: { date: "2026-10-23", close: "114.81" } });
    expect(calls[1].url).toContain("startDate=2026-10-19");
  });
});
