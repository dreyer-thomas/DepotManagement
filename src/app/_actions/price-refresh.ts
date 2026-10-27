// Background price fetches (and the logo fetch and classification refresh after a backfill) triggered by ledger writes (AD-9, AD-19). Not a server action module: these helpers
// are called by server actions after a successful write and run after the response via `after()`.
// A failure is logged and never changes the action's result.
import { after } from "next/server";
import { businessDate } from "@/core/dates";
import { backfillHeldPrices, type PriceRunResult, refetchPriceHistory } from "@/modules/prices";
import { runClassificationRefresh } from "./classification-refresh";
import { runLogoFetch } from "./logo-fetch";

function logResult(job: string, result: PriceRunResult): void {
  if (result.failed.length > 0) console.warn(`Prices: ${job} finished with ${result.failed.length} failed Securities`);
}

function schedule(job: string, run: (today: string) => Promise<PriceRunResult>, then?: () => Promise<void>): void {
  try {
    after(async () => {
      try {
        logResult(job, await run(businessDate(new Date())));
      } catch (error) {
        console.error(`Prices: ${job} failed (${error instanceof Error ? error.name : "unknown"})`);
      }
      // Runs after the job, also when it failed; logs its own failures.
      if (then) await then();
    });
  } catch (error) {
    console.error(`Prices: scheduling ${job} failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}

/**
 * Schedules a backfill of held Securities that need one (e.g. a new held Security) after the response,
 * followed by a logo fetch for Securities without a logo and then a classification refresh (AD-20). Both
 * run in the same callback after the backfill (which resolves missing mappings) so they see the new
 * ticker / coin id; they also run when the backfill (or the logo fetch) failed.
 */
export function schedulePriceBackfill(): void {
  schedule(
    "backfill",
    (today) => backfillHeldPrices(today),
    async () => {
      await runLogoFetch();
      await runClassificationRefresh();
    },
  );
}

/** Schedules a full history refetch of `securityId` (its splits changed) after the response. */
export function schedulePriceRefetch(securityId: string): void {
  schedule("refetch", (today) => refetchPriceHistory(securityId, today));
}
