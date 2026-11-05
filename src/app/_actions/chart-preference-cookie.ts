// Chart choices (value-chart tab, Security chart mode, technical indicator, …) for server components. Not a server action file:
// the client writes these cookies (`chart-preference.ts`), server pages read the initial state here.
import { cookies } from "next/headers";
import {
  BENCHMARK_COOKIE,
  MOVING_AVERAGE_COOKIE,
  type MovingAverageChoice,
  PIVOTS_COOKIE,
  type PivotChoice,
  parseBenchmarkChoice,
  parseMovingAverage,
  parsePivotChoice,
  parseSecurityChartMode,
  parseTechnicalIndicator,
  parseValueChartTab,
  SECURITY_CHART_COOKIE,
  type SecurityChartMode,
  TECHNICAL_INDICATOR_COOKIE,
  type TechnicalIndicator,
  VALUE_CHART_TAB_COOKIE,
  type ValueChartTab,
} from "@/app/_components/charts/chart-preference";

/** The stored value-chart tab of Overview and Depot detail; default `performance`. */
export async function readValueChartTab(): Promise<ValueChartTab> {
  return parseValueChartTab((await cookies()).get(VALUE_CHART_TAB_COOKIE)?.value);
}

/** The stored Security chart mode; default `price`. */
export async function readSecurityChartMode(): Promise<SecurityChartMode> {
  return parseSecurityChartMode((await cookies()).get(SECURITY_CHART_COOKIE)?.value);
}

/** The stored moving-average overlay of the "Kurs" chart; default `off`. */
export async function readMovingAverage(): Promise<MovingAverageChoice> {
  return parseMovingAverage((await cookies()).get(MOVING_AVERAGE_COOKIE)?.value);
}

/** The stored "Vergleich mit" choice when it is one of `availableKeys` on this page; otherwise `none`. */
export async function readBenchmarkChoice(availableKeys: readonly string[]): Promise<string> {
  return parseBenchmarkChoice((await cookies()).get(BENCHMARK_COOKIE)?.value, availableKeys);
}

/** The stored indicator of the "Technische Lage" chart; default `tsi`. */
export async function readTechnicalIndicator(): Promise<TechnicalIndicator> {
  return parseTechnicalIndicator((await cookies()).get(TECHNICAL_INDICATOR_COOKIE)?.value);
}

/** The stored pivots overlay of the "Kurs" chart (story 11.5); default `off`. */
export async function readPivotChoice(): Promise<PivotChoice> {
  return parsePivotChoice((await cookies()).get(PIVOTS_COOKIE)?.value);
}
