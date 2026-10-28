import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recorded } from "../../../../test/helpers/providers";
import { fetchProfile, fetchQuoteSummary, KEY_FIGURE_MODULES, keyFiguresOf, type YahooQuoteSummary } from "./yahoo";

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
