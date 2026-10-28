"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { NEW_SECURITY_MARKER, WATCHLIST_FIELDS } from "@/app/_components/watchlists/form-fields";
import { businessDate } from "@/core/dates";
import { getSession } from "@/modules/auth";
import {
  addWatchlistEntry,
  type AddWatchlistEntryResult,
  createWatchlist,
  deleteWatchlist,
  type DeleteWatchlistResult,
  removeWatchlistEntry,
  type RemoveWatchlistEntryResult,
  renameWatchlist,
  updateWatchlistEntry,
  type UpdateWatchlistEntryResult,
  type WatchlistResult,
} from "@/modules/watchlist";
import { newSecurityInput } from "./new-security-input";
import { schedulePriceBackfill } from "./price-refresh";

const UNAUTHORIZED = { ok: false, reason: "unauthorized" } as const;
type Unauthorized = typeof UNAUTHORIZED;

/** Result of "Watchlist anlegen" / "umbenennen"; `null` before the first submit. */
export type WatchlistActionState = WatchlistResult | Unauthorized | null;

/** Result of "Watchlist löschen"; `null` before the first submit. */
export type DeleteWatchlistActionState = DeleteWatchlistResult | Unauthorized | null;

/** Result of "Wertpapier hinzufügen"; `null` before the first submit. */
export type AddWatchlistEntryActionState = AddWatchlistEntryResult | Unauthorized | null;

/** Result of "Eintrag bearbeiten"; `null` before the first submit. */
export type UpdateWatchlistEntryActionState = UpdateWatchlistEntryResult | Unauthorized | null;

/** Result of "Entfernen". */
export type RemoveWatchlistEntryActionResult = RemoveWatchlistEntryResult | Unauthorized;

// Non-string values (e.g. a File) become "", which the services reject with a typed reason.
const formText = z.string().catch("");

const WATCHLISTS_PATH = "/watchlists";

/** The watchlist page plus the Securities pages showing chips and "Auf Watchlists" (story 9.2). */
function revalidateWatchlists(): void {
  revalidatePath(WATCHLISTS_PATH);
  revalidatePath("/securities");
  revalidatePath("/securities/[id]", "page");
}

function field(formData: FormData, name: string): string {
  return formText.parse(formData.get(name));
}

/** "Watchlist anlegen": the new list goes to the end. */
export async function createWatchlistAction(_previous: WatchlistActionState, formData: FormData): Promise<WatchlistActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await createWatchlist({ name: field(formData, WATCHLIST_FIELDS.name) });
  if (result.ok) revalidateWatchlists();
  return result;
}

/** "Watchlist umbenennen". */
export async function renameWatchlistAction(_previous: WatchlistActionState, formData: FormData): Promise<WatchlistActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await renameWatchlist(field(formData, WATCHLIST_FIELDS.watchlistId), { name: field(formData, WATCHLIST_FIELDS.name) });
  if (result.ok) revalidateWatchlists();
  return result;
}

/** "Watchlist löschen": deletes the list and its entries; Securities and Prices stay. */
export async function deleteWatchlistAction(
  _previous: DeleteWatchlistActionState,
  formData: FormData,
): Promise<DeleteWatchlistActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await deleteWatchlist(field(formData, WATCHLIST_FIELDS.watchlistId));
  // not-found: the list is gone already; refresh so it disappears.
  revalidateWatchlists();
  return result;
}

/**
 * "Wertpapier hinzufügen": an existing Security or a new one ("Neue Security anlegen", created through
 * the ledger). A success schedules a price backfill (a newly watched Security needs its history).
 */
export async function addWatchlistEntryAction(
  _previous: AddWatchlistEntryActionState,
  formData: FormData,
): Promise<AddWatchlistEntryActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const security =
    field(formData, WATCHLIST_FIELDS.newSecurity) === NEW_SECURITY_MARKER
      ? newSecurityInput(
          field(formData, WATCHLIST_FIELDS.securityIdentifier),
          field(formData, WATCHLIST_FIELDS.securityName),
          field(formData, WATCHLIST_FIELDS.assetType),
        )
      : { id: field(formData, WATCHLIST_FIELDS.securityId) };
  const result = await addWatchlistEntry(
    {
      watchlistId: field(formData, WATCHLIST_FIELDS.watchlistId),
      security,
      note: field(formData, WATCHLIST_FIELDS.note),
      dateAdded: field(formData, WATCHLIST_FIELDS.dateAdded),
    },
    businessDate(new Date()),
  );
  if (result.ok) {
    revalidateWatchlists();
    schedulePriceBackfill();
  }
  return result;
}

/**
 * "Eintrag bearbeiten": note, date added and the list. A date moved earlier schedules a price backfill
 * (the history may have to reach further back).
 */
export async function updateWatchlistEntryAction(
  _previous: UpdateWatchlistEntryActionState,
  formData: FormData,
): Promise<UpdateWatchlistEntryActionState> {
  if (!(await getSession())) return UNAUTHORIZED;
  const watchlistId = field(formData, WATCHLIST_FIELDS.watchlistId);
  const result = await updateWatchlistEntry(
    field(formData, WATCHLIST_FIELDS.entryId),
    {
      note: field(formData, WATCHLIST_FIELDS.note),
      dateAdded: field(formData, WATCHLIST_FIELDS.dateAdded),
      ...(watchlistId ? { watchlistId } : {}),
    },
    businessDate(new Date()),
  );
  if (result.ok) {
    revalidateWatchlists();
    if (result.entry.dateAdded < result.previousDateAdded) schedulePriceBackfill();
  } else if (result.reason === "not-found") {
    revalidateWatchlists();
  }
  return result;
}

/** "Entfernen": removes an entry; the Security and its Prices stay. */
export async function removeWatchlistEntryAction(entryId: unknown): Promise<RemoveWatchlistEntryActionResult> {
  if (!(await getSession())) return UNAUTHORIZED;
  const result = await removeWatchlistEntry(formText.parse(entryId));
  // not-found: the entry is gone already; refresh so it disappears.
  revalidateWatchlists();
  return result;
}
