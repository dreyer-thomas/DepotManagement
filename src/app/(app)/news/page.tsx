import type { Metadata } from "next";
import { NewsAutoRefresh } from "@/app/_components/news/NewsAutoRefresh";
import { NewsFilter } from "@/app/_components/news/NewsFilter";
import { NewsList } from "@/app/_components/news/NewsList";
import { PageTitle } from "@/app/_components/Placeholder";
import { businessDate } from "@/core/dates";
import { listNews, NEWS_SCOPES, type NewsScope, newsNeedsRefresh, newsSecurityContext } from "@/modules/news";
import { watchedSecurityIds } from "@/modules/watchlist";

export const metadata: Metadata = { title: "Nachrichten" };

type Props = { searchParams?: Promise<{ security?: string | string[]; scope?: string | string[] }> };

/**
 * Cached headlines of the held and watched Securities (last 14 days, newest first), narrowed by the
 * scope toggle (Alle · Depot · Watchlist, `?scope=held|watched`) and optionally to one Security, each with the "im Depot" chip and change today of its Security (computed once per Security).
 * Stale caches are refreshed by the client after render (never during render or `next build`).
 */
export default async function NewsPage({ searchParams }: Props) {
  const params = await searchParams;
  const raw = params?.security;
  const security = typeof raw === "string" && raw ? raw : undefined;
  const scope: NewsScope = NEWS_SCOPES.find((value) => value === params?.scope) ?? "all";
  const now = new Date();
  const today = businessDate(now);
  const [listing, needsRefresh] = await Promise.all([
    watchedSecurityIds().then((watched) => listNews(today, security, undefined, { watched, scope })),
    newsNeedsRefresh(now),
  ]);
  const context = await newsSecurityContext(
    listing.articles.map((article) => article.securityId),
    today,
  );
  return (
    <>
      <PageTitle>Nachrichten</PageTitle>
      {needsRefresh && <NewsAutoRefresh />}
      {(scope !== "all" || listing.securities.length > 0) && (
        <NewsFilter securities={listing.securities} selected={security} scope={scope} />
      )}
      <NewsList articles={listing.articles} context={context} />
    </>
  );
}
