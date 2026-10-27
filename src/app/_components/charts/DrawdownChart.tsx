"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { type Theme, useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { ChartsTooltipContainer, type ChartsTooltipProps, useAxesTooltip } from "@mui/x-charts/ChartsTooltip";
import { createContext, useContext, useId, useMemo } from "react";
import { Kpi } from "@/app/_components/valuation/Kpi";
import {
  DRAWDOWN_KPI_LABELS,
  type DrawdownChartDividend,
  type DrawdownChartPoint,
  type DrawdownSummary,
  NO_DRAWDOWN_TEXT,
  drawdownAriaLabel,
  drawdownFormatters,
  drawdownKpiTexts,
  drawdownTooltipLines,
  drawdownYMin,
  hasDrawdown,
  toDrawdownPlotData,
} from "./drawdown-chart";
import type { PriceChartTrade } from "./price-chart";
import { tickDates } from "./value-chart";

export type DrawdownChartProps = {
  /** One point per day of the Period, ratio strings (`null` without a level). */
  points: readonly DrawdownChartPoint[];
  /** Current and maximum drawdown and the maximum's phase (`core/drawdown`). */
  summary: DrawdownSummary;
  /** Optional trade markers (Security detail), in the chart's units. */
  trades?: readonly PriceChartTrade[];
  /** Optional dividend markers (Security detail). */
  dividends?: readonly DrawdownChartDividend[];
};

const DRAWDOWN = "drawdown";
const BUY = "buy";
const SELL = "sell";
const DIVIDEND = "dividend";

/** Theme colors as CSS variables (dark mode follows the color scheme), plain palette as fallback. */
function colors(theme: Theme) {
  const palette = (theme.vars ?? theme).palette;
  return {
    loss: palette.loss?.main ?? palette.error.main,
    buy: palette.chart?.series2 ?? palette.info.main,
    sell: palette.chart?.series3 ?? palette.warning.main,
    dividend: palette.accent?.main ?? palette.success.main,
    baseline: palette.text.secondary,
    grid: palette.divider,
  };
}

type TooltipData = {
  points: readonly DrawdownChartPoint[];
  trades: readonly PriceChartTrade[];
  dividends: readonly DrawdownChartDividend[];
};
const DataContext = createContext<TooltipData>({ points: [], trades: [], dividends: [] });

function TooltipContent() {
  const { points, trades, dividends } = useContext(DataContext);
  const axes = useAxesTooltip({ directions: ["x"] });
  const point = axes?.[0] ? points[axes[0].dataIndex] : undefined;
  if (!point) return null;
  const lines = drawdownTooltipLines(point, trades, dividends);
  return (
    <Paper elevation={3} sx={{ borderRadius: 2, px: 1.5, py: 1, bgcolor: "background.paper", minWidth: 160, maxWidth: 320 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {lines.date}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto auto", columnGap: 2 }}>
        <Typography component="dt" variant="body2" color="text.secondary">
          Drawdown
        </Typography>
        <Typography component="dd" variant="figure" sx={{ m: 0, textAlign: "right", whiteSpace: "nowrap" }}>
          {lines.drawdown}
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
function DrawdownTooltip(props: ChartsTooltipProps) {
  return (
    <ChartsTooltipContainer {...props} trigger="axis">
      <TooltipContent />
    </ChartsTooltipContainer>
  );
}

/** KPI row: current and maximum drawdown, duration and dates of the maximum's phase. */
export function DrawdownKpis({ summary }: { summary: DrawdownSummary }) {
  const texts = drawdownKpiTexts(summary);
  return (
    <Box
      sx={{
        mt: 1.5,
        display: "grid",
        gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
        gap: 1.5,
      }}
    >
      <Kpi label={DRAWDOWN_KPI_LABELS.current} value={texts.current} color="loss.main" />
      <Kpi label={DRAWDOWN_KPI_LABELS.max} value={texts.max} color="loss.main" />
      <Kpi label={DRAWDOWN_KPI_LABELS.duration} value={texts.duration} color="primary.main" note={texts.durationNote} />
      <Kpi label={DRAWDOWN_KPI_LABELS.period} value={texts.period} color="primary.main" />
    </Box>
  );
}

const NO_TRADES: readonly PriceChartTrade[] = [];
const NO_DIVIDENDS: readonly DrawdownChartDividend[] = [];

/**
 * Drawdown chart: the decline below the running peak as a red area between the 0 % baseline and the
 * line, y-axis in percent, optional buy/sell/dividend markers on the line, axis tooltip with the day's
 * drawdown and events, KPI row below. Hidden without points. Plots exactly the given points; the only
 * computation is `Number(...)` for coordinates.
 */
export function DrawdownChart({ points, summary, trades = NO_TRADES, dividends = NO_DIVIDENDS }: DrawdownChartProps) {
  const palette = colors(useTheme());
  const gradientId = `drawdown-chart-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const plot = useMemo(() => toDrawdownPlotData(points, trades, dividends), [points, trades, dividends]);
  const ticks = useMemo(() => tickDates(plot.dates), [plot]);
  const format = useMemo(() => drawdownFormatters(points), [points]);
  const data = useMemo(() => ({ points, trades, dividends }), [points, trades, dividends]);
  if (points.length === 0) return null;
  const markers = trades.length > 0 || dividends.length > 0;
  return (
    <Box>
      {hasDrawdown(points) ? (
        <Box
          role="figure"
          aria-label={drawdownAriaLabel(points, summary.max)}
          sx={{
            mt: 1.5,
            width: "100%",
            minWidth: 0,
            height: { xs: 160, sm: 200 },
            [`& .MuiLineChart-line[data-series="${DRAWDOWN}"]`]: { stroke: palette.loss, strokeWidth: 2 },
            [`& .MuiLineChart-area[data-series="${DRAWDOWN}"]`]: { fill: `url(#${gradientId})`, filter: "none" },
            [`& #${gradientId} stop`]: { stopColor: palette.loss },
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
              yAxis={[{ position: "left", min: drawdownYMin(plot.values), max: 0, width: 64, disableTicks: true, valueFormatter: format.y }]}
              series={[
                {
                  id: DRAWDOWN,
                  data: plot.values,
                  area: true,
                  baseline: 0,
                  curve: "linear",
                  showMark: false,
                  label: "Drawdown",
                  valueFormatter: format.value,
                  color: palette.loss,
                },
                ...(markers
                  ? [
                      { id: BUY, data: plot.buys, showMark: true, shape: "triangle" as const, label: "Kauf", color: palette.buy },
                      { id: SELL, data: plot.sells, showMark: true, shape: "diamond" as const, label: "Verkauf", color: palette.sell },
                      { id: DIVIDEND, data: plot.dividends, showMark: true, shape: "circle" as const, label: "Dividende", color: palette.dividend },
                    ]
                  : []),
              ]}
              slots={{ tooltip: DrawdownTooltip }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopOpacity={0.15} />
                  <stop offset="100%" stopOpacity={0.45} />
                </linearGradient>
              </defs>
              <ChartsReferenceLine y={0} />
            </LineChart>
          </DataContext.Provider>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {NO_DRAWDOWN_TEXT}
        </Typography>
      )}
      <DrawdownKpis summary={summary} />
    </Box>
  );
}
