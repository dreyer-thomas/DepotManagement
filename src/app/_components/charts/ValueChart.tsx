"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { type Theme, useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ChartsTooltipContainer, type ChartsTooltipProps, useAxesTooltip } from "@mui/x-charts/ChartsTooltip";
import { createContext, useContext, useId, useMemo } from "react";
import { type ChartPoint, chartAriaLabel, chartFormatters, tickDates, toPlotData, tooltipLines } from "./value-chart";

export type ValueChartProps = {
  /** One point per day, decimal strings (value and invested capital). */
  points: readonly ChartPoint[];
  /** Accessible name; defaults to the Period with first/last value and invested capital. */
  ariaLabel?: string;
};

const VALUE = "value";
const INVESTED = "invested";

/**
 * Series colors as CSS variables of the theme, so dark mode follows the color scheme class; falls back
 * to the plain palette outside the app theme (e.g. a bare server render in tests).
 */
function colors(theme: Theme) {
  const palette = (theme.vars ?? theme).palette;
  return {
    value: palette.primary.main,
    invested: palette.chart?.invested ?? palette.grey[400],
    grid: palette.divider,
  };
}

/** The original points, so the tooltip formats from the decimal strings by data index. */
const PointsContext = createContext<readonly ChartPoint[]>([]);

function TooltipContent() {
  const points = useContext(PointsContext);
  const axes = useAxesTooltip({ directions: ["x"] });
  const point = axes?.[0] ? points[axes[0].dataIndex] : undefined;
  if (!point) return null;
  const lines = tooltipLines(point);
  return (
    <Paper elevation={3} sx={{ borderRadius: 2, px: 1.5, py: 1, bgcolor: "background.paper", minWidth: 160 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {lines.date}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto auto", columnGap: 2 }}>
        <Typography component="dt" variant="body2" color="text.secondary">
          Wert
        </Typography>
        <Typography component="dd" variant="figure" sx={{ m: 0, textAlign: "right", whiteSpace: "nowrap" }}>
          {lines.value}
        </Typography>
        <Typography component="dt" variant="body2" color="text.secondary">
          Investiert
        </Typography>
        <Typography component="dd" variant="figure" sx={{ m: 0, textAlign: "right", whiteSpace: "nowrap" }}>
          {lines.invested}
        </Typography>
      </Box>
    </Paper>
  );
}

/** Axis-triggered tooltip (mouse, touch and keyboard) in a rounded surface card. */
function ValueTooltip(props: ChartsTooltipProps) {
  return (
    <ChartsTooltipContainer {...props} trigger="axis">
      <TooltipContent />
    </ChartsTooltipContainer>
  );
}

/**
 * Value development chart (DESIGN.md `area-chart`): value as a 3 px primary line with a vertical
 * gradient fill, invested capital as a dashed line, horizontal grid only, axis tooltip. Plots exactly
 * the given points; the only computation is `Number(...)` for coordinates (`toPlotData`).
 */
export function ValueChart({ points, ariaLabel }: ValueChartProps) {
  const palette = colors(useTheme());
  const gradientId = `value-chart-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const plot = useMemo(() => toPlotData(points), [points]);
  const ticks = useMemo(() => tickDates(plot.dates), [plot]);
  const format = useMemo(() => chartFormatters(points), [points]);
  const label = ariaLabel ?? chartAriaLabel(points);
  if (points.length === 0) return null;
  return (
    <Box
      role="figure"
      aria-label={label}
      sx={{
        mt: 1.5,
        width: "100%",
        minWidth: 0,
        height: { xs: 160, sm: 200 },
        [`& .MuiLineChart-line[data-series="${VALUE}"]`]: { stroke: palette.value, strokeWidth: 3 },
        [`& .MuiLineChart-area[data-series="${VALUE}"]`]: { fill: `url(#${gradientId})`, filter: "none" },
        [`& .MuiLineChart-line[data-series="${INVESTED}"]`]: {
          stroke: palette.invested,
          strokeWidth: 2,
          strokeDasharray: "6 4",
        },
        [`& #${gradientId} stop`]: { stopColor: palette.value },
        "& .MuiChartsGrid-line": { stroke: palette.grid, strokeOpacity: 0.6 },
      }}
    >
      <PointsContext.Provider value={points}>
        <LineChart
          skipAnimation
          hideLegend
          disableLineItemHighlight
          grid={{ horizontal: true }}
          axisHighlight={{ x: "line" }}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
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
          yAxis={[{ position: "none" }]}
          series={[
            {
              id: VALUE,
              data: plot.values,
              area: true,
              baseline: "min",
              curve: "linear",
              showMark: false,
              label: "Wert",
              valueFormatter: format.value,
              color: palette.value,
            },
            {
              id: INVESTED,
              data: plot.invested,
              curve: "linear",
              showMark: false,
              label: "Investiert",
              valueFormatter: format.invested,
              color: palette.invested,
            },
          ]}
          slots={{ tooltip: ValueTooltip }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopOpacity={0.35} />
              <stop offset="100%" stopOpacity={0} />
            </linearGradient>
          </defs>
        </LineChart>
      </PointsContext.Provider>
    </Box>
  );
}
