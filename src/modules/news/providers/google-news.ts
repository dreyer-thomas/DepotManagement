// Google News RSS search (AD-17): headlines by company name, in German and English editions. Only the
// query term (never an ISIN, quantity, value or Depot data) leaves the server. The feed is parsed by a
// minimal RSS reader (no XML dependency) pinned by synthetic fixtures.
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

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decodes XML entities: the predefined ones (+ `&nbsp;`), `&#N;` and `&#xH;`; unknown ones stay. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (entity, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return entity;
      }
    }
    return NAMED_ENTITIES[body] ?? entity;
  });
}

/** Text content of an element body: CDATA sections verbatim, the rest entity-decoded, tags dropped. */
export function textContent(body: string): string {
  let text = "";
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  for (let match = cdata.exec(body); match; match = cdata.exec(body)) {
    text += decodeEntities(body.slice(last, match.index).replace(/<[^>]*>/g, ""));
    text += match[1];
    last = match.index + match[0].length;
  }
  return text + decodeEntities(body.slice(last).replace(/<[^>]*>/g, ""));
}

function element(item: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(item);
  return match ? textContent(match[1]) : undefined;
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
  if (!/<channel[\s>]/.test(body)) return undefined;
  const articles: FetchedArticle[] = [];
  for (const [, item] of body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)) {
    const source = element(item, "source") ?? "";
    const pubDate = element(item, "pubDate");
    const article = toArticle({
      url: element(item, "link") ?? "",
      title: stripSource(element(item, "title") ?? "", source),
      source,
      published: pubDate?.trim() ? new Date(pubDate.trim()) : undefined,
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
