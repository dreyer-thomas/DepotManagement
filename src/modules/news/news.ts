// News on holdings (AD-11, AD-17): a per-Security cache of recent headlines, refreshed with the daily
// scheduler run and on page open when stale. Owned by `news`; ledger and price data are read only through
// their modules' exported services. Not ledger data, never backed up. Provider failures never throw.
import { prisma } from "@/db";
import { addDays, businessDate } from "@/core/dates";
import type { NewsProvider, Prisma } from "@/db/generated/prisma/client";
import { listHeldSecurities, listSecurities } from "@/modules/ledger";
import { listSecuritiesWithMappings } from "@/modules/prices";
import { searchGoogleNews } from "./providers/google-news";
import type { FetchedArticle, FetchLike, NewsLookup } from "./providers/shared";
import { searchYahooNews, type YahooNewsSearch } from "./providers/yahoo";
import { newsTerm } from "./terms";

export type { NewsProvider } from "@/db/generated/prisma/client";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type NewsDb = Prisma.TransactionClient;

/** A Security's cache is stale (refreshed on page open) when its last successful refresh is older than this. */
export const NEWS_MAX_AGE_HOURS = 4;
/** At most this many (newest) headlines are kept per Security. */
export const NEWS_PER_SECURITY_LIMIT = 30;
/** Headlines of this many calendar days (today included) are kept and listed. */
export const NEWS_WINDOW_DAYS = 14;

/** External dependencies of the news refresh; each defaults to the real thing (tests inject fakes). */
export type NewsDeps = { fetch?: FetchLike; search?: YahooNewsSearch };

export type NewsRunFailure = { securityId: string; name: string };

/** Outcome of a refresh: Securities whose cache was replaced, and those where every provider failed. */
export type NewsRunResult = { updated: number; failed: NewsRunFailure[] };

export type RefreshNewsOptions = {
  /** Only held Securities without a refresh in the last `NEWS_MAX_AGE_HOURS`. */
  onlyStale?: boolean;
  /** Current time; defaults to `new Date()`. */
  now?: Date;
  deps?: NewsDeps;
};

export type NewsListArticle = {
  id: string;
  securityId: string;
  /** Name of the Security. */
  name: string;
  title: string;
  url: string;
  source: string;
  /** UTC ISO instant. */
  publishedAt: string;
};

export type NewsListing = { securities: { id: string; name: string }[]; articles: NewsListArticle[] };

// In-process serialization: a refresh started while another runs waits for it. The queue lives on
// globalThis so every module copy in the process (instrumentation, server actions) shares it.
const QUEUE = Symbol.for("depotmanagement.newsRunQueue");
type QueueGlobal = typeof globalThis & { [QUEUE]?: Promise<unknown> };

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const global = globalThis as QueueGlobal;
  const result = (global[QUEUE] ?? Promise.resolve()).then(run, run);
  global[QUEUE] = result.catch(() => undefined);
  return result;
}

/** Runs `write` in a DB transaction, or directly inside the caller's transaction client. */
async function inTransaction<T>(db: NewsDb, write: (tx: NewsDb) => Promise<T>): Promise<T> {
  const client = db as NewsDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") return client.$transaction((tx) => write(tx));
  return write(db);
}

/** True when the window `[today - 13, today]` contains the Berlin business date of the instant. */
function inWindow(publishedAt: string, today: string): boolean {
  const instant = new Date(publishedAt);
  if (Number.isNaN(instant.getTime())) return false;
  const date = businessDate(instant);
  return date >= addDays(today, -(NEWS_WINDOW_DAYS - 1)) && date <= today;
}

function isStale(fetchedAt: string | undefined, now: Date): boolean {
  if (fetchedAt === undefined) return true;
  const at = Date.parse(fetchedAt);
  return Number.isNaN(at) || now.getTime() - at > NEWS_MAX_AGE_HOURS * 3_600_000;
}

async function staleOf(held: string[], now: Date, db: NewsDb): Promise<string[]> {
  const rows = await db.newsFetch.findMany({ where: { securityId: { in: held } }, select: { securityId: true, fetchedAt: true } });
  const fetchedAt = new Map(rows.map((row) => [row.securityId, row.fetchedAt]));
  return held.filter((id) => isStale(fetchedAt.get(id), now));
}

const byNewest = (a: { publishedAt: string; title: string }, b: { publishedAt: string; title: string }) =>
  a.publishedAt === b.publishedAt ? a.title.localeCompare(b.title, "de-DE") : a.publishedAt < b.publishedAt ? 1 : -1;

const normalizedTitle = (title: string) => title.toLowerCase().replace(/\s+/g, " ").trim();

type ProviderArticle = FetchedArticle & { provider: NewsProvider };

/**
 * Merges the successful lookups (in provider order): articles of the window, de-duplicated by URL or
 * normalized title keeping the first, the newest `NEWS_PER_SECURITY_LIMIT`.
 */
function merge(lookups: { provider: NewsProvider; lookup: NewsLookup }[], today: string): ProviderArticle[] {
  const urls = new Set<string>();
  const titles = new Set<string>();
  const merged: ProviderArticle[] = [];
  for (const { provider, lookup } of lookups) {
    if (!lookup.ok) continue;
    for (const article of lookup.articles) {
      if (!inWindow(article.publishedAt, today)) continue;
      const title = normalizedTitle(article.title);
      if (urls.has(article.url) || titles.has(title)) continue;
      urls.add(article.url);
      titles.add(title);
      merged.push({ ...article, provider });
    }
  }
  return merged.sort(byNewest).slice(0, NEWS_PER_SECURITY_LIMIT);
}

/**
 * Refreshes the news cache of the held Securities (all, or only stale ones with `onlyStale`), one Security
 * after another, its three lookups (Google News de, Google News en, Yahoo) concurrently. When all three fail nothing is written for that
 * Security (it stays stale); otherwise its articles are replaced and its `NewsFetch` set in one DB
 * transaction. Every run deletes the cache of Securities no longer held. Serialized in-process; provider
 * failures are part of the result, never thrown.
 */
export function refreshNews(options: RefreshNewsOptions = {}, db: NewsDb = prisma): Promise<NewsRunResult> {
  return serialized(async () => {
    const now = options.now ?? new Date();
    const fetch = options.deps?.fetch ?? globalThis.fetch;
    const search = options.deps?.search;
    const today = businessDate(now);
    const held = await listHeldSecurities(today, db);
    await inTransaction(db, async (tx) => {
      await tx.newsArticle.deleteMany({ where: { securityId: { notIn: held } } });
      await tx.newsFetch.deleteMany({ where: { securityId: { notIn: held } } });
    });
    const targets = options.onlyStale ? await staleOf(held, now, db) : held;
    if (targets.length === 0) return { updated: 0, failed: [] };

    const securities = new Map((await listSecuritiesWithMappings(db)).map((security) => [security.id, security]));
    const result: NewsRunResult = { updated: 0, failed: [] };
    for (const securityId of targets) {
      const security = securities.get(securityId);
      if (!security) continue;
      const term = newsTerm(security.name);
      const yahooQuery = security.mapping?.provider === "YAHOO" && security.mapping.symbol ? security.mapping.symbol : term;
      // The three lookups of one Security run concurrently; the merge order stays Google de → en → Yahoo.
      const [googleDe, googleEn, yahoo] = await Promise.all([
        searchGoogleNews(term, "de", fetch),
        searchGoogleNews(term, "en", fetch),
        searchYahooNews(yahooQuery, search),
      ]);
      const lookups = [
        { provider: "GOOGLE_NEWS" as const, lookup: googleDe },
        { provider: "GOOGLE_NEWS" as const, lookup: googleEn },
        { provider: "YAHOO" as const, lookup: yahoo },
      ];
      if (lookups.every(({ lookup }) => !lookup.ok)) {
        result.failed.push({ securityId, name: security.name });
        continue;
      }
      const articles = merge(lookups, today);
      const fetchedAt = now.toISOString();
      await inTransaction(db, async (tx) => {
        await tx.newsArticle.deleteMany({ where: { securityId } });
        if (articles.length > 0) {
          await tx.newsArticle.createMany({ data: articles.map((article) => ({ securityId, ...article, fetchedAt })) });
        }
        await tx.newsFetch.upsert({ where: { securityId }, create: { securityId, fetchedAt }, update: { fetchedAt } });
      });
      result.updated += 1;
    }
    if (result.failed.length > 0) console.warn(`News: refresh finished with ${result.failed.length} failed Securities`);
    return result;
  });
}

/**
 * Cached headlines of the held Securities within the 14-day window ending `today`, newest first (tie: title),
 * optionally of one held Security (an unknown or non-held id lists all), plus the held Securities (name, de-DE).
 */
export async function listNews(today: string, securityId?: string, db: NewsDb = prisma): Promise<NewsListing> {
  const held = new Set(await listHeldSecurities(today, db));
  const securities = (await listSecurities(db))
    .filter((security) => held.has(security.id))
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
  const names = new Map(securities.map((security) => [security.id, security.name]));
  const filter = securityId !== undefined && held.has(securityId) ? [securityId] : [...held];
  const rows = await db.newsArticle.findMany({
    where: { securityId: { in: filter } },
    select: { id: true, securityId: true, title: true, url: true, source: true, publishedAt: true },
  });
  const articles = rows
    .filter((row) => inWindow(row.publishedAt, today))
    .map((row) => ({ ...row, name: names.get(row.securityId) ?? "" }))
    .sort(byNewest);
  return { securities, articles };
}

/** True when any held Security has no news refresh within the last `NEWS_MAX_AGE_HOURS`. */
export async function newsNeedsRefresh(now: Date, db: NewsDb = prisma): Promise<boolean> {
  const held = await listHeldSecurities(businessDate(now), db);
  return (await staleOf(held, now, db)).length > 0;
}
