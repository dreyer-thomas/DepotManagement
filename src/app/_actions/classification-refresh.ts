// Background classification refresh (AD-20). Not a server action module: runs inside the price
// backfill's `after()` callback right after the logo fetch, so newly resolved mappings (Yahoo symbols)
// are already stored, or on its own after a restore or a type change. A failure is logged and never
// thrown, so it never affects a ledger write.
import { after } from "next/server";
import { refreshClassifications } from "@/modules/classification";

/** Refreshes the classification of every Security; logs a failure instead of throwing. */
export async function runClassificationRefresh(): Promise<void> {
  try {
    await refreshClassifications();
  } catch (error) {
    console.error(`Classification: refresh failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}

/** Schedules a classification refresh after the response (restore, "Typ ändern"); never throws. */
export function scheduleClassificationRefresh(): void {
  try {
    after(runClassificationRefresh);
  } catch (error) {
    console.error(`Classification: scheduling the refresh failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}
