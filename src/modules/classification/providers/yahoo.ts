// Yahoo Finance `quoteSummary` (AD-20): sector, industry, country, market cap and currency of a stock.
// Only the Yahoo symbol (ticker) leaves the server (AD-13). The classification module keeps its own
// lazily loaded client (modules do not share internals).
import { z } from "zod";
import type { ProviderProfile } from "@/core/classification";

/** Timeout of the outbound request. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** Result of a provider lookup: a value, a definitive miss, or a transient failure (retry later). */
export type Lookup<T> = { status: "found"; value: T } | { status: "not-found" } | { status: "error" };

export type QuoteSummaryQuery = { modules: ["assetProfile", "price"] };
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
 * The stock profile of a Yahoo symbol. Only `symbol` is sent. A response without `assetProfile` and
 * Yahoo's "no data" errors are `not-found`; any other thrown error or a malformed response is `error`.
 */
export async function fetchProfile(
  symbol: string,
  { quoteSummary = yahooQuoteSummary }: { quoteSummary?: YahooQuoteSummary } = {},
): Promise<Lookup<ProviderProfile>> {
  let raw: unknown;
  try {
    raw = await quoteSummary(
      symbol,
      { modules: ["assetProfile", "price"] },
      { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) } },
    );
  } catch (error) {
    if (isNoData(error)) return { status: "not-found" };
    console.warn(`Classification: Yahoo request failed (${error instanceof Error ? error.name : "unknown"})`);
    return { status: "error" };
  }
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
