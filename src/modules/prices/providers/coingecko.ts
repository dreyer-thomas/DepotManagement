// CoinGecko: search (crypto symbol → coin id) and daily EUR prices by coin id (`market_chart`, Demo API:
// at most 365 days). Only the symbol, resp. the coin id and a day count, leave the server (AD-13).
import { z } from "zod";
import { canonicalDecimal } from "@/core/decimal";
import {
  daysBetween,
  ERROR,
  type FetchLike,
  getJson,
  latestClose,
  type Lookup,
  NOT_FOUND,
  PROVIDER_TIMEOUT_MS,
  readJson,
  sortedCloses,
  utcDate,
} from "./shared";
import type { DailyClose, PriceAdapter, PriceFetch } from "./types";

export const COINGECKO_SEARCH_URL = "https://api.coingecko.com/api/v3/search";
export const COINGECKO_COINS_URL = "https://api.coingecko.com/api/v3/coins";

/** The Demo API serves at most this many days of daily history. */
export const COINGECKO_MAX_DAYS = 365;

const COIN_ID = /^[A-Za-z0-9.^=_-]{1,40}$/;

const searchSchema = z
  .object({ coins: z.array(z.object({ id: z.string(), symbol: z.string() }).loose()) })
  .loose();

/**
 * The id of the first coin whose symbol equals `symbol` case-insensitively. Results are ordered by
 * market-cap rank, so the first match is the intended coin.
 */
export async function findCoinId(
  symbol: string,
  { fetch, apiKey }: { fetch: FetchLike; apiKey?: string },
): Promise<Lookup<string>> {
  const wanted = symbol.trim().toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
  try {
    const response = await fetch(`${COINGECKO_SEARCH_URL}?query=${encodeURIComponent(wanted)}`, {
      headers,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`CoinGecko: HTTP ${response.status} for ${wanted}`);
      return ERROR;
    }
    const parsed = searchSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      console.warn(`CoinGecko: schema mismatch for ${wanted}`);
      return ERROR;
    }
    const coin = parsed.data.coins.find(
      (candidate) => candidate.symbol.trim().toUpperCase() === wanted && COIN_ID.test(candidate.id),
    );
    return coin ? { status: "found", value: coin.id } : NOT_FOUND;
  } catch (error) {
    console.warn(`CoinGecko: network (${error instanceof Error ? error.name : "unknown"}) for ${wanted}`);
    return ERROR;
  }
}

const chartSchema = z.object({ prices: z.array(z.tuple([z.number(), z.number().nullable()])) }).loose();

/**
 * CoinGecko price adapter (symbol = coin id): daily EUR prices of the last `days` days, where `days`
 * reaches back to `from` (UTC dates, 1..365). A point at epoch ms `t` is dated by the UTC date of `t − 1`:
 * the 00:00 UTC point closes the previous UTC day, an intraday point is today's latest price. The last
 * point of a date wins; closes are limited to the requested range.
 */
export function coingeckoPrices({
  fetch,
  apiKey,
  now = () => new Date(),
}: {
  fetch: FetchLike;
  apiKey?: string;
  now?: () => Date;
}): PriceAdapter {
  async function fetchHistory(symbol: string, from: string, to: string): Promise<PriceFetch<DailyClose[]>> {
    const today = utcDate(now().getTime());
    const days = Math.min(COINGECKO_MAX_DAYS, Math.max(1, daysBetween(from, today) + 1));
    const headers: Record<string, string> = apiKey ? { "x-cg-demo-api-key": apiKey } : {};
    const reply = await getJson(
      fetch,
      `${COINGECKO_COINS_URL}/${encodeURIComponent(symbol)}/market_chart?vs_currency=eur&days=${days}&interval=daily`,
      headers,
    );
    if (!reply) return { ok: false, reason: "network" };
    if (reply.status === 404) return { ok: false, reason: "not-found" };
    if (!reply.ok) return { ok: false, reason: "network" };
    const parsed = chartSchema.safeParse(reply.body);
    if (!parsed.success) return { ok: false, reason: "schema" };
    try {
      const byDate = new Map<string, string>();
      for (const [ms, price] of parsed.data.prices) {
        if (price === null || !(price > 0)) continue;
        const date = utcDate(ms - 1);
        if (date < from || date > to) continue;
        byDate.set(date, canonicalDecimal(String(price)));
      }
      if (byDate.size === 0) return { ok: false, reason: "not-found" };
      return { ok: true, value: sortedCloses(byDate) };
    } catch {
      return { ok: false, reason: "unexpected" };
    }
  }

  return {
    fetchHistory: (symbol, from, to) => fetchHistory(symbol, from, to),
    fetchLatest: (symbol) => latestClose((from, to) => fetchHistory(symbol, from, to), now),
  };
}
