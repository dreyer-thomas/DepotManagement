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

/**
 * Starts the in-process background jobs (AD-13: the price scheduler) unless this is `next build`.
 * The scheduler itself guards against a second start in the same process.
 */
export async function startBackgroundJobs(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startPriceScheduler } = await import("@/modules/prices");
  startPriceScheduler();
}
