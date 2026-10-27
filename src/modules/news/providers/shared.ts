// Shared bits of the news providers (copied from the prices module's shared helpers; module boundary).
// Expected failures are typed results, never thrown.

/** Timeout of every outbound news request. */
export const PROVIDER_TIMEOUT_MS = 10_000;

/** `fetch` as injected into adapters (tests pass a fake serving recorded responses). */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const TITLE_MAX_LENGTH = 300;
export const SOURCE_MAX_LENGTH = 100;

/**
 * One validated headline: an http(s) URL, a non-empty title and source, a UTC ISO publication instant and,
 * from providers that deliver one, a plain-text teaser (`null` = none; absent for headline-only providers).
 */
export type FetchedArticle = { url: string; title: string; source: string; publishedAt: string; teaser?: string | null };

/** Result of one provider query: the valid articles (possibly none) or a provider error. */
export type NewsLookup = { ok: true; articles: FetchedArticle[] } | { ok: false };

export const NEWS_ERROR = { ok: false } as const;

/**
 * Validates one raw headline: the link must parse as an `http:`/`https:` URL, title and source are trimmed
 * (whitespace collapsed) and must not be empty (capped at 300/100 characters), the date must be valid.
 * Anything else drops the item (`undefined`). A given teaser is passed through unchanged.
 */
export function toArticle(raw: {
  url: string;
  title: string;
  source: string;
  published: Date | undefined;
  teaser?: string | null;
}): FetchedArticle | undefined {
  let url: URL;
  try {
    url = new URL(raw.url.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  const title = clean(raw.title, TITLE_MAX_LENGTH);
  const source = clean(raw.source, SOURCE_MAX_LENGTH);
  if (!title || !source) return undefined;
  if (!raw.published || Number.isNaN(raw.published.getTime())) return undefined;
  const article: FetchedArticle = { url: url.href, title, source, publishedAt: raw.published.toISOString() };
  if (raw.teaser !== undefined) article.teaser = raw.teaser;
  return article;
}

function clean(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max).trim();
}
