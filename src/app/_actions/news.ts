"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth";
import { type NewsRunResult, refreshNews } from "@/modules/news";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

/** Result of the on-open news refresh: refreshed Securities and those whose news could not be loaded. */
export type RefreshNewsActionResult = ({ ok: true } & NewsRunResult) | typeof UNAUTHORIZED;

/**
 * Refreshes the news of held Securities whose cache is stale (called once by the news page after it has
 * rendered, never during render). Provider failures are part of the result, never thrown.
 */
export async function refreshNewsAction(): Promise<RefreshNewsActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await refreshNews({ onlyStale: true });
  revalidatePath("/news");
  return { ok: true, ...result };
}
