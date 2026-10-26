// CoinGecko coin image: `coins/{id}` names the image URL (`image.large`), which is then downloaded.
// Only the coin id leaves the server; the image URL must be https on a coingecko.com host.
import { z } from "zod";
import { ERROR, type FetchLike, fetchImage, type LogoLookup, NOT_FOUND, PROVIDER_TIMEOUT_MS } from "./shared";

export const COINGECKO_COINS_URL = "https://api.coingecko.com/api/v3/coins";

const COIN_ID = /^[A-Za-z0-9.^=_-]{1,40}$/;

const coinSchema = z.object({ image: z.object({ large: z.string() }).loose() }).loose();

/** The coin-details URL without market data, tickers or other heavy parts. */
export function coinUrl(coinId: string): string {
  const query = new URLSearchParams({
    localization: "false",
    tickers: "false",
    market_data: "false",
    community_data: "false",
    developer_data: "false",
    sparkline: "false",
  });
  return `${COINGECKO_COINS_URL}/${encodeURIComponent(coinId)}?${query.toString()}`;
}

/** True for an https URL on `coingecko.com` or one of its subdomains. */
export function isCoingeckoImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "coingecko.com" || host.endsWith(".coingecko.com"));
  } catch {
    return false;
  }
}

/** CoinGecko image lookup by coin id. */
export function coingeckoImage({ fetch, apiKey }: { fetch: FetchLike; apiKey?: string }) {
  return async (coinId: string): Promise<LogoLookup> => {
    if (!COIN_ID.test(coinId)) return NOT_FOUND;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
    let image: string;
    try {
      const response = await fetch(coinUrl(coinId), { headers, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
      if (response.status === 404) return NOT_FOUND;
      if (!response.ok) {
        console.warn(`Logos: CoinGecko HTTP ${response.status}`);
        return ERROR;
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        return NOT_FOUND;
      }
      const parsed = coinSchema.safeParse(body);
      if (!parsed.success) return NOT_FOUND;
      image = parsed.data.image.large;
    } catch (error) {
      console.warn(`Logos: CoinGecko network (${error instanceof Error ? error.name : "unknown"})`);
      return ERROR;
    }
    if (!isCoingeckoImageUrl(image)) return NOT_FOUND;
    return fetchImage(fetch, image, "CoinGecko");
  };
}
