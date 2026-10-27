/**
 * The "Vergleich mit" options of the Performance tab (story 8-2): the benchmark indices, Gesamtportfolio
 * (Depot detail only) and the other non-archived Depots, each with its line computed server-side for the
 * render so switching is instant.
 */
import { BENCHMARKS, type BenchmarkKey, type PerformancePoint } from "@/core/benchmarks";
import { NO_BENCHMARK_CHOICE } from "@/app/_components/charts/chart-preference";

/**
 * One comparison: its stored key, label, line (`null` = no prices, "Keine Kurse für den Vergleich") and
 * Period return (`ttwror`; a Depot's or the Portfolio's `performance.ttwror`, a benchmark's last line
 * point; `null` = none, shown as "–" without a difference).
 */
export type ComparisonOption = { key: string; label: string; line: PerformancePoint[] | null; ttwror: string | null };

/** A Depot or Portfolio comparison: its line and its Period TTWROR (`performance.ttwror`). */
export type ScopeLine = { line: PerformancePoint[]; ttwror: string | null };

/**
 * The Performance tab's data: the scope line, its label, its Period return (`performance.ttwror`, so the
 * KPI equals the hero TTWROR), the comparison options and the initial choice.
 */
export type PerformanceComparison = {
  scopeLabel: string;
  line: PerformancePoint[];
  ttwror: string | null;
  options: ComparisonOption[];
  /** A key of `options` or `none`. */
  initialChoice: string;
};

export const NO_COMPARISON_LABEL = "keiner";
export const PORTFOLIO_CHOICE = "portfolio";
export const PORTFOLIO_COMPARISON_LABEL = "Gesamtportfolio";

/** The stored key of a Depot comparison. */
export function depotChoice(depotId: string): string {
  return `depot:${depotId}`;
}

/**
 * The options in select order: the four indices, Gesamtportfolio when given (Depot detail), then the
 * given Depots (the caller leaves out the Depot itself and archived ones).
 */
export function comparisonOptions({
  benchmarks,
  portfolio,
  depots,
}: {
  benchmarks: Record<BenchmarkKey, PerformancePoint[] | null>;
  portfolio?: ScopeLine;
  depots: readonly ({ id: string; name: string } & ScopeLine)[];
}): ComparisonOption[] {
  return [
    ...BENCHMARKS.map((benchmark) => {
      const line = benchmarks[benchmark.key];
      return { key: benchmark.key, label: benchmark.label, line, ttwror: line?.at(-1)?.performance ?? null };
    }),
    ...(portfolio ? [{ key: PORTFOLIO_CHOICE, label: PORTFOLIO_COMPARISON_LABEL, ...portfolio }] : []),
    ...depots.map(({ id, name, line, ttwror }) => ({ key: depotChoice(id), label: name, line, ttwror })),
  ];
}

/** Every choice valid on the page: `none` and the option keys. */
export function comparisonChoiceKeys(options: readonly ComparisonOption[]): string[] {
  return [NO_BENCHMARK_CHOICE, ...options.map((option) => option.key)];
}
