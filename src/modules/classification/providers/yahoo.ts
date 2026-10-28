// Yahoo Finance `quoteSummary` (AD-20): sector, industry, country, market cap and currency of a stock, the
// key figures of a stock, ETF or fund (story 9.6) and the analyst ratings of a stock (story 9.7) — one
// request can carry all of them. Yahoo `search` by ISIN finds a stock's home listing (the Analysten-Symbol).
// Only the Yahoo symbol (ticker) or the ISIN leaves the server (AD-13). The classification module keeps its
// own lazily loaded client (modules do not share internals).
import { z } from "zod";
import { type AnalystChange, type AnalystRatings, hasAnalystData, MAX_ANALYST_CHANGES, TREND_PERIODS } from "@/core/analyst-ratings";
import type { ProviderProfile } from "@/core/classification";
import { businessDate, isBusinessDate } from "@/core/dates";
import { emptyKeyFigures, type ProviderKeyFigures } from "@/core/key-figures";

/** Timeout of the outbound request. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** Result of a provider lookup: a value, a definitive miss, or a transient failure (retry later). */
export type Lookup<T> = { status: "found"; value: T } | { status: "not-found" } | { status: "error" };

/** The `quoteSummary` modules this app asks for. */
export type QuoteSummaryModule =
  | "assetProfile"
  | "price"
  | "summaryDetail"
  | "defaultKeyStatistics"
  | "financialData"
  | "calendarEvents"
  | "fundProfile"
  | "recommendationTrend"
  | "upgradeDowngradeHistory";

/** Modules of the classification profile (kept exactly as before story 9.6). */
export const PROFILE_MODULES = ["assetProfile", "price"] as const satisfies readonly QuoteSummaryModule[];
/** Modules of the key figures. */
export const KEY_FIGURE_MODULES = [
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "calendarEvents",
  "fundProfile",
] as const satisfies readonly QuoteSummaryModule[];

/** Modules of the analyst ratings (story 9.7); `price`/`summaryDetail` carry the listing's quote currency. */
export const ANALYST_MODULES = [
  "financialData",
  "summaryDetail",
  "price",
  "recommendationTrend",
  "upgradeDowngradeHistory",
] as const satisfies readonly QuoteSummaryModule[];

export type QuoteSummaryQuery = { modules: QuoteSummaryModule[] };
export type QuoteSummaryOptions = { validateResult: false; fetchOptions: { signal: AbortSignal } };

/** Runs a Yahoo `quoteSummary()` request and returns the raw (unvalidated) result. */
export type YahooQuoteSummary = (symbol: string, query: QuoteSummaryQuery, options: QuoteSummaryOptions) => Promise<unknown>;

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

/** The real request: `yahoo-finance2` (loaded on first use); the result is validated by our own schema. */
export const yahooQuoteSummary: YahooQuoteSummary = async (symbol, query, options) => {
  const yahoo = await yahooClient();
  return yahoo.quoteSummary(symbol, query, options);
};

const text = z.string().nullable().optional().catch(null);

const resultSchema = z
  .object({
    assetProfile: z.object({ sector: text, industry: text, country: text }).loose().nullable().optional(),
    price: z
      .object({ marketCap: z.number().finite().nullable().optional().catch(null), currency: text })
      .loose()
      .nullable()
      .optional(),
  })
  .loose();

/**
 * A thrown `quoteSummary()` error: only Yahoo's explicit "no data" answers (unknown symbol, no profile)
 * are `not-found`; anything else (e.g. an HTTP 404 "Not Found") is transient.
 */
function isNoData(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "BadRequestError" || /quote not found|no fundamentals data|doesn't exist/i.test(error.message);
}

/** Plain decimal string of a finite number (Yahoo market caps are JS numbers). */
function decimalOf(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
}

/**
 * Runs one `quoteSummary` request for `symbol` with `modules` and returns the raw result. Only `symbol` is
 * sent. Yahoo's "no data" errors are `not-found`; any other thrown error is `error` (logged by name only).
 */
export async function fetchQuoteSummary(
  symbol: string,
  modules: readonly QuoteSummaryModule[],
  { quoteSummary = yahooQuoteSummary }: { quoteSummary?: YahooQuoteSummary } = {},
): Promise<Lookup<unknown>> {
  try {
    const raw = await quoteSummary(
      symbol,
      { modules: [...modules] },
      { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) } },
    );
    return { status: "found", value: raw };
  } catch (error) {
    if (isNoData(error)) return { status: "not-found" };
    console.warn(`Classification: Yahoo request failed (${error instanceof Error ? error.name : "unknown"})`);
    return { status: "error" };
  }
}

/**
 * The stock profile in a raw `quoteSummary` result: a response without `assetProfile` is `not-found`, a
 * malformed response `error`.
 */
export function profileOf(raw: unknown): Lookup<ProviderProfile> {
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("Classification: Yahoo schema mismatch");
    return { status: "error" };
  }
  const profile = parsed.data.assetProfile;
  if (!profile) return { status: "not-found" };
  return {
    status: "found",
    value: {
      sector: profile.sector ?? null,
      industry: profile.industry ?? null,
      country: profile.country ?? null,
      marketCap: decimalOf(parsed.data.price?.marketCap),
      currency: parsed.data.price?.currency ?? null,
    },
  };
}

/**
 * The stock profile of a Yahoo symbol. Only `symbol` is sent. A response without `assetProfile` and
 * Yahoo's "no data" errors are `not-found`; any other thrown error or a malformed response is `error`.
 */
export async function fetchProfile(
  symbol: string,
  deps: { quoteSummary?: YahooQuoteSummary } = {},
): Promise<Lookup<ProviderProfile>> {
  const lookup = await fetchQuoteSummary(symbol, PROFILE_MODULES, deps);
  return lookup.status === "found" ? profileOf(lookup.value) : lookup;
}

// ---- Key figures (story 9.6) ----

const num = z.number().finite().nullable().optional().catch(null);
/** A date as yahoo-finance2 delivers it: a `Date`, an ISO string or epoch seconds. */
const dateValue = z.union([z.date(), z.string(), z.number().finite()]).nullable().optional().catch(null);
const section = <T extends z.ZodRawShape>(shape: T) => z.object(shape).loose().nullable().optional().catch(null);

const keyFiguresSchema = z
  .object({
    summaryDetail: section({
      trailingPE: num,
      forwardPE: num,
      priceToSalesTrailing12Months: num,
      dividendYield: num,
      payoutRatio: num,
      exDividendDate: dateValue,
      beta: num,
      marketCap: num,
      currency: text,
    }),
    defaultKeyStatistics: section({
      forwardPE: num,
      priceToBook: num,
      pegRatio: num,
      fundInceptionDate: dateValue,
      fundFamily: text,
      annualReportExpenseRatio: num,
    }),
    financialData: section({
      totalRevenue: num,
      financialCurrency: text,
      profitMargins: num,
      returnOnEquity: num,
      revenueGrowth: num,
      debtToEquity: num,
    }),
    calendarEvents: section({
      earnings: section({ earningsDate: z.array(z.unknown()).nullable().optional().catch(null) }),
    }),
    fundProfile: section({
      family: text,
      feesExpensesInvestment: section({ annualReportExpenseRatio: num }),
    }),
  })
  .loose();

/** Business date (Europe/Berlin) of a `Date`, an ISO string or epoch seconds; `null` when unreadable. */
function dateOf(value: unknown): string | null {
  let instant: Date;
  if (value instanceof Date) instant = value;
  else if (typeof value === "number" && Number.isFinite(value)) instant = new Date(value * 1000);
  else if (typeof value === "string") {
    if (isBusinessDate(value)) return value;
    instant = new Date(value);
  } else return null;
  return Number.isNaN(instant.getTime()) ? null : businessDate(instant);
}

/** A non-empty trimmed text or `null`. */
function textOf(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * The key figures in a raw `quoteSummary` result for a `stock` (valuation, size, dividend, quality, risk,
 * dates) or a `fund` (ETF/fund: family, TER, inception date); the other kind's fields stay `null`. A field
 * Yahoo does not deliver is `null`; `today` (the fetch's business date) picks the next earnings date. A
 * malformed response is `error`.
 */
export function keyFiguresOf(raw: unknown, kind: "stock" | "fund", today: string): Lookup<ProviderKeyFigures> {
  const parsed = keyFiguresSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("Classification: Yahoo key-figures schema mismatch");
    return { status: "error" };
  }
  const { summaryDetail: summary, defaultKeyStatistics: statistics, financialData: financial, calendarEvents, fundProfile } = parsed.data;
  const figures = emptyKeyFigures();
  if (kind === "fund") {
    figures.fundFamily = textOf(fundProfile?.family) ?? textOf(statistics?.fundFamily);
    figures.expenseRatio = decimalOf(fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio ?? statistics?.annualReportExpenseRatio);
    figures.inceptionDate = dateOf(statistics?.fundInceptionDate);
    return { status: "found", value: figures };
  }
  const marketCap = decimalOf(summary?.marketCap);
  const revenue = decimalOf(financial?.totalRevenue);
  const earnings = (calendarEvents?.earnings?.earningsDate ?? [])
    .map(dateOf)
    .filter((date): date is string => date !== null)
    .sort();
  Object.assign(figures, {
    trailingPE: decimalOf(summary?.trailingPE),
    forwardPE: decimalOf(summary?.forwardPE ?? statistics?.forwardPE),
    priceToBook: decimalOf(statistics?.priceToBook),
    priceToSales: decimalOf(summary?.priceToSalesTrailing12Months),
    pegRatio: decimalOf(statistics?.pegRatio),
    marketCap,
    marketCapCurrency: marketCap === null ? null : textOf(summary?.currency),
    revenue,
    revenueCurrency: revenue === null ? null : textOf(financial?.financialCurrency),
    dividendYield: decimalOf(summary?.dividendYield),
    payoutRatio: decimalOf(summary?.payoutRatio),
    exDividendDate: dateOf(summary?.exDividendDate),
    profitMargin: decimalOf(financial?.profitMargins),
    returnOnEquity: decimalOf(financial?.returnOnEquity),
    revenueGrowth: decimalOf(financial?.revenueGrowth),
    debtToEquity: decimalOf(financial?.debtToEquity),
    beta: decimalOf(summary?.beta),
    // The earliest date on or after the fetch day, else the latest delivered one.
    nextEarningsDate: earnings.find((date) => date >= today) ?? earnings.at(-1) ?? null,
  } satisfies Partial<ProviderKeyFigures>);
  return { status: "found", value: figures };
}

// ---- Analyst ratings (story 9.7) ----

/** A count of analysts: a non-negative integer, else 0. */
const count = z.number().int().nonnegative().catch(0).optional().default(0);

const analystSchema = z
  .object({
    price: section({ currency: text }),
    summaryDetail: section({ currency: text }),
    financialData: section({
      currentPrice: num,
      targetHighPrice: num,
      targetLowPrice: num,
      targetMeanPrice: num,
      targetMedianPrice: num,
      recommendationMean: num,
      numberOfAnalystOpinions: num,
    }),
    recommendationTrend: section({
      trend: z
        .array(z.object({ period: text, strongBuy: count, buy: count, hold: count, sell: count, strongSell: count }).loose().catch(null as never))
        .nullable()
        .optional()
        .catch(null),
    }),
    upgradeDowngradeHistory: section({
      history: z
        .array(
          z
            .object({
              epochGradeDate: dateValue,
              firm: text,
              toGrade: text,
              fromGrade: text,
              action: text,
              currentPriceTarget: num,
              priorPriceTarget: num,
            })
            .loose()
            .catch(null as never),
        )
        .nullable()
        .optional()
        .catch(null),
    }),
  })
  .loose();

/** A price target: a positive amount (Yahoo sends 0 for "none"), else `null`. */
function targetOf(value: number | null | undefined): string | null {
  return value !== null && value !== undefined && value > 0 ? decimalOf(value) : null;
}

/** A non-negative integer count, else `null`. */
function integerOf(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * The analyst ratings in a raw `quoteSummary` result (`ANALYST_MODULES`): the recommendation trend (oldest
 * → current month), analyst count, consensus mean, price targets with the SAME listing's current price
 * and quote currency (`price.currency ?? summaryDetail.currency`), and the last 10 up-/downgrades (newest
 * first). `null` when nothing is worth showing (`hasAnalystData`); a malformed response is `error`.
 */
export function analystRatingsOf(raw: unknown): Lookup<AnalystRatings | null> {
  const parsed = analystSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("Classification: Yahoo analyst schema mismatch");
    return { status: "error" };
  }
  const { price, summaryDetail, financialData: financial, recommendationTrend, upgradeDowngradeHistory } = parsed.data;
  const trend: AnalystRatings["trend"] = [];
  for (const period of TREND_PERIODS) {
    const month = (recommendationTrend?.trend ?? []).find((candidate) => candidate?.period === period);
    if (month) {
      trend.push({ period, strongBuy: month.strongBuy, buy: month.buy, hold: month.hold, sell: month.sell, strongSell: month.strongSell });
    }
  }
  const changes: AnalystChange[] = [];
  for (const entry of upgradeDowngradeHistory?.history ?? []) {
    if (!entry) continue;
    const date = dateOf(entry.epochGradeDate);
    const firm = textOf(entry.firm);
    const toGrade = textOf(entry.toGrade);
    if (date === null || firm === null || toGrade === null) continue;
    changes.push({
      date,
      firm,
      fromGrade: textOf(entry.fromGrade),
      toGrade,
      action: textOf(entry.action),
      priceTargetFrom: targetOf(entry.priorPriceTarget),
      priceTargetTo: targetOf(entry.currentPriceTarget),
    });
  }
  // Newest first; the sort is stable, so same-day entries keep Yahoo's order.
  changes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const mean = financial?.recommendationMean;
  const ratings: AnalystRatings = {
    trend,
    analystCount: integerOf(financial?.numberOfAnalystOpinions),
    consensusMean: mean !== null && mean !== undefined && mean > 0 ? decimalOf(mean) : null,
    target: {
      low: targetOf(financial?.targetLowPrice),
      mean: targetOf(financial?.targetMeanPrice),
      median: targetOf(financial?.targetMedianPrice),
      high: targetOf(financial?.targetHighPrice),
      currentPrice: targetOf(financial?.currentPrice),
      currency: textOf(price?.currency) ?? textOf(summaryDetail?.currency),
    },
    changes: changes.slice(0, MAX_ANALYST_CHANGES),
  };
  return { status: "found", value: hasAnalystData(ratings) ? ratings : null };
}

// ---- Home listing by ISIN (story 9.7) ----

/** Runs a Yahoo search for the query and returns the raw (unvalidated) response. */
export type YahooSearch = (query: string) => Promise<unknown>;

/** The real search: `yahoo-finance2` (loaded on first use); the result is validated by our own schema. */
export const yahooSearch: YahooSearch = async (query) => {
  const yahoo = await yahooClient();
  return yahoo.search(
    query,
    { quotesCount: 10, newsCount: 0 },
    { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) } },
  );
};

/** A Yahoo symbol as accepted for the Analysten-Symbol. */
export const YAHOO_SYMBOL = /^[A-Za-z0-9.^=_-]{1,40}$/;

const searchSchema = z
  .object({ quotes: z.array(z.object({ symbol: z.string().optional(), isYahooFinance: z.boolean().optional() }).loose()) })
  .loose();

/** Yahoo suffix of a stock's home exchange by ISIN country ("" = US listing without suffix). */
const HOME_SUFFIX: Readonly<Record<string, string>> = {
  US: "",
  DE: ".DE",
  GB: ".L",
  FR: ".PA",
  NL: ".AS",
  CH: ".SW",
  IT: ".MI",
  ES: ".MC",
  SE: ".ST",
  DK: ".CO",
  NO: ".OL",
  FI: ".HE",
  BE: ".BR",
  AT: ".VI",
  PT: ".LS",
  IE: ".IR",
  JP: ".T",
  HK: ".HK",
  CA: ".TO",
  AU: ".AX",
};

/**
 * The home listing of a stock by ISIN (Yahoo search; only the ISIN is sent): the first quote with the
 * suffix of the ISIN country (US: no suffix), else the first suffix-less (US) quote, else `mappingSymbol`.
 * Quotes flagged `isYahooFinance: false` are ignored. A thrown or malformed response is `error`.
 */
export async function findHomeListing(
  isin: string,
  mappingSymbol: string,
  { search = yahooSearch }: { search?: YahooSearch } = {},
): Promise<Lookup<string>> {
  let raw: unknown;
  try {
    raw = await search(isin);
  } catch (error) {
    console.warn(`Classification: Yahoo search failed (${error instanceof Error ? error.name : "unknown"})`);
    return { status: "error" };
  }
  const parsed = searchSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("Classification: Yahoo search schema mismatch");
    return { status: "error" };
  }
  const symbols = parsed.data.quotes
    .filter((quote) => quote.isYahooFinance !== false)
    .map((quote) => quote.symbol?.trim().toUpperCase())
    .filter((symbol): symbol is string => Boolean(symbol && YAHOO_SYMBOL.test(symbol)));
  const suffix = HOME_SUFFIX[isin.slice(0, 2).toUpperCase()];
  const home = suffix === undefined || suffix === "" ? undefined : symbols.find((symbol) => symbol.endsWith(suffix));
  const us = symbols.find((symbol) => !symbol.includes("."));
  return { status: "found", value: home ?? us ?? mappingSymbol.toUpperCase() };
}
