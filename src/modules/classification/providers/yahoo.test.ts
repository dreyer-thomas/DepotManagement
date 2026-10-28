import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorded } from "../../../../test/helpers/providers";
import {
  ANALYST_MODULES,
  analystRatingsOf,
  fetchProfile,
  fetchQuoteSummary,
  findHomeListing,
  KEY_FIGURE_MODULES,
  keyFiguresOf,
  type YahooQuoteSummary,
  type YahooSearch,
} from "./yahoo";

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

describe("fetchQuoteSummary", () => {
  it("sends only the symbol with the given modules", async () => {
    const quoteSummary = serving(recorded("yahoo-quotesummary-keyfigures-sap-de"));
    expect(await fetchQuoteSummary("SAP.DE", KEY_FIGURE_MODULES, { quoteSummary })).toMatchObject({ status: "found" });
    const [symbol, query, options] = quoteSummary.mock.calls[0];
    expect(symbol).toBe("SAP.DE");
    expect(query).toEqual({ modules: ["summaryDetail", "defaultKeyStatistics", "financialData", "calendarEvents", "fundProfile"] });
    expect(JSON.stringify([query, { ...options, fetchOptions: {} }])).not.toMatch(/SAP|DE000/);
  });

  it("is not-found for Yahoo's 'no data' and an error for anything else", async () => {
    expect(await fetchQuoteSummary("XXX.DE", KEY_FIGURE_MODULES, { quoteSummary: serving(new Error("Quote not found for symbol: XXX.DE")) })).toEqual({
      status: "not-found",
    });
    expect(await fetchQuoteSummary("SAP.DE", KEY_FIGURE_MODULES, { quoteSummary: serving(new TypeError("fetch failed")) })).toEqual({
      status: "error",
    });
  });
});

describe("keyFiguresOf", () => {
  it("German stock: every group as decimal strings and business dates", () => {
    expect(keyFiguresOf(recorded("yahoo-quotesummary-keyfigures-sap-de"), "stock", "2026-10-28")).toEqual({
      status: "found",
      value: {
        trailingPE: "30.4321",
        forwardPE: "24.1",
        priceToBook: "6.5432",
        priceToSales: "6.789",
        pegRatio: "1.87",
        marketCap: "243770000000",
        marketCapCurrency: "EUR",
        revenue: "35900000000",
        revenueCurrency: "EUR",
        dividendYield: "0.0118",
        payoutRatio: "0.4512",
        exDividendDate: "2026-05-15",
        profitMargin: "0.1987",
        returnOnEquity: "0.1534",
        revenueGrowth: "0.091",
        debtToEquity: "22.789",
        beta: "0.987",
        nextEarningsDate: "2027-01-28",
        fundFamily: null,
        expenseRatio: null,
        inceptionDate: null,
      },
    });
  });

  it("foreign stock on a DE listing: no forward KGV, revenue keeps its own currency", () => {
    const result = keyFiguresOf(recorded("yahoo-quotesummary-keyfigures-apc-de"), "stock", "2026-10-28");
    expect(result).toMatchObject({
      status: "found",
      value: { forwardPE: null, marketCap: "3250000000000", marketCapCurrency: "EUR", revenue: "466820000000", revenueCurrency: "USD" },
    });
  });

  it("ETF: fund family, TER and inception date only", () => {
    const result = keyFiguresOf(recorded("yahoo-quotesummary-keyfigures-eunl-de"), "fund", "2026-10-28");
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.value).toMatchObject({ fundFamily: "iShares", expenseRatio: "0.002", inceptionDate: "2009-09-25" });
    const { fundFamily, expenseRatio, inceptionDate, ...rest } = result.value;
    expect([fundFamily, expenseRatio, inceptionDate]).not.toContain(null);
    expect(Object.values(rest).every((value) => value === null)).toBe(true);
  });

  it("accepts Date objects and epoch seconds; falls back to defaultKeyStatistics", () => {
    const result = keyFiguresOf(
      {
        summaryDetail: { exDividendDate: new Date("2026-05-14T22:30:00.000Z"), trailingPE: "x" },
        defaultKeyStatistics: { forwardPE: 12.5, fundInceptionDate: 1253836800, annualReportExpenseRatio: 0.0007, fundFamily: "Vanguard" },
        calendarEvents: { earnings: { earningsDate: [1801641600, "garbage"] } },
      },
      "stock",
      "2026-10-28",
    );
    expect(result).toMatchObject({
      status: "found",
      value: { exDividendDate: "2026-05-15", trailingPE: null, forwardPE: "12.5", nextEarningsDate: "2027-02-03" },
    });
    expect(keyFiguresOf({ defaultKeyStatistics: { fundInceptionDate: 1253836800, annualReportExpenseRatio: 0.0007, fundFamily: "Vanguard" } }, "fund", "2026-10-28")).toMatchObject({
      value: { inceptionDate: "2009-09-25", expenseRatio: "0.0007", fundFamily: "Vanguard" },
    });
  });

  it("next earnings date: the earliest on or after the fetch day, else the latest delivered", () => {
    const earnings = (dates: string[]) => ({ calendarEvents: { earnings: { earningsDate: dates } } });
    expect(keyFiguresOf(earnings(["2026-07-25T06:00:00.000Z", "2026-10-30T06:00:00.000Z", "2027-01-28T06:00:00.000Z"]), "stock", "2026-10-28")).toMatchObject({
      value: { nextEarningsDate: "2026-10-30" },
    });
    expect(keyFiguresOf(earnings(["2026-10-28T06:00:00.000Z"]), "stock", "2026-10-28")).toMatchObject({ value: { nextEarningsDate: "2026-10-28" } });
    expect(keyFiguresOf(earnings(["2026-04-25T06:00:00.000Z", "2026-07-25T06:00:00.000Z"]), "stock", "2026-10-28")).toMatchObject({
      value: { nextEarningsDate: "2026-07-25" },
    });
  });

  it("a response without any module is all null; a malformed response is an error", () => {
    const empty = keyFiguresOf({}, "stock", "2026-10-28");
    expect(empty.status).toBe("found");
    if (empty.status === "found") expect(Object.values(empty.value).every((value) => value === null)).toBe(true);
    expect(keyFiguresOf("<html>", "stock", "2026-10-28")).toEqual({ status: "error" });
  });
});

describe("analystRatingsOf", () => {
  it("German stock: trend oldest → current, targets in the listing's currency, last 10 changes newest first", () => {
    const result = analystRatingsOf(recorded("yahoo-quotesummary-analysts-sap-de"));
    expect(result.status).toBe("found");
    if (result.status !== "found" || result.value === null) throw new Error("expected ratings");
    const ratings = result.value;
    expect(ratings.trend.map((month) => month.period)).toEqual(["-3m", "-2m", "-1m", "0m"]);
    expect(ratings.trend[3]).toEqual({ period: "0m", strongBuy: 11, buy: 20, hold: 14, sell: 3, strongSell: 1 });
    expect(ratings.analystCount).toBe(51);
    expect(ratings.consensusMean).toBe("1.85");
    expect(ratings.target).toEqual({ low: "200", mean: "270", median: "272.5", high: "310", currentPrice: "240", currency: "EUR" });
    expect(ratings.changes).toHaveLength(10);
    expect(ratings.changes[0]).toEqual({
      date: "2026-10-21",
      firm: "Synthetic Securities",
      fromGrade: "Hold",
      toGrade: "Buy",
      action: "up",
      priceTargetFrom: "250",
      priceTargetTo: "270",
    });
    // An empty fromGrade and a prior target of 0 are "not delivered".
    expect(ratings.changes[1]).toMatchObject({ date: "2026-10-02", fromGrade: null, priceTargetFrom: null, priceTargetTo: "290" });
    expect(ratings.changes.map((change) => change.date)).toEqual([...ratings.changes.map((change) => change.date)].sort().reverse());
    expect(ratings.changes.at(-1)?.firm).toBe("Firm 10");
  });

  it("home listing in USD: currency from price, epoch-second dates", () => {
    const result = analystRatingsOf(recorded("yahoo-quotesummary-analysts-aapl"));
    if (result.status !== "found" || result.value === null) throw new Error("expected ratings");
    expect(result.value.target).toMatchObject({ mean: "245", currentPrice: "217.5", currency: "USD" });
    expect(result.value.changes[0]).toMatchObject({ date: "2026-10-21", toGrade: "Overweight" });
  });

  it("falls back to summaryDetail's currency and tolerates odd entries", () => {
    const result = analystRatingsOf({
      summaryDetail: { currency: "CHF" },
      financialData: { targetMeanPrice: 90, numberOfAnalystOpinions: 2.5 },
      recommendationTrend: { trend: [{ period: "0m", strongBuy: -1, buy: "x", hold: 2 }, "junk"] },
      upgradeDowngradeHistory: { history: [{ firm: "No date", toGrade: "Buy" }, null] },
    });
    if (result.status !== "found" || result.value === null) throw new Error("expected ratings");
    expect(result.value).toMatchObject({
      trend: [{ period: "0m", strongBuy: 0, buy: 0, hold: 2, sell: 0, strongSell: 0 }],
      analystCount: null,
      consensusMean: null,
      target: { mean: "90", currency: "CHF" },
      changes: [],
    });
  });

  it("null without data worth showing; a malformed response is an error", () => {
    expect(analystRatingsOf({})).toEqual({ status: "found", value: null });
    expect(analystRatingsOf({ recommendationTrend: { trend: [{ period: "0m", strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0 }] } })).toEqual({
      status: "found",
      value: null,
    });
    expect(analystRatingsOf("<html>")).toEqual({ status: "error" });
  });

  it("the analyst request sends only the symbol with the analyst modules", async () => {
    const quoteSummary = serving(recorded("yahoo-quotesummary-analysts-aapl"));
    expect(await fetchQuoteSummary("AAPL", ANALYST_MODULES, { quoteSummary })).toMatchObject({ status: "found" });
    const [symbol, query, options] = quoteSummary.mock.calls[0];
    expect(symbol).toBe("AAPL");
    expect(query).toEqual({ modules: ["financialData", "summaryDetail", "price", "recommendationTrend", "upgradeDowngradeHistory"] });
    expect(JSON.stringify([query, { ...options, fetchOptions: {} }])).not.toMatch(/AAPL|US037/);
    expect(await fetchQuoteSummary("XXX", ANALYST_MODULES, { quoteSummary: serving(new Error("Quote not found for symbol: XXX")) })).toEqual({
      status: "not-found",
    });
  });
});

describe("findHomeListing", () => {
  function searching(reply: unknown | Error) {
    return vi.fn<YahooSearch>(async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    });
  }

  it("US ISIN on a DE listing: the suffix-less US quote; only the ISIN is sent", async () => {
    const search = searching(recorded("yahoo-search-apple"));
    expect(await findHomeListing("US0378331005", "APC.DE", { search })).toEqual({ status: "found", value: "AAPL" });
    expect(search.mock.calls).toEqual([["US0378331005"]]);
  });

  it("picks the quote with the ISIN country's suffix", async () => {
    const reply = { quotes: [{ symbol: "SAP" }, { symbol: "SAP.F" }, { symbol: "sap.de" }] };
    expect(await findHomeListing("DE0007164600", "SAP.F", { search: searching(reply) })).toEqual({ status: "found", value: "SAP.DE" });
    const nestle = { quotes: [{ symbol: "NSRGY" }, { symbol: "NESN.SW" }] };
    expect(await findHomeListing("CH0038863350", "NESR.DE", { search: searching(nestle) })).toEqual({ status: "found", value: "NESN.SW" });
  });

  it("else the first suffix-less quote, else the mapping symbol; ignores non-Yahoo and invalid symbols", async () => {
    const adrOnly = { quotes: [{ symbol: "XYZ.F" }, { symbol: "XYZY" }] };
    expect(await findHomeListing("NL0000000001", "XYZ.F", { search: searching(adrOnly) })).toEqual({ status: "found", value: "XYZY" });
    const nothing = { quotes: [{ symbol: "APPLE", isYahooFinance: false }, { symbol: "bad symbol" }, { name: "no symbol" }] };
    expect(await findHomeListing("US0378331005", "apc.de", { search: searching(nothing) })).toEqual({ status: "found", value: "APC.DE" });
    expect(await findHomeListing("US0378331005", "APC.DE", { search: searching(recorded("yahoo-search-not-found")) })).toEqual({
      status: "found",
      value: "APC.DE",
    });
  });

  it("is an error for a thrown or malformed response", async () => {
    expect(await findHomeListing("US0378331005", "APC.DE", { search: searching(new TypeError("fetch failed")) })).toEqual({ status: "error" });
    expect(await findHomeListing("US0378331005", "APC.DE", { search: searching("<html>") })).toEqual({ status: "error" });
  });
});
