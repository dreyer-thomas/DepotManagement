// The in-process price scheduler (AD-13): one per Node process, started from `instrumentation.ts`
// (never during `next build`). It runs `refreshPrices` once on start and again on the first hourly check
// of every later Europe/Berlin business date. A failed run is logged (no amounts) and retried the next day.
import { businessDate } from "@/core/dates";
import { type PriceRunResult, refreshPrices } from "./prices";

/** How often the scheduler checks whether the Berlin business date changed. */
export const SCHEDULER_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export type PriceSchedulerDeps = {
  /** The price run; defaults to `refreshPrices` (serialized with on-demand runs). */
  run?: (today: string) => Promise<PriceRunResult>;
  /** Current time; defaults to `new Date()`. */
  now?: () => Date;
};

type SchedulerState = {
  timer: ReturnType<typeof setInterval>;
  /** Berlin business date of the last started run. */
  lastRunDate: string | null;
};

// Survives module re-evaluation (dev reloads, duplicate bundles) within one process.
const STATE = Symbol.for("depotmanagement.priceScheduler");
type SchedulerGlobal = typeof globalThis & { [STATE]?: SchedulerState };

/**
 * Starts the price scheduler unless it already runs in this process (then a no-op returning false):
 * an immediate run, then an hourly check (timer `unref()`'d) that starts one run per new Berlin day.
 */
export function startPriceScheduler(deps: PriceSchedulerDeps = {}): boolean {
  const global = globalThis as SchedulerGlobal;
  if (global[STATE]) return false;
  const run = deps.run ?? ((today: string) => refreshPrices(today));
  const now = deps.now ?? (() => new Date());

  const state = { lastRunDate: null } as Omit<SchedulerState, "timer"> & Partial<Pick<SchedulerState, "timer">>;
  const tick = () => {
    let today: string;
    try {
      today = businessDate(now());
    } catch {
      return;
    }
    if (state.lastRunDate === today) return;
    state.lastRunDate = today;
    Promise.resolve()
      .then(() => run(today))
      .then(
        (result) => {
          if (result.failed.length > 0) {
            console.warn(`Prices: scheduled run finished with ${result.failed.length} failed Securities`);
          }
        },
        (error: unknown) => {
          console.error(`Prices: scheduled run failed (${error instanceof Error ? error.name : "unknown"})`);
        },
      );
  };
  const timer = setInterval(tick, SCHEDULER_CHECK_INTERVAL_MS);
  timer.unref?.();
  state.timer = timer;
  global[STATE] = state as SchedulerState;
  tick();
  return true;
}

/** Stops the scheduler of this process (tests); a later start begins afresh. */
export function stopPriceScheduler(): void {
  const global = globalThis as SchedulerGlobal;
  const state = global[STATE];
  if (!state) return;
  clearInterval(state.timer);
  delete global[STATE];
}
