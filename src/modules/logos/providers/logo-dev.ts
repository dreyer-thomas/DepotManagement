// logo.dev image CDN (publishable key, server-side only). Only an ISIN, ticker or crypto symbol plus the
// key leave the server. `fallback=404` keeps generated monograms from counting as hits.
import { type FetchLike, fetchImage, type LogoLookup, NOT_FOUND } from "./shared";

export const LOGO_DEV_URL = "https://img.logo.dev";

export type LogoDevKind = "isin" | "ticker" | "crypto";

/** The logo.dev image URL of `id`. */
export function logoDevUrl(kind: LogoDevKind, id: string, apiKey: string): string {
  const query = new URLSearchParams({ token: apiKey, format: "png", size: "128", fallback: "404" });
  return `${LOGO_DEV_URL}/${kind}/${encodeURIComponent(id)}?${query.toString()}`;
}

/** logo.dev lookup; without a key it sends no request and reports not-found. */
export function logoDev({ fetch, apiKey }: { fetch: FetchLike; apiKey?: string }) {
  return (kind: LogoDevKind, id: string): Promise<LogoLookup> =>
    apiKey ? fetchImage(fetch, logoDevUrl(kind, id, apiKey), "logo.dev") : Promise.resolve(NOT_FOUND);
}
