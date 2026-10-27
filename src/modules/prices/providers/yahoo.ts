// Yahoo Finance: search by ISIN (fallback for Securities without a Xetra listing on OpenFIGI) and daily
// prices via `chart()` (AD-9). Only the ISIN, resp. the provider symbol and date range, leave the server (AD-13).
import { z } from "zod";
import { unadjustSplitPrice } from "@/core/corporate-actions";
import { addDays, businessDate } from "@/core/dates";
import { ERROR, type Lookup, NOT_FOUND, PROVIDER_TIMEOUT_MS } from "./shared";
import type { DailyClose, PriceAdapter, PriceFetch, PriceFetchContext, PriceFetchFailure } from "./types";

/** Runs a Yahoo search for the query and returns the raw (unvalidated) response. */
export type YahooSearch = (query: string) => Promise<unknown>;

const SYMBOL = /^[A-Za-z0-9.^=_-]{1,40}$/;

const searchSchema = z
  .object({ quotes: z.array(z.object({ symbol: z.string().optional(), isYahooFinance: z.boolean().optional() }).loose()) })
  .loose();

type YahooClient = InstanceType<typeof import("yahoo-finance2").default>;

let client: Promise<YahooClient> | undefined;

function yahooClient(): Promise<YahooClient> {
  client ??= import("yahoo-finance2").then(
    ({ default: YahooFinance }) => new YahooFinance({ suppressNotices: ["yahooSurvey"] }),
    (error: unknown) => {
      client = undefined;
      throw error;
    },
  );
  return client;
}

/** The real search: `yahoo-finance2` (loaded on first use); the result is validated by our own schema. */
export const yahooSearch: YahooSearch = async (query) => {
  const yahoo = await yahooClient();
  return yahoo.search(
    query,
    { quotesCount: 10, newsCount: 0 },
    { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) } },
  );
};

/**
 * Finds a German listing of the ISIN: the first `.DE` (Xetra) quote, else the first `.F` (Frankfurt)
 * quote, else not found. A thrown or malformed response is an error.
 */
export async function findGermanListing(isin: string, { search = yahooSearch }: { search?: YahooSearch } = {}): Promise<Lookup<string>> {
  let raw: unknown;
  try {
    raw = await search(isin);
  } catch (error) {
    console.warn(`Yahoo search: request failed (${error instanceof Error ? error.name : "unknown"}) for ${isin}`);
    return ERROR;
  }
  const parsed = searchSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`Yahoo search: schema mismatch for ${isin}`);
    return ERROR;
  }
  // Quotes flagged `isYahooFinance: false` (e.g. Crunchbase entities) cannot be priced via Yahoo.
  const symbols = parsed.data.quotes
    .filter((quote) => quote.isYahooFinance !== false)
    .map((quote) => quote.symbol?.trim().toUpperCase())
    .filter((symbol): symbol is string => Boolean(symbol && SYMBOL.test(symbol)));
  const symbol = symbols.find((s) => s.endsWith(".DE")) ?? symbols.find((s) => s.endsWith(".F"));
  return symbol ? { status: "found", value: symbol } : NOT_FOUND;
}

/** Query of a daily `chart()` request: `period1` inclusive, `period2` exclusive (`YYYY-MM-DD`, UTC midnight). */
export type YahooChartQuery = { period1: string; period2: string; interval: "1d" };
export type YahooChartOptions = { validateResult: false; fetchOptions: { signal: AbortSignal } };

/** Runs a Yahoo `chart()` request and returns the raw (unvalidated) array-form result. */
export type YahooChart = (symbol: string, query: YahooChartQuery, options: YahooChartOptions) => Promise<unknown>;

/** The real chart: `yahoo-finance2` (loaded on first use); the result is validated by our own schema. */
export const yahooChart: YahooChart = async (symbol, query, options) => {
  const yahoo = await yahooClient();
  return yahoo.chart(symbol, query, options);
};

const chartSchema = z
  .object({
    meta: z
      .object({
        currency: z.string(),
        regularMarketPrice: z.number().nullable().optional().catch(undefined),
        // A Date from yahoo-finance2, epoch seconds in the raw response.
        regularMarketTime: z
          .preprocess((value) => (typeof value === "number" ? value * 1000 : value), z.coerce.date())
          .optional()
          .catch(undefined),
      })
      .loose(),
    quotes: z.array(z.object({ date: z.coerce.date(), close: z.number().nullable().optional() }).loose()),
  })
  .loose();

/** A thrown `chart()` error: Yahoo's "no data" answers (unknown / delisted symbol, empty range) are `not-found`. */
function thrownReason(error: unknown): PriceFetchFailure {
  if (!(error instanceof Error)) return "unexpected";
  if (error.name === "BadRequestError" || /no data found|doesn't exist/i.test(error.message)) return "not-found";
  if (error.name === "InvalidOptionsError" || error.name === "NoEnvironmentError") return "unexpected";
  return "network";
}

/**
 * Yahoo price adapter. Yahoo closes are split-adjusted (not dividend-adjusted); every close is restored
 * to the as-traded close with the Security's recorded splits (`unadjustSplitPrice`, 4 dp). Only EUR
 * listings are accepted (no conversion). Bars are dated by their Europe/Berlin business date (the last
 * bar of a date wins) and limited to the requested range; null closes are dropped. Yahoo often leaves the
 * close of the current day's bar null while `meta.regularMarketPrice` already carries it: a null-close bar
 * of the same business date as `meta.regularMarketTime` takes that price (a later refresh overwrites it).
 */
export function yahooPrices({ chart = yahooChart, now = () => new Date() }: { chart?: YahooChart; now?: () => Date } = {}): PriceAdapter {
  async function fetchHistory(symbol: string, from: string, to: string, ctx: PriceFetchContext): Promise<PriceFetch<DailyClose[]>> {
    let raw: unknown;
    try {
      raw = await chart(
        symbol,
        { period1: from, period2: addDays(to, 1), interval: "1d" },
        { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) } },
      );
    } catch (error) {
      return { ok: false, reason: thrownReason(error) };
    }
    const parsed = chartSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "schema" };
    if (parsed.data.meta.currency !== "EUR") return { ok: false, reason: "currency" };
    try {
      const { regularMarketPrice, regularMarketTime } = parsed.data.meta;
      const marketDate = regularMarketTime ? businessDate(regularMarketTime) : undefined;
      const byDate = new Map<string, number>();
      for (const quote of parsed.data.quotes) {
        const date = businessDate(quote.date);
        if (date < from || date > to) continue;
        const close = quote.close ?? (date === marketDate ? regularMarketPrice : null);
        if (close === null || close === undefined || !(close > 0)) continue;
        byDate.set(date, close);
      }
      if (byDate.size === 0) return { ok: false, reason: "not-found" };
      const closes = [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, close]) => ({ date, close: unadjustSplitPrice(ctx.securityId, date, String(close), ctx.splits) }));
      return { ok: true, value: closes };
    } catch {
      return { ok: false, reason: "unexpected" };
    }
  }

  return {
    fetchHistory,
    async fetchLatest(symbol, ctx) {
      const today = businessDate(now());
      const history = await fetchHistory(symbol, addDays(today, -7), today, ctx);
      return history.ok ? { ok: true, value: history.value[history.value.length - 1] } : history;
    },
  };
}
