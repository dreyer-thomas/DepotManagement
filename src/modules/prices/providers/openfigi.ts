// OpenFIGI: ISIN → Xetra (exchange code GY) ticker. Only ISINs and the exchange code leave the server (AD-13).
import { z } from "zod";
import { ERROR, type FetchLike, type Lookup, NOT_FOUND, PROVIDER_TIMEOUT_MS, readJson } from "./shared";

export const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";
export const XETRA_EXCHANGE_CODE = "GY";

/** Jobs per request: 10 without an API key, 100 with one. */
export const OPENFIGI_CHUNK_SIZE = 10;
export const OPENFIGI_CHUNK_SIZE_WITH_KEY = 100;

const TICKER = /^[A-Z0-9.-]{1,20}$/;

const jobResultSchema = z
  .object({
    data: z.array(z.object({ ticker: z.string().nullish(), exchCode: z.string().nullish() }).loose()).optional(),
    warning: z.string().optional(),
    error: z.string().optional(),
  })
  .loose()
  .refine((job) => job.data !== undefined || job.warning !== undefined || job.error !== undefined);
const responseSchema = z.array(jobResultSchema);

type JobResult = z.infer<typeof jobResultSchema>;

/** Per-ISIN result: the Xetra ticker (upper-cased) or a miss. */
export type XetraLookup = Lookup<string>;

function toLookup(result: JobResult): XetraLookup {
  if (result.data) {
    const ticker = result.data
      .filter((item) => item.exchCode === XETRA_EXCHANGE_CODE)
      .map((item) => item.ticker?.trim().toUpperCase())
      .find((value): value is string => Boolean(value && TICKER.test(value)));
    return ticker ? { status: "found", value: ticker } : NOT_FOUND;
  }
  if (result.error !== undefined) {
    console.warn(`OpenFIGI: job error (${result.error})`);
    return ERROR;
  }
  return NOT_FOUND; // "No identifier found."
}

/**
 * Looks up the Xetra ticker of each ISIN. Requests are chunked; a failed request (network, timeout,
 * HTTP ≥ 400, unexpected body) marks its ISINs as `error`, and after HTTP 429 no further request is made.
 */
export async function lookupXetraTickers(
  isins: readonly string[],
  { fetch, apiKey }: { fetch: FetchLike; apiKey?: string },
): Promise<Map<string, XetraLookup>> {
  const results = new Map<string, XetraLookup>();
  const chunkSize = apiKey ? OPENFIGI_CHUNK_SIZE_WITH_KEY : OPENFIGI_CHUNK_SIZE;
  const unique = [...new Set(isins)];
  let rateLimited = false;
  for (let start = 0; start < unique.length; start += chunkSize) {
    const chunk = unique.slice(start, start + chunkSize);
    if (rateLimited) {
      for (const isin of chunk) results.set(isin, ERROR);
      continue;
    }
    const outcome = await requestChunk(chunk, fetch, apiKey);
    if (outcome === "rate-limited") rateLimited = true;
    chunk.forEach((isin, index) => results.set(isin, Array.isArray(outcome) ? outcome[index] : ERROR));
  }
  return results;
}

async function requestChunk(
  chunk: string[],
  fetch: FetchLike,
  apiKey: string | undefined,
): Promise<XetraLookup[] | "failed" | "rate-limited"> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-OPENFIGI-APIKEY"] = apiKey;
  const body = JSON.stringify(chunk.map((isin) => ({ idType: "ID_ISIN", idValue: isin, exchCode: XETRA_EXCHANGE_CODE })));
  try {
    const response = await fetch(OPENFIGI_MAPPING_URL, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (response.status === 429) {
      console.warn("OpenFIGI: HTTP 429 (rate limited)");
      return "rate-limited";
    }
    if (!response.ok) {
      console.warn(`OpenFIGI: HTTP ${response.status}`);
      return "failed";
    }
    const parsed = responseSchema.safeParse(await readJson(response));
    if (!parsed.success || parsed.data.length !== chunk.length) {
      console.warn("OpenFIGI: schema mismatch");
      return "failed";
    }
    return parsed.data.map(toLookup);
  } catch (error) {
    console.warn(`OpenFIGI: network (${error instanceof Error ? error.name : "unknown"})`);
    return "failed";
  }
}

/** What OpenFIGI states about an ISIN's instrument (first listing with a name, any exchange). */
export type IsinDetails = {
  name: string;
  securityType: string | null;
  securityType2: string | null;
  marketSector: string | null;
};

const detailsResultSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            name: z.string().nullish(),
            securityType: z.string().nullish(),
            securityType2: z.string().nullish(),
            marketSector: z.string().nullish(),
          })
          .loose(),
      )
      .optional(),
    warning: z.string().optional(),
    error: z.string().optional(),
  })
  .loose()
  .refine((job) => job.data !== undefined || job.warning !== undefined || job.error !== undefined);
const detailsResponseSchema = z.array(detailsResultSchema).length(1);

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Looks up name and security type of one ISIN (no exchange filter; the first listing with a name).
 * Only the ISIN leaves the server (AD-13). A miss is `not-found`; network, timeout, HTTP ≥ 400 (incl. 429),
 * an unexpected body or a job error are `error`.
 */
export async function lookupIsinDetails(
  isin: string,
  { fetch, apiKey }: { fetch: FetchLike; apiKey?: string },
): Promise<Lookup<IsinDetails>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["X-OPENFIGI-APIKEY"] = apiKey;
  try {
    const response = await fetch(OPENFIGI_MAPPING_URL, {
      method: "POST",
      headers,
      body: JSON.stringify([{ idType: "ID_ISIN", idValue: isin }]),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`OpenFIGI: HTTP ${response.status}`);
      return ERROR;
    }
    const parsed = detailsResponseSchema.safeParse(await readJson(response));
    if (!parsed.success) {
      console.warn("OpenFIGI: schema mismatch");
      return ERROR;
    }
    const [job] = parsed.data;
    if (job.data) {
      const item = job.data.find((candidate) => text(candidate.name) !== null);
      if (!item) return NOT_FOUND;
      return {
        status: "found",
        value: {
          name: text(item.name)!,
          securityType: text(item.securityType),
          securityType2: text(item.securityType2),
          marketSector: text(item.marketSector),
        },
      };
    }
    if (job.error !== undefined) {
      console.warn(`OpenFIGI: job error (${job.error})`);
      return ERROR;
    }
    return NOT_FOUND;
  } catch (error) {
    console.warn(`OpenFIGI: network (${error instanceof Error ? error.name : "unknown"})`);
    return ERROR;
  }
}
