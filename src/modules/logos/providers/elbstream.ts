// Elbstream logo API (free tier, no key; requires a visible attribution link, see AppShell). Only an
// ISIN or crypto symbol leaves the server.
import { type FetchLike, fetchImage, type LogoLookup } from "./shared";

export const ELBSTREAM_URL = "https://api.elbstream.com/logos";

export type ElbstreamKind = "isin" | "crypto";

/** The Elbstream PNG URL of `id`. */
export function elbstreamUrl(kind: ElbstreamKind, id: string): string {
  return `${ELBSTREAM_URL}/${kind}/${encodeURIComponent(id)}?format=png`;
}

/** Elbstream lookup. */
export function elbstream({ fetch }: { fetch: FetchLike }) {
  return (kind: ElbstreamKind, id: string): Promise<LogoLookup> => fetchImage(fetch, elbstreamUrl(kind, id), "Elbstream");
}
