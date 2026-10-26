import type { Metadata } from "next";
import { NewsAutoRefresh } from "@/app/_components/news/NewsAutoRefresh";
import { NewsFilter } from "@/app/_components/news/NewsFilter";
import { NewsList } from "@/app/_components/news/NewsList";
import { PageTitle } from "@/app/_components/Placeholder";
import { businessDate } from "@/core/dates";
import { listNews, newsNeedsRefresh } from "@/modules/news";

export const metadata: Metadata = { title: "Nachrichten" };

type Props = { searchParams?: Promise<{ security?: string | string[] }> };

/**
 * Cached headlines of the held Securities (last 14 days, newest first), optionally filtered to one
 * Security. Stale caches are refreshed by the client after render (never during render or `next build`).
 */
export default async function NewsPage({ searchParams }: Props) {
  const raw = (await searchParams)?.security;
  const security = typeof raw === "string" && raw ? raw : undefined;
  const now = new Date();
  const [listing, needsRefresh] = await Promise.all([listNews(businessDate(now), security), newsNeedsRefresh(now)]);
  return (
    <>
      <PageTitle>Nachrichten</PageTitle>
      {needsRefresh && <NewsAutoRefresh />}
      {listing.securities.length > 0 && <NewsFilter securities={listing.securities} selected={security} />}
      <NewsList articles={listing.articles} />
    </>
  );
}
