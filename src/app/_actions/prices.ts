"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { businessDate } from "@/core/dates";
import { getSession } from "@/modules/auth";
import {
  deleteManualPrice,
  type DeleteManualPriceResult,
  type PriceRunFailure,
  refreshPrices,
  refreshSecurityPrices,
  saveManualPrice,
  type SecurityRefreshResult,
  type SaveManualPriceResult,
  updateManualPrice,
  type UpdateManualPriceResult,
} from "@/modules/prices";
import { watchlistPriceTargets } from "@/modules/watchlist";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;
type Unauthorized = typeof UNAUTHORIZED;

// Non-string values (e.g. a File) become "", which the services reject with a typed reason.
const formText = z.string().catch("");

/** Result of "Kurse aktualisieren": Securities with stored Prices and the failed ones (with provider). */
export type RefreshPricesActionResult = { ok: true; updated: number; failed: PriceRunFailure[] } | Unauthorized;

/** Result of "Kurs abrufen" of one Security. */
export type RefreshSecurityPricesActionResult = ({ ok: true } & SecurityRefreshResult) | Unauthorized;

/** Result of "Kurs manuell eintragen"; `null` before the first submit. */
export type SaveManualPriceActionState = SaveManualPriceResult | Unauthorized | null;

/** Result of "Manuellen Kurs bearbeiten"; `null` before the first submit. */
export type UpdateManualPriceActionState = UpdateManualPriceResult | Unauthorized | null;

/** Result of "Manuellen Kurs löschen". */
export type DeleteManualPriceActionResult = DeleteManualPriceResult | Unauthorized;

/**
 * "Kurse aktualisieren": fetches the Prices of every held (and watched) Security now and waits for the run (serialized
 * with scheduler runs). Fetch failures are part of the result, never thrown.
 */
export async function refreshPricesAction(): Promise<RefreshPricesActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await refreshPrices(businessDate(new Date()), { watched: watchlistPriceTargets });
  // Prices and fetch errors show on Securities and Positions.
  revalidatePath("/", "layout");
  return { ok: true, updated: result.updated, failed: result.failed };
}

/**
 * "Kurs abrufen": fetches the Prices of one Security now (as "Kurse aktualisieren" would) and waits for
 * the result, e.g. to check a corrected mapping. A fetch failure is part of the result, never thrown.
 */
export async function refreshSecurityPricesAction(securityId: unknown): Promise<RefreshSecurityPricesActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await refreshSecurityPrices(formText.parse(securityId), businessDate(new Date()), { watched: watchlistPriceTargets });
  if (result.status !== "skipped") revalidatePath("/", "layout");
  return { ok: true, ...result };
}

const manualPriceInput = z.object({ securityId: formText, date: formText, price: formText });

export async function saveManualPriceAction(
  _previous: SaveManualPriceActionState,
  formData: FormData,
): Promise<SaveManualPriceActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const { securityId, date, price } = manualPriceInput.parse({
    securityId: formData.get("securityId"),
    date: formData.get("date"),
    price: formData.get("price"),
  });
  const result = await saveManualPrice(securityId, { date, price }, businessDate(new Date()));
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

const updateManualPriceInput = z.object({ priceId: formText, date: formText, price: formText });

/** "Manuellen Kurs bearbeiten": changes date and price of one MANUAL Price. */
export async function updateManualPriceAction(
  _previous: UpdateManualPriceActionState,
  formData: FormData,
): Promise<UpdateManualPriceActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const { priceId, date, price } = updateManualPriceInput.parse({
    priceId: formData.get("priceId"),
    date: formData.get("date"),
    price: formData.get("price"),
  });
  const result = await updateManualPrice(priceId, { date, price }, businessDate(new Date()));
  // not-found: the row is gone (e.g. deleted elsewhere); refresh so the list drops it.
  if (result.ok || result.reason === "not-found") revalidatePath("/", "layout");
  return result;
}

/** "Manuellen Kurs löschen": deletes one MANUAL Price. */
export async function deleteManualPriceAction(priceId: unknown): Promise<DeleteManualPriceActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await deleteManualPrice(formText.parse(priceId));
  // not-found: the row is gone (e.g. deleted elsewhere); refresh so the list drops it.
  if (result.ok || result.reason === "not-found") revalidatePath("/", "layout");
  return result;
}
