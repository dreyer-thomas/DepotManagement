"use server";

import { revalidatePath } from "next/cache";
import { businessDate } from "@/core/dates";
import { getSession } from "@/modules/auth";
import { refreshNews } from "@/modules/news";
import { refreshPrices } from "@/modules/prices";
import { watchedSecurityIds, watchlistPriceTargets } from "@/modules/watchlist";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

/** Result of the AppBar refresh: names of the Securities whose Prices or news failed (news `null` when the whole news run failed). */
export type RefreshAllActionResult =
  | { ok: true; failedPrices: string[]; failedNews: string[] | null }
  | typeof UNAUTHORIZED;

/**
 * AppBar refresh: fetches the Prices of every held and watched Security now (serialized with scheduler
 * runs), then refreshes the news of all of them regardless of their age. Price failures are part of the
 * result; a failed news run only shows as `failedNews: null`, so fresh Prices still reach the page.
 */
export async function refreshAllAction(): Promise<RefreshAllActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const prices = await refreshPrices(businessDate(new Date()), { watched: watchlistPriceTargets });
  let failedNews: string[] | null;
  try {
    const news = await refreshNews({ watched: watchedSecurityIds });
    failedNews = news.failed.map((failure) => failure.name);
  } catch (error) {
    console.error(`News: refresh failed (${error instanceof Error ? error.name : "unknown"})`);
    failedNews = null;
  }
  revalidatePath("/", "layout");
  return { ok: true, failedPrices: prices.failed.map((failure) => failure.name), failedNews };
}
