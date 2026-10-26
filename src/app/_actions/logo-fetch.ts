// Background logo fetch (AD-19). Not a server action module: runs inside the price backfill's `after()`
// callback, right after the backfill, so newly resolved mappings (ticker, coin id) are already stored.
// A failure is logged and never thrown.
import { fetchMissingLogos } from "@/modules/logos";

/** Fetches logos of Securities without one; logs a failure instead of throwing. */
export async function runLogoFetch(): Promise<void> {
  try {
    await fetchMissingLogos();
  } catch (error) {
    console.error(`Logos: fetch failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}
