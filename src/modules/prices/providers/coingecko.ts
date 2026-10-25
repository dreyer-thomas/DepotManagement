// CoinGecko search: crypto symbol → coin id (prices are fetched by id). Only the symbol leaves the server.
import { z } from "zod";
import { ERROR, type FetchLike, type Lookup, NOT_FOUND, PROVIDER_TIMEOUT_MS, readJson } from "./shared";

export const COINGECKO_SEARCH_URL = "https://api.coingecko.com/api/v3/search";

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
