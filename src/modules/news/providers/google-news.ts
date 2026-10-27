// Google News RSS search (AD-17): headlines by company name, in German and English editions. Only the
// query term (never an ISIN, quantity, value or Depot data) leaves the server. The feed is parsed by a
// minimal RSS reader (no XML dependency) pinned by synthetic fixtures.
import { element, isFeed, items, pubDate } from "./rss";
import { type FetchedArticle, type FetchLike, NEWS_ERROR, type NewsLookup, PROVIDER_TIMEOUT_MS, toArticle } from "./shared";

export type GoogleNewsEdition = "de" | "en";

const EDITIONS: Record<GoogleNewsEdition, string> = {
  de: "hl=de&gl=DE&ceid=DE:de",
  en: "hl=en-US&gl=US&ceid=US:en",
};

/** The RSS search URL of a term: an exact-phrase search limited to the last 14 days. */
export function googleNewsUrl(term: string, edition: GoogleNewsEdition): string {
  const query = `"${term.replace(/"/g, "")}" when:14d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${EDITIONS[edition]}`;
}

/** `Headline - Source` → `Headline` (only when the title ends with exactly that source). */
function stripSource(title: string, source: string): string {
  const trimmed = title.trim();
  const suffix = ` - ${source.trim()}`;
  return source.trim() && trimmed.endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed;
}

/**
 * Parses an RSS body into valid articles; `undefined` when it is no feed (no `<channel`). Items without a
 * valid link, title, source or RFC 822 date are dropped.
 */
export function parseGoogleNewsRss(body: string): FetchedArticle[] | undefined {
  if (!isFeed(body)) return undefined;
  const articles: FetchedArticle[] = [];
  for (const item of items(body)) {
    const source = element(item, "source") ?? "";
    const article = toArticle({
      url: element(item, "link") ?? "",
      title: stripSource(element(item, "title") ?? "", source),
      source,
      published: pubDate(item),
    });
    if (article) articles.push(article);
  }
  return articles;
}

/**
 * Searches Google News for the term in one edition. Non-2xx, network error, timeout or a body that is no
 * feed is a provider error; a valid empty channel is zero articles. Logs never contain the URL or term.
 */
export async function searchGoogleNews(term: string, edition: GoogleNewsEdition, fetch: FetchLike): Promise<NewsLookup> {
  let body: string;
  try {
    const response = await fetch(googleNewsUrl(term, edition), {
      headers: { Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.1" },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`News: Google News (${edition}) answered HTTP ${response.status}`);
      return NEWS_ERROR;
    }
    body = await response.text();
  } catch (error) {
    console.warn(`News: Google News (${edition}) request failed (${error instanceof Error ? error.name : "unknown"})`);
    return NEWS_ERROR;
  }
  const articles = parseGoogleNewsRss(body);
  if (!articles) {
    console.warn(`News: Google News (${edition}) answered without a feed`);
    return NEWS_ERROR;
  }
  return { ok: true, articles };
}
