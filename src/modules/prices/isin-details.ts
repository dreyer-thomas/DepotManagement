// ISIN → name and security type via OpenFIGI, for callers that create a Security from an ISIN alone
// (the MCP `add_watchlist_entry` tool, story 9.4). Uses the global fetch and `OPENFIGI_API_KEY`.
import { type IsinDetails, lookupIsinDetails as lookup } from "./providers/openfigi";
import { envKey, type FetchLike, type Lookup } from "./providers/shared";

/** Looks up one ISIN at OpenFIGI; `deps` are for tests (default: `globalThis.fetch`, `process.env`). */
export function lookupIsinDetails(
  isin: string,
  deps: { fetch?: FetchLike; env?: { OPENFIGI_API_KEY?: string } } = {},
): Promise<Lookup<IsinDetails>> {
  const fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return lookup(isin, { fetch, apiKey: envKey((deps.env ?? process.env).OPENFIGI_API_KEY) });
}
