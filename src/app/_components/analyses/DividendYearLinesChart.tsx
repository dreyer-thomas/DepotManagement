"use client";

import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import type { DividendYearLine, DividendYearPoint } from "@/core/dividend-analysis";
import { formatMoney } from "@/core/format";
import { type DividendMode, HEATMAP_MONTH_LABELS, dividendAmount, dividendForecastLabel } from "./labels";

export type DividendYearLinesChartProps = {
  /** Text alternative (`role="figure"`). */
  ariaLabel: string;
  lines: readonly DividendYearLine[];
  /** Today's-year forecast (12 points), or `null` when the "Prognose" switch is off. */
  forecast: readonly DividendYearPoint[] | null;
  /** Business date; its year is emphasised and names the forecast. */
  today: string;
  mode: DividendMode;
  /** Colour of the `index`-th year (same palette as the Securities). */
  colorOf: (index: number) => string;
};

export const FORECAST_SERIES = "forecast";
const yearSeriesId = (year: string) => `year-${year}`;

/** Tick of the € axis: whole euros without the cent part. */
const tick = (value: number) => formatMoney(String(value)).replace(/,00(?=\s€)/, "");

/**
 * "Akkumuliert (pro Jahr)" (story 7.7): one cumulative January–December line per year with a legend,
 * today's year thicker, and optionally the forecast continuing today's year dashed (an estimate).
 * Plots exactly the given points; `Number(...)` only for coordinates.
 */
export function DividendYearLinesChart({ ariaLabel, lines, forecast, today, mode, colorOf }: DividendYearLinesChartProps) {
  const theme = useTheme();
  const grid = (theme.vars ?? theme).palette.divider;
  const todayYear = today.slice(0, 4);
  const todayIndex = lines.findIndex((line) => line.year === todayYear);
  const forecastColor = colorOf(todayIndex === -1 ? lines.length : todayIndex);
  const coordinates = (points: readonly DividendYearPoint[]) => points.map((point) => (point === null ? null : Number(dividendAmount(point, mode))));
  const formatter = (points: readonly DividendYearPoint[]) => (_value: number | null, { dataIndex }: { dataIndex: number }) => {
    const point = points[dataIndex];
    return point === null || point === undefined ? null : formatMoney(dividendAmount(point, mode));
  };

  return (
    <Box
      role="figure"
      aria-label={ariaLabel}
      sx={{
        mt: 1.5,
        width: "100%",
        minWidth: 0,
        height: { xs: 260, sm: 300 },
        "& .MuiLineChart-line": { strokeWidth: 2 },
        [`& .MuiLineChart-line[data-series="${yearSeriesId(todayYear)}"]`]: { strokeWidth: 4 },
        [`& .MuiLineChart-line[data-series="${FORECAST_SERIES}"]`]: { strokeWidth: 3, strokeDasharray: "6 4" },
        "& .MuiChartsGrid-line": { stroke: grid, strokeOpacity: 0.6 },
      }}
    >
      <LineChart
        skipAnimation
        disableLineItemHighlight
        grid={{ horizontal: true }}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        xAxis={[{ scaleType: "point", data: [...HEATMAP_MONTH_LABELS], disableTicks: true }]}
        yAxis={[{ width: 72, valueFormatter: tick }]}
        series={[
          ...lines.map((line, index) => ({
            id: yearSeriesId(line.year),
            label: line.year,
            data: coordinates(line.points),
            color: colorOf(index),
            curve: "linear" as const,
            showMark: false,
            valueFormatter: formatter(line.points),
          })),
          ...(forecast
            ? [
                {
                  id: FORECAST_SERIES,
                  label: dividendForecastLabel(todayYear),
                  data: coordinates(forecast),
                  color: forecastColor,
                  curve: "linear" as const,
                  showMark: false,
                  valueFormatter: formatter(forecast),
                },
              ]
            : []),
        ]}
      />
    </Box>
  );
}
