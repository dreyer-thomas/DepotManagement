"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth";
import { refreshKeyFigures, type RefreshKeyFiguresResult } from "@/modules/classification";
import { watchedSecurityIds } from "@/modules/watchlist";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;

/** Result of "Kennzahlen aktualisieren": the service status with its German message. */
export type RefreshKeyFiguresActionResult =
  | { ok: true; status: RefreshKeyFiguresResult["status"]; message: string }
  | typeof UNAUTHORIZED;

const MESSAGES: Record<RefreshKeyFiguresResult["status"], string> = {
  updated: "Kennzahlen aktualisiert.",
  fresh: "Die Kennzahlen sind schon von heute.",
  unavailable: "Für dieses Wertpapier gibt es keine Kennzahlen von Yahoo Finance.",
  failed: "Die Kennzahlen konnten gerade nicht geladen werden. Bitte später erneut versuchen.",
  "not-found": "Dieses Wertpapier gibt es nicht.",
};

/**
 * "Kennzahlen aktualisieren" (story 9.6): fetches the key figures of `securityId` now — at most once per
 * Security and day — and revalidates its detail page and the watchlists. Only for held or watched
 * Securities (`watched` is passed in: `classification` never imports `watchlist`).
 */
export async function refreshKeyFiguresAction(securityId: string): Promise<RefreshKeyFiguresActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const id = typeof securityId === "string" ? securityId.trim() : "";
  const { status } = await refreshKeyFigures(id, { watched: watchedSecurityIds });
  if (status === "updated") {
    revalidatePath(`/securities/${id}`);
    revalidatePath("/watchlists");
  }
  return { ok: true, status, message: MESSAGES[status] };
}
