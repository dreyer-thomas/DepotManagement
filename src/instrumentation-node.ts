import { formatAuthConfigProblems, readAuthConfig } from "@/modules/auth/config";

/**
 * Stops the process when the auth variables are missing or invalid. Uses process.exit because
 * an error thrown in register() is not guaranteed to stop the server. Never prints values.
 */
export function checkAuthConfigOrExit(): void {
  const result = readAuthConfig(process.env);
  if (!result.ok) {
    console.error(formatAuthConfigProblems(result.problems));
    process.exit(1);
  }
}

const LOGO_START = Symbol.for("depotmanagement.logoStartupRun");
type LogoStartGlobal = typeof globalThis & { [LOGO_START]?: boolean };

/** A full news refresh after the scheduled price run (AD-11); a failure is only logged. */
async function refreshNewsAfterPrices(): Promise<void> {
  try {
    const { refreshNews } = await import("@/modules/news");
    // Watched Securities are in the news set; `news` never imports `watchlist` (AD-2), so the loader is passed in.
    const { watchedSecurityIds } = await import("@/modules/watchlist");
    await refreshNews({ watched: watchedSecurityIds });
  } catch (error) {
    console.error(`News: scheduled refresh failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}

/** A classification refresh after the scheduled news refresh (AD-20); a failure is only logged. */
async function refreshClassificationsAfterNews(): Promise<void> {
  try {
    const { refreshClassifications } = await import("@/modules/classification");
    await refreshClassifications();
  } catch (error) {
    console.error(`Classification: scheduled refresh failed (${error instanceof Error ? error.name : "unknown"})`);
  }
}

/**
 * Starts the in-process background jobs (AD-13: the price scheduler, whose daily run also refreshes the
 * news and then the classifications afterwards, even when the price run failed, and the daily DB backup scheduler; AD-19: one logo
 * fetch run) unless this is `next build`. Both schedulers guard against a second start in the same
 * process; the logo run has its own globalThis guard and runs fire-and-forget (a failure is logged, never
 * thrown).
 */
export async function startBackgroundJobs(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { refreshPrices, startPriceScheduler } = await import("@/modules/prices");
  // Watched Securities are priced too; `prices` never imports `watchlist` (AD-2), so the loader is passed in.
  const { watchlistPriceTargets } = await import("@/modules/watchlist");
  startPriceScheduler({
    run: async (today) => {
      try {
        return await refreshPrices(today, { watched: watchlistPriceTargets });
      } finally {
        await refreshNewsAfterPrices();
        await refreshClassificationsAfterNews();
      }
    },
  });
  const { startBackupScheduler } = await import("@/modules/backup");
  startBackupScheduler();
  const global = globalThis as LogoStartGlobal;
  if (global[LOGO_START]) return;
  global[LOGO_START] = true;
  const { fetchMissingLogos } = await import("@/modules/logos");
  fetchMissingLogos().catch((error: unknown) => {
    console.error(`Logos: start-up fetch failed (${error instanceof Error ? error.name : "unknown"})`);
  });
}
