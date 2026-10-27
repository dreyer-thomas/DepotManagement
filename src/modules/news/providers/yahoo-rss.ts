// Yahoo Finance RSS headline feed (story 3-8, AD-17): headlines with a short description per Yahoo symbol,
// for stocks and crypto. Unofficial; only the symbol leaves the server. The description becomes the
// plain-text teaser; article pages are never fetched (AD-11).
import { decodeEntities, element, isFeed, items, pubDate, textContent } from "./rss";
import { type FetchedArticle, type FetchLike, NEWS_ERROR, type NewsLookup, PROVIDER_TIMEOUT_MS, toArticle } from "./shared";

/** Longest stored teaser, `…` included. */
export const TEASER_MAX_LENGTH = 600;
/** A teaser cut at a sentence end keeps at least this many characters; otherwise it is cut at a word. */
const TEASER_MIN_SENTENCE_CUT = 200;
const ELLIPSIS = "…";
/** Source of an item without a `<source>` element. */
export const YAHOO_RSS_SOURCE = "Yahoo Finance";

/** The headline feed URL of a Yahoo symbol (German region and language). */
export function yahooRssUrl(symbol: string): string {
  return `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=DE&lang=de-DE`;
}

/** Removes tag-shaped text (`<p>`, `</b>`, `<br/>`); a literal `<` or `>` in prose stays. */
const stripTags = (text: string) => text.replace(/<\/?[a-zA-Z][^>]*>/g, "");

/**
 * Plain-text teaser of a raw `<description>` body: text content (CDATA/entities decoded), then tags removed
 * and entities decoded again, then tags removed once more (descriptions are often entity-encoded HTML),
 * whitespace collapsed, trimmed;
 * empty → `null`. Longer than `TEASER_MAX_LENGTH`: cut after the last sentence end (`.`, `!`, `?` before
 * whitespace) within the limit if that keeps at least 200 characters, else at the last word boundary with
 * `…` appended (at most `TEASER_MAX_LENGTH` characters in total).
 */
export function teaserText(description: string): string | null {
  const text = stripTags(decodeEntities(stripTags(textContent(description))))
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= TEASER_MAX_LENGTH) return text;
  // The last sentence end whose cut keeps the teaser within the limit (the next character is whitespace).
  for (let end = TEASER_MAX_LENGTH; end >= TEASER_MIN_SENTENCE_CUT; end -= 1) {
    if (/[.!?]/.test(text[end - 1]) && /\s/.test(text[end])) return text.slice(0, end);
  }
  const room = TEASER_MAX_LENGTH - ELLIPSIS.length;
  const space = text.lastIndexOf(" ", room);
  const cut = (space > 0 ? text.slice(0, space) : text.slice(0, room)).trimEnd();
  return cut + ELLIPSIS;
}

/**
 * Parses a feed body into valid articles with teasers; `undefined` when it is no feed (no `<channel`).
 * Items without a valid link, title or RFC 822 date are dropped; a missing source is "Yahoo Finance".
 */
export function parseYahooRss(body: string): FetchedArticle[] | undefined {
  if (!isFeed(body)) return undefined;
  const articles: FetchedArticle[] = [];
  for (const item of items(body)) {
    const source = element(item, "source")?.trim() || YAHOO_RSS_SOURCE;
    const description = /<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/.exec(item)?.[1];
    const article = toArticle({
      url: element(item, "link") ?? "",
      title: element(item, "title") ?? "",
      source,
      published: pubDate(item),
      teaser: description === undefined ? null : teaserText(description),
    });
    if (article) articles.push(article);
  }
  return articles;
}

/**
 * The headline feed of a Yahoo symbol. Non-2xx, network error, timeout, a body that is no feed or a feed
 * without valid items is a provider error. Logs never contain the URL or symbol.
 */
export async function searchYahooRss(symbol: string, fetch: FetchLike): Promise<NewsLookup> {
  let body: string;
  try {
    const response = await fetch(yahooRssUrl(symbol), {
      headers: { Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.1" },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`News: Yahoo RSS answered HTTP ${response.status}`);
      return NEWS_ERROR;
    }
    body = await response.text();
  } catch (error) {
    console.warn(`News: Yahoo RSS request failed (${error instanceof Error ? error.name : "unknown"})`);
    return NEWS_ERROR;
  }
  const articles = parseYahooRss(body);
  if (!articles) {
    console.warn("News: Yahoo RSS answered without a feed");
    return NEWS_ERROR;
  }
  if (articles.length === 0) {
    console.warn("News: Yahoo RSS answered with an empty feed");
    return NEWS_ERROR;
  }
  return { ok: true, articles };
}
