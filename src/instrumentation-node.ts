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

/**
 * Starts the in-process background jobs (AD-13: the price scheduler; AD-19: one logo fetch run) unless
 * this is `next build`. The scheduler guards against a second start in the same process; the logo run
 * has its own globalThis guard and runs fire-and-forget (a failure is logged, never thrown).
 */
export async function startBackgroundJobs(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startPriceScheduler } = await import("@/modules/prices");
  startPriceScheduler();
  const global = globalThis as LogoStartGlobal;
  if (global[LOGO_START]) return;
  global[LOGO_START] = true;
  const { fetchMissingLogos } = await import("@/modules/logos");
  fetchMissingLogos().catch((error: unknown) => {
    console.error(`Logos: start-up fetch failed (${error instanceof Error ? error.name : "unknown"})`);
  });
}
