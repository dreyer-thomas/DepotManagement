// Chart choices (value-chart tab, Security chart mode) for server components. Not a server action file:
// the client writes these cookies (`chart-preference.ts`), server pages read the initial state here.
import { cookies } from "next/headers";
import {
  MOVING_AVERAGE_COOKIE,
  type MovingAverageChoice,
  parseMovingAverage,
  parseSecurityChartMode,
  parseValueChartTab,
  SECURITY_CHART_COOKIE,
  type SecurityChartMode,
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
