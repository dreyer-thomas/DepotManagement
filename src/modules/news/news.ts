// News on holdings (AD-11, AD-17): a per-Security cache of recent headlines, refreshed with the daily
// scheduler run and on page open when stale. Owned by `news`; ledger and price data are read only through
// their modules' exported services. Not ledger data, never backed up. Provider failures never throw.
import { prisma } from "@/db";
import { addDays, businessDate } from "@/core/dates";
import type { NewsProvider, Prisma } from "@/db/generated/prisma/client";
import { listHeldSecurities, listSecurities } from "@/modules/ledger";
import { listSecuritiesWithMappings } from "@/modules/prices";
import { searchGoogleNews } from "./providers/google-news";
import { type FetchedArticle, type FetchLike, NEWS_ERROR, type NewsLookup } from "./providers/shared";
import { searchYahooNews, type YahooNewsSearch } from "./providers/yahoo";
import { searchYahooRss } from "./providers/yahoo-rss";
import { mentionsSecurity, newsTerm, yahooSymbol } from "./terms";

export type { NewsProvider } from "@/db/generated/prisma/client";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type NewsDb = Prisma.TransactionClient;

/** A Security's cache is stale (refreshed on page open) when its last successful refresh is older than this. */
export const NEWS_MAX_AGE_HOURS = 4;
/** At most this many (newest) headlines are kept per Security. */
export const NEWS_PER_SECURITY_LIMIT = 30;
/** Headlines of this many calendar days (today included) are kept and listed. */
export const NEWS_WINDOW_DAYS = 14;

/** Consecutive Yahoo RSS requests of a run start at least this many milliseconds apart. */
export const YAHOO_RSS_SPACING_MS = 1000;

/** External dependencies of the news refresh; each defaults to the real thing (tests inject fakes). */
export type NewsDeps = { fetch?: FetchLike; search?: YahooNewsSearch; sleep?: (ms: number) => Promise<void> };

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  /** Plain-text teaser shown in the app before the article; null = headline only. */
  teaser: string | null;
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
 * normalized title — an article with a teaser replaces an earlier duplicate without one, otherwise the
 * first wins — the newest `NEWS_PER_SECURITY_LIMIT`.
 */
function merge(lookups: { provider: NewsProvider; lookup: NewsLookup }[], today: string): ProviderArticle[] {
  const urls = new Map<string, number>();
  const titles = new Map<string, number>();
  const merged: ProviderArticle[] = [];
  for (const { provider, lookup } of lookups) {
    if (!lookup.ok) continue;
    for (const article of lookup.articles) {
      if (!inWindow(article.publishedAt, today)) continue;
      const title = normalizedTitle(article.title);
      const entry: ProviderArticle = { ...article, teaser: article.teaser ?? null, provider };
      const duplicate = urls.get(article.url) ?? titles.get(title);
      if (duplicate !== undefined) {
        if (entry.teaser === null || merged[duplicate].teaser !== null) continue;
        merged[duplicate] = entry;
      } else {
        merged.push(entry);
      }
      const index = duplicate ?? merged.length - 1;
      urls.set(article.url, index);
      titles.set(title, index);
    }
  }
  return merged.sort(byNewest).slice(0, NEWS_PER_SECURITY_LIMIT);
}

/**
 * Refreshes the news cache of the held Securities (all, or only stale ones with `onlyStale`), one Security
 * after another, its lookups (Google News de, Google News en, Yahoo search and — for stocks and crypto with
 * a Yahoo symbol — the Yahoo RSS feed) concurrently. RSS items are kept only when they mention the
 * Security; consecutive RSS requests are spaced by `YAHOO_RSS_SPACING_MS`. When every queried provider
 * fails nothing is written for that Security (it stays stale); otherwise its articles are replaced and its `NewsFetch` set in one DB
 * transaction. Every run deletes the cache of Securities no longer held. Serialized in-process; provider
 * failures are part of the result, never thrown.
 */
export function refreshNews(options: RefreshNewsOptions = {}, db: NewsDb = prisma): Promise<NewsRunResult> {
  return serialized(async () => {
    const now = options.now ?? new Date();
    const fetch = options.deps?.fetch ?? globalThis.fetch;
    const search = options.deps?.search;
    const sleep = options.deps?.sleep ?? realSleep;
    let lastRssStart: number | undefined;
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
      const rssSymbol = yahooSymbol(security);
      const rssLookup = async (symbol: string): Promise<NewsLookup> => {
        if (lastRssStart !== undefined) {
          const wait = YAHOO_RSS_SPACING_MS - (Date.now() - lastRssStart);
          if (wait > 0) await sleep(wait);
        }
        lastRssStart = Date.now();
        const lookup = await searchYahooRss(symbol, fetch);
        if (!lookup.ok) return lookup;
        const relevant = lookup.articles.filter((article) =>
          mentionsSecurity(`${article.title}\n${article.teaser ?? ""}`, security.name, symbol),
        );
        // A feed without items mentioning the Security counts like an empty feed (provider failure).
        if (relevant.length === 0) {
          console.warn("News: Yahoo RSS answered without items mentioning the Security");
          return NEWS_ERROR;
        }
        return { ok: true, articles: relevant };
      };
      // The lookups of one Security run concurrently; the merge order stays Google de → en → Yahoo → RSS.
      const [googleDe, googleEn, yahoo, rss] = await Promise.all([
        searchGoogleNews(term, "de", fetch),
        searchGoogleNews(term, "en", fetch),
        searchYahooNews(yahooQuery, search),
        rssSymbol === undefined ? undefined : rssLookup(rssSymbol),
      ]);
      const lookups: { provider: NewsProvider; lookup: NewsLookup }[] = [
        { provider: "GOOGLE_NEWS", lookup: googleDe },
        { provider: "GOOGLE_NEWS", lookup: googleEn },
        { provider: "YAHOO", lookup: yahoo },
      ];
      if (rss !== undefined) lookups.push({ provider: "YAHOO_RSS", lookup: rss });
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
    select: { id: true, securityId: true, title: true, url: true, source: true, publishedAt: true, teaser: true },
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

/** Restore (story 6.2): deletes every cached headline (teasers included) and refresh marker inside the caller's transaction. */
export async function clearNews(db: NewsDb): Promise<void> {
  await db.newsArticle.deleteMany();
  await db.newsFetch.deleteMany();
}
