// Yahoo Finance search news (AD-17), secondary news source: queried by the Yahoo symbol of a Security or
// its name term. Only that query leaves the server.
import { z } from "zod";
import { type FetchedArticle, NEWS_ERROR, type NewsLookup, PROVIDER_TIMEOUT_MS, toArticle } from "./shared";

/** Runs a Yahoo news search for the query and returns the raw (unvalidated) response. */
export type YahooNewsSearch = (query: string) => Promise<unknown>;

type YahooClient = InstanceType<typeof import("yahoo-finance2").default>;

let client: Promise<YahooClient> | undefined;

// Own lazily loaded client (the prices module keeps its own; modules do not share internals).
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
export const yahooNewsSearch: YahooNewsSearch = async (query) => {
  const yahoo = await yahooClient();
  return yahoo.search(
    query,
    { quotesCount: 0, newsCount: 10 },
    { validateResult: false, fetchOptions: { signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) } },
  );
};

const responseSchema = z.object({ news: z.array(z.unknown()) }).loose();

const itemSchema = z
  .object({
    title: z.string(),
    publisher: z.string(),
    link: z.string(),
    providerPublishTime: z.union([z.date(), z.number(), z.string()]),
  })
  .loose();

/** A Date, epoch seconds or milliseconds, or an ISO string → Date (invalid stays invalid). */
function publishTime(value: Date | number | string): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(Math.abs(value) < 1e12 ? value * 1000 : value);
  return new Date(value);
}

/**
 * Yahoo news for the query. A thrown request or a response without a `news` array is a provider error;
 * items that do not match the schema or fail validation are dropped.
 */
export async function searchYahooNews(query: string, search: YahooNewsSearch = yahooNewsSearch): Promise<NewsLookup> {
  let raw: unknown;
  try {
    raw = await search(query);
  } catch (error) {
    console.warn(`News: Yahoo search failed (${error instanceof Error ? error.name : "unknown"})`);
    return NEWS_ERROR;
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("News: Yahoo search schema mismatch");
    return NEWS_ERROR;
  }
  const articles: FetchedArticle[] = [];
  for (const entry of parsed.data.news) {
    const item = itemSchema.safeParse(entry);
    if (!item.success) continue;
    const article = toArticle({
      url: item.data.link,
      title: item.data.title,
      source: item.data.publisher,
      published: publishTime(item.data.providerPublishTime),
    });
    if (article) articles.push(article);
  }
  return { ok: true, articles };
}
