import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorded } from "../../../../test/helpers/providers";
import { fetchProfile, type YahooQuoteSummary } from "./yahoo";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function serving(reply: unknown | Error) {
  const quoteSummary = vi.fn<YahooQuoteSummary>(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return quoteSummary;
}

describe("fetchProfile", () => {
  it("reads sector, industry, country, market cap and currency; only the symbol is sent", async () => {
    const quoteSummary = serving(recorded("yahoo-quotesummary-sap-de"));
    expect(await fetchProfile("SAP.DE", { quoteSummary })).toEqual({
      status: "found",
      value: {
        sector: "Technology",
        industry: "Software—Application",
        country: "Germany",
        marketCap: "200000000000",
        currency: "EUR",
      },
    });
    expect(quoteSummary).toHaveBeenCalledTimes(1);
    const [symbol, query, options] = quoteSummary.mock.calls[0];
    expect(symbol).toBe("SAP.DE");
    expect(query).toEqual({ modules: ["assetProfile", "price"] });
    expect(options.validateResult).toBe(false);
    expect(options.fetchOptions.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify([query, { ...options, fetchOptions: {} }])).not.toMatch(/SAP|DE000/);
  });

  it("is not-found without an assetProfile", async () => {
    expect(await fetchProfile("EUNL.DE", { quoteSummary: serving(recorded("yahoo-quotesummary-no-profile")) })).toEqual({
      status: "not-found",
    });
  });

  it("is not-found for Yahoo's 'Quote not found' error", async () => {
    const error = new Error("Quote not found for symbol: XXX.DE");
    expect(await fetchProfile("XXX.DE", { quoteSummary: serving(error) })).toEqual({ status: "not-found" });
  });

  it("is an error (retried later) for a plain 'Not Found' HTTP error", async () => {
    expect(await fetchProfile("SAP.DE", { quoteSummary: serving(new Error("Not Found")) })).toEqual({ status: "error" });
  });

  it("is not-found for Yahoo's 'No fundamentals data' error", async () => {
    const error = new Error("No fundamentals data found for symbol: EUNL.DE");
    expect(await fetchProfile("EUNL.DE", { quoteSummary: serving(error) })).toEqual({ status: "not-found" });
  });

  it("is not-found for Yahoo's BadRequestError and 'doesn't exist' answers", async () => {
    const badRequest = Object.assign(new Error("Invalid request"), { name: "BadRequestError" });
    expect(await fetchProfile("XXX.DE", { quoteSummary: serving(badRequest) })).toEqual({ status: "not-found" });
    const missing = new Error("Data doesn't exist for symbol XXX.DE");
    expect(await fetchProfile("XXX.DE", { quoteSummary: serving(missing) })).toEqual({ status: "not-found" });
  });

  it("is an error for a network failure or a malformed response", async () => {
    expect(await fetchProfile("SAP.DE", { quoteSummary: serving(new TypeError("fetch failed")) })).toEqual({ status: "error" });
    expect(await fetchProfile("SAP.DE", { quoteSummary: serving("<html>") })).toEqual({ status: "error" });
  });

  it("tolerates missing or odd fields", async () => {
    const result = await fetchProfile("X.DE", {
      quoteSummary: serving({ assetProfile: { sector: 3, country: "Canada" }, price: { marketCap: "big" } }),
    });
    expect(result).toEqual({
      status: "found",
      value: { sector: null, industry: null, country: "Canada", marketCap: null, currency: null },
    });
  });
});
