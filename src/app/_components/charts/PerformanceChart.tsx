"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { type Theme, useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { ChartsTooltipContainer, type ChartsTooltipProps, useAxesTooltip } from "@mui/x-charts/ChartsTooltip";
import { createContext, useContext, useMemo } from "react";
import type { DrawdownChartDividend } from "./drawdown-chart";
import {
  PERFORMANCE_LABEL,
  type PerformanceChartPoint,
  performanceAriaLabel,
  performanceFormatters,
  performanceTooltipLines,
  performanceYDomain,
  toPerformancePlotData,
} from "./performance-chart";
import type { PriceChartTrade } from "./price-chart";
import { tickDates } from "./value-chart";

export type PerformanceChartProps = {
  /** One point per day of the Period, cumulative TTWROR ratio strings. */
  points: readonly PerformanceChartPoint[];
  /** Trade markers, in the price chart's units. */
  trades?: readonly PriceChartTrade[];
  /** Dividend markers. */
  dividends?: readonly DrawdownChartDividend[];
};

const PERFORMANCE = "performance";
const BUY = "buy";
const SELL = "sell";
const DIVIDEND = "dividend";

/** Theme colors as CSS variables (dark mode follows the color scheme), plain palette as fallback. */
function colors(theme: Theme) {
  const palette = (theme.vars ?? theme).palette;
  return {
    line: palette.primary.main,
    buy: palette.chart?.series2 ?? palette.info.main,
    sell: palette.chart?.series3 ?? palette.warning.main,
    dividend: palette.accent?.main ?? palette.success.main,
    baseline: palette.text.secondary,
    grid: palette.divider,
  };
}

type TooltipData = {
  points: readonly PerformanceChartPoint[];
  trades: readonly PriceChartTrade[];
  dividends: readonly DrawdownChartDividend[];
};
const DataContext = createContext<TooltipData>({ points: [], trades: [], dividends: [] });

function TooltipContent() {
  const { points, trades, dividends } = useContext(DataContext);
  const axes = useAxesTooltip({ directions: ["x"] });
  const point = axes?.[0] ? points[axes[0].dataIndex] : undefined;
  if (!point) return null;
  const lines = performanceTooltipLines(point, trades, dividends);
  return (
    <Paper elevation={3} sx={{ borderRadius: 2, px: 1.5, py: 1, bgcolor: "background.paper", minWidth: 160, maxWidth: 320 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {lines.date}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto auto", columnGap: 2 }}>
        <Typography component="dt" variant="body2" color="text.secondary">
          {PERFORMANCE_LABEL}
        </Typography>
        <Typography component="dd" variant="figure" sx={{ m: 0, textAlign: "right", whiteSpace: "nowrap" }}>
          {lines.performance}
        </Typography>
      </Box>
      {lines.events.length > 0 ? (
        <Box component="ul" sx={{ m: 0, mt: 0.5, p: 0, listStyle: "none" }}>
          {lines.events.map((line, index) => (
            <Typography key={index} component="li" variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {line}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Paper>
  );
}

/** Axis-triggered tooltip (mouse, touch and keyboard) in a rounded surface card. */
function PerformanceTooltip(props: ChartsTooltipProps) {
  return (
    <ChartsTooltipContainer {...props} trigger="axis">
      <TooltipContent />
    </ChartsTooltipContainer>
  );
}

const NO_TRADES: readonly PriceChartTrade[] = [];
const NO_DIVIDENDS: readonly DrawdownChartDividend[] = [];

/**
 * Security performance chart ("Performance"): the cumulative time-weighted performance of the holding as
 * a primary line in percent with a 0 % reference line, buy/sell/dividend markers on the line and an axis
 * tooltip with the day's performance and events. Hidden without points. Plots exactly the given points;
 * the only computation is `Number(...)` for coordinates.
 */
export function PerformanceChart({ points, trades = NO_TRADES, dividends = NO_DIVIDENDS }: PerformanceChartProps) {
  const palette = colors(useTheme());
  const plot = useMemo(() => toPerformancePlotData(points, trades, dividends), [points, trades, dividends]);
  const ticks = useMemo(() => tickDates(plot.dates), [plot]);
  const format = useMemo(() => performanceFormatters(points), [points]);
  const data = useMemo(() => ({ points, trades, dividends }), [points, trades, dividends]);
  if (points.length === 0) return null;
  const markers = trades.length > 0 || dividends.length > 0;
  return (
    <Box
      role="figure"
      aria-label={performanceAriaLabel(points)}
      sx={{
        mt: 1.5,
        width: "100%",
        minWidth: 0,
        height: { xs: 160, sm: 200 },
        [`& .MuiLineChart-line[data-series="${PERFORMANCE}"]`]: { stroke: palette.line, strokeWidth: 2 },
        [`& .MuiLineChart-line[data-series="${BUY}"], & .MuiLineChart-line[data-series="${SELL}"], & .MuiLineChart-line[data-series="${DIVIDEND}"]`]:
          { display: "none" },
        [`& .MuiLineChart-mark[data-series="${BUY}"]`]: { fill: palette.buy, stroke: palette.buy },
        [`& .MuiLineChart-mark[data-series="${SELL}"]`]: { fill: palette.sell, stroke: palette.sell },
        [`& .MuiLineChart-mark[data-series="${DIVIDEND}"]`]: { fill: palette.dividend, stroke: palette.dividend },
        "& .MuiChartsReferenceLine-line": { stroke: palette.baseline, strokeWidth: 1 },
        "& .MuiChartsGrid-line": { stroke: palette.grid, strokeOpacity: 0.6 },
      }}
    >
      <DataContext.Provider value={data}>
        <LineChart
          skipAnimation
          hideLegend
          disableLineItemHighlight
          grid={{ horizontal: true }}
          axisHighlight={{ x: "line" }}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          xAxis={[
            {
              data: plot.dates,
              scaleType: "utc",
              tickInterval: ticks,
              tickLabelMinGap: 12,
              disableTicks: true,
              valueFormatter: format.x,
            },
          ]}
          yAxis={[{ position: "left", ...performanceYDomain(plot.values), width: 64, disableTicks: true, valueFormatter: format.y }]}
          series={[
            {
              id: PERFORMANCE,
              data: plot.values,
              curve: "linear",
              showMark: false,
              label: PERFORMANCE_LABEL,
              valueFormatter: format.value,
              color: palette.line,
            },
            ...(markers
              ? [
                  { id: BUY, data: plot.buys, showMark: true, shape: "triangle" as const, label: "Kauf", color: palette.buy },
                  { id: SELL, data: plot.sells, showMark: true, shape: "diamond" as const, label: "Verkauf", color: palette.sell },
                  { id: DIVIDEND, data: plot.dividends, showMark: true, shape: "circle" as const, label: "Dividende", color: palette.dividend },
                ]
              : []),
          ]}
          slots={{ tooltip: PerformanceTooltip }}
        >
          <ChartsReferenceLine y={0} />
        </LineChart>
      </DataContext.Provider>
    </Box>
  );
}
