import { describe, expect, it, vi } from "vitest";
import { recorded } from "../../../../test/helpers/providers";
import { findGermanListing } from "./yahoo";

const searchReturning = (body: unknown) => vi.fn(async () => body);

describe("findGermanListing", () => {
  it("returns the .DE quote (recorded Xtrackers MSCI World search)", async () => {
    const search = searchReturning(recorded("yahoo-search-xtrackers-msci-world"));
    expect(await findGermanListing("LU0274208692", { search })).toEqual({ status: "found", value: "DBXW.DE" });
    // Privacy (AD-13): only the ISIN is sent.
    expect(search).toHaveBeenCalledWith("LU0274208692");
  });

  it("is not found when Yahoo lists no German quote (recorded iShares Core MSCI World search)", async () => {
    const search = searchReturning(recorded("yahoo-search-ishares-core-msci-world"));
    expect(await findGermanListing("IE00B4L5Y983", { search })).toEqual({ status: "not-found" });
  });

  it("is not found without quotes (recorded empty search)", async () => {
    expect(await findGermanListing("XS0000000000", { search: searchReturning(recorded("yahoo-search-not-found")) })).toEqual({
      status: "not-found",
    });
  });

  it("prefers .DE over an earlier .F quote, and falls back to .F", async () => {
    const quotes = (...symbols: string[]) => ({ quotes: symbols.map((symbol) => ({ symbol, isYahooFinance: true })) });
    expect(await findGermanListing("X", { search: searchReturning(quotes("ABC.L", "ABC.F", "ABC.DE")) })).toEqual({
      status: "found",
      value: "ABC.DE",
    });
    expect(await findGermanListing("X", { search: searchReturning(quotes("ABC.L", "ABC.F", "ABD.F")) })).toEqual({
      status: "found",
      value: "ABC.F",
    });
  });

  it("skips quotes Yahoo flags as not priceable (isYahooFinance: false)", async () => {
    const search = searchReturning({
      quotes: [
        { symbol: "ABC.DE", isYahooFinance: false },
        { symbol: "ABC.F", isYahooFinance: true },
      ],
    });
    expect(await findGermanListing("X", { search })).toEqual({ status: "found", value: "ABC.F" });
    expect(await findGermanListing("X", { search: searchReturning({ quotes: [{ symbol: "ABC.DE", isYahooFinance: false }] }) })).toEqual({
      status: "not-found",
    });
  });

  it.each([
    ["a thrown error", vi.fn(async () => Promise.reject(new Error("HTTP 429")))],
    ["a schema mismatch", searchReturning({ quotes: "nope" })],
  ])("returns error on %s", async (_label, search) => {
    expect(await findGermanListing("LU0274208692", { search })).toEqual({ status: "error" });
  });
});
