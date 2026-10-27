"use client";

import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import { BarChart } from "@mui/x-charts/BarChart";
import { formatMoney } from "@/core/format";

/** One bar series; `values` are chart coordinates only, `text` formats the tooltip from the exact value. */
export type BarsSeries = {
  id: string;
  label: string;
  color: string;
  values: (number | null)[];
  text: (index: number) => string | null;
  /** Series with the same stack are stacked (diverging, so negative values go below zero). */
  stack?: string;
};

export type BarsChartProps = {
  /** Text alternative with the per-category values (`role="figure"`). */
  ariaLabel: string;
  /** Axis label per category. */
  categories: readonly string[];
  series: readonly BarsSeries[];
};

/** Axis tick: whole euros without the cent part, e.g. `1.200 €`. */
const tick = (value: number) => formatMoney(String(value)).replace(/,00(?=\s€)/, "");

/**
 * Bar chart over categories (story 7.4): horizontal grid, legend, axis tooltip formatted by the
 * series' `text`. Plots exactly the given coordinates.
 */
export function BarsChart({ ariaLabel, categories, series }: BarsChartProps) {
  const theme = useTheme();
  const grid = (theme.vars ?? theme).palette.divider;
  return (
    <Box
      role="figure"
      aria-label={ariaLabel}
      sx={{ mt: 1.5, width: "100%", minWidth: 0, height: { xs: 220, sm: 260 }, "& .MuiChartsGrid-line": { stroke: grid, strokeOpacity: 0.6 } }}
    >
      <BarChart
        skipAnimation
        grid={{ horizontal: true }}
        margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        xAxis={[{ scaleType: "band", data: [...categories], disableTicks: true }]}
        yAxis={[{ width: 72, valueFormatter: tick }]}
        series={series.map((s) => ({
          id: s.id,
          label: s.label,
          color: s.color,
          data: s.values,
          stack: s.stack,
          stackOffset: s.stack ? ("diverging" as const) : undefined,
          valueFormatter: (_value: number | null, { dataIndex }: { dataIndex: number }) => s.text(dataIndex),
        }))}
      />
    </Box>
  );
}
