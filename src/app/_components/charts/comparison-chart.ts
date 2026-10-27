/**
 * Presentation-edge helpers of the Performance comparison chart (story 8-2): plot coordinates
 * (`Number(...)` only here), tooltip lines and the text alternative — every displayed text formatted
 * from the original ratio strings via `core/format`.
 */
import { formatDate, formatPercent } from "@/core/format";
import type { PerformanceChartPoint } from "./performance-chart";
import { utcDate } from "./value-chart";

/** Plot coordinates, index-aligned with the scope line; the comparison is `null` on days it lacks. */
export type ComparisonPlotData = { dates: Date[]; scope: number[]; comparison: (number | null)[] };

/** One tooltip row: series label and its signed performance (`–` without a value that day). */
export type ComparisonTooltipRow = { label: string; value: string };

/** The comparison line's points by date. */
export function comparisonByDate(comparison: readonly PerformanceChartPoint[] | null): Map<string, string> {
  return new Map((comparison ?? []).map((point) => [point.date, point.performance]));
}

/** Plot coordinates: the scope line and the comparison aligned by date to the scope's days. */
export function toComparisonPlotData(
  line: readonly PerformanceChartPoint[],
  comparison: readonly PerformanceChartPoint[] | null,
): ComparisonPlotData {
  const byDate = comparisonByDate(comparison);
  return {
    dates: line.map((point) => utcDate(point.date)),
    scope: line.map((point) => Number(point.performance)),
    comparison: line.map((point) => {
      const value = byDate.get(point.date);
      return value === undefined ? null : Number(value);
    }),
  };
}

/** Tooltip texts of one day: the date, then the scope row and (with a comparison) the comparison row. */
export function comparisonTooltipLines(
  point: PerformanceChartPoint,
  scopeLabel: string,
  comparison: { label: string; byDate: Map<string, string> } | null,
): { date: string; rows: ComparisonTooltipRow[] } {
  const rows: ComparisonTooltipRow[] = [{ label: scopeLabel, value: formatPercent(point.performance) }];
  if (comparison) {
    const value = comparison.byDate.get(point.date);
    rows.push({ label: comparison.label, value: value === undefined ? "–" : formatPercent(value) });
  }
  return { date: formatDate(point.date), rows };
}

/**
 * Text alternative, e.g. `Performance 31.01.2026 – 04.02.2026: Portfolio +12,00 %, MSCI World +8,00 %`
 * (each line's last point).
 */
export function comparisonAriaLabel(
  line: readonly PerformanceChartPoint[],
  scopeLabel: string,
  comparison: { label: string; line: readonly PerformanceChartPoint[] } | null,
): string {
  const first = line.at(0);
  const last = line.at(-1);
  if (!first || !last) return "Performance: keine Daten";
  const parts = [`${scopeLabel} ${formatPercent(last.performance)}`];
  const comparisonLast = comparison?.line.at(-1);
  if (comparison && comparisonLast) parts.push(`${comparison.label} ${formatPercent(comparisonLast.performance)}`);
  return `Performance ${formatDate(first.date)} – ${formatDate(last.date)}: ${parts.join(", ")}`;
}
