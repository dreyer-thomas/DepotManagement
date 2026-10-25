// Yahoo Finance search by ISIN: fallback for Securities without a Xetra listing on OpenFIGI.
// Only the ISIN leaves the server (AD-13).
import { z } from "zod";
import { ERROR, type Lookup, NOT_FOUND, PROVIDER_TIMEOUT_MS } from "./shared";

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
