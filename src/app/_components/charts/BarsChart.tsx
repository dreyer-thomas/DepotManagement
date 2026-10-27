"use client";

import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import { BarChart } from "@mui/x-charts/BarChart";
import { ChartsTooltipContainer, type ChartsTooltipProps, useItemTooltip } from "@mui/x-charts/ChartsTooltip";
import { createContext, type ReactNode, useContext } from "react";
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
  /** Optional label drawn above the bar at `index` (`null` for none). */
  barLabel?: (index: number) => string | null;
};

/** The bar an item tooltip is shown for. */
export type BarsItem = { seriesId: string; dataIndex: number };

export type BarsChartProps = {
  /** Text alternative with the per-category values (`role="figure"`). */
  ariaLabel: string;
  /** Axis label per category. */
  categories: readonly string[];
  series: readonly BarsSeries[];
  /** Hide the legend (e.g. when the series are explained elsewhere). */
  hideLegend?: boolean;
  /** Item-triggered tooltip content for one bar segment (hover, tap); default: axis tooltip. */
  itemTooltip?: (item: BarsItem) => ReactNode;
};

/** Axis tick: whole euros without the cent part, e.g. `1.200 €`. */
const tick = (value: number) => formatMoney(String(value)).replace(/,00(?=\s€)/, "");

const ItemTooltipContext = createContext<((item: BarsItem) => ReactNode) | null>(null);

function ItemTooltipContent() {
  const render = useContext(ItemTooltipContext);
  const item = useItemTooltip<"bar">();
  if (!render || !item) return null;
  return <>{render({ seriesId: String(item.identifier.seriesId), dataIndex: item.identifier.dataIndex })}</>;
}

/** Item-triggered tooltip (mouse, touch and keyboard focus on a bar). */
function ItemTooltip(props: ChartsTooltipProps) {
  return (
    <ChartsTooltipContainer {...props} trigger="item">
      <ItemTooltipContent />
    </ChartsTooltipContainer>
  );
}

/**
 * Bar chart over categories (story 7.4): horizontal grid, legend, axis tooltip formatted by the
 * series' `text`. Plots exactly the given coordinates. Optional (story 7.7): labels above bars, hidden
 * legend and an item tooltip.
 */
export function BarsChart({ ariaLabel, categories, series, hideLegend, itemTooltip }: BarsChartProps) {
  const theme = useTheme();
  const grid = (theme.vars ?? theme).palette.divider;
  const labelled = series.some((s) => s.barLabel !== undefined);
  return (
    <Box
      role="figure"
      aria-label={ariaLabel}
      sx={{ mt: 1.5, width: "100%", minWidth: 0, height: { xs: 220, sm: 260 }, "& .MuiChartsGrid-line": { stroke: grid, strokeOpacity: 0.6 } }}
    >
      <ItemTooltipContext.Provider value={itemTooltip ?? null}>
        <BarChart
          skipAnimation
          hideLegend={hideLegend}
          grid={{ horizontal: true }}
          // Room above the tallest bar for an outside total label.
          margin={{ top: labelled ? 24 : 8, right: 8, bottom: 0, left: 8 }}
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
            ...(s.barLabel
              ? { barLabel: (item: { dataIndex: number }) => s.barLabel?.(item.dataIndex) ?? null, barLabelPlacement: "outside" as const }
              : {}),
          }))}
          slots={itemTooltip ? { tooltip: ItemTooltip } : undefined}
        />
      </ItemTooltipContext.Provider>
    </Box>
  );
}
