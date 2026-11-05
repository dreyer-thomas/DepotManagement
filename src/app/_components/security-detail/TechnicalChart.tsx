"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { type Theme, useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { ChartsTooltipContainer, type ChartsTooltipProps, useAxesTooltip } from "@mui/x-charts/ChartsTooltip";
import { createContext, useContext, useMemo } from "react";
import { DEFAULT_TECHNICAL_INDICATOR, type TechnicalIndicator } from "@/app/_components/charts/chart-preference";
import { tickDates, utcDate } from "@/app/_components/charts/value-chart";
import { TECHNICAL_PARAMETERS, type TechnicalSeriesPoint } from "@/core/technical";
import {
  periodDates,
  technicalAriaLabel,
  technicalFormatters,
  technicalPlotData,
  technicalTooltipLines,
  TECHNICAL_INDICATOR_LABELS,
} from "./technical-labels";

export type TechnicalChartProps = {
  indicator: TechnicalIndicator;
  /** The indicator series dated `from..to` (trading days only), decimal strings. */
  points: readonly TechnicalSeriesPoint[];
  /** The page Period: the x-axis range, as the price chart's. */
  from: string;
  to: string;
};

const MAIN = "main";
const SIGNAL = "signal";
const HISTOGRAM_POSITIVE = "histogram-positive";
const HISTOGRAM_NEGATIVE = "histogram-negative";
const ZONE_OVERSOLD = "zone-oversold";
const ZONE_OVERBOUGHT = "zone-overbought";
/** Background series (areas only, never in the tooltip): their lines are hidden. */
const BACKGROUND = [HISTOGRAM_POSITIVE, HISTOGRAM_NEGATIVE, ZONE_OVERSOLD, ZONE_OVERBOUGHT];
const OVERSOLD = Number(TECHNICAL_PARAMETERS.rsi.oversold);
const OVERBOUGHT = Number(TECHNICAL_PARAMETERS.rsi.overbought);

/** Theme colors as CSS variables (dark mode follows the color scheme), plain palette as fallback. */
function colors(theme: Theme) {
  const palette = (theme.vars ?? theme).palette;
  return {
    main: palette.primary.main,
    signal: palette.chart?.invested ?? palette.grey[400],
    gainSoft: palette.gain?.soft ?? palette.success.light,
    lossSoft: palette.loss?.soft ?? palette.error.light,
    baseline: palette.text.secondary,
    grid: palette.divider,
  };
}

type TooltipData = { points: readonly TechnicalSeriesPoint[]; indicator: TechnicalIndicator };
const DataContext = createContext<TooltipData>({ points: [], indicator: DEFAULT_TECHNICAL_INDICATOR });

function TooltipContent() {
  const { points, indicator } = useContext(DataContext);
  const axes = useAxesTooltip({ directions: ["x"] });
  const point = axes?.[0] ? points[axes[0].dataIndex] : undefined;
  if (!point) return null;
  const lines = technicalTooltipLines(point, indicator);
  return (
    <Paper elevation={3} sx={{ borderRadius: 2, px: 1.5, py: 1, bgcolor: "background.paper", minWidth: 140 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {lines.date}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto auto", columnGap: 2 }}>
        {lines.rows.map((row) => (
          <Box key={row.label} sx={{ display: "contents" }}>
            <Typography component="dt" variant="body2" color="text.secondary">
              {row.label}
            </Typography>
            <Typography component="dd" variant="figure" sx={{ m: 0, textAlign: "right", whiteSpace: "nowrap" }}>
              {row.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

/** Axis-triggered crosshair tooltip (mouse, touch and keyboard) in a rounded surface card. */
function TechnicalTooltip(props: ChartsTooltipProps) {
  return (
    <ChartsTooltipContainer {...props} trigger="axis">
      <TooltipContent />
    </ChartsTooltipContainer>
  );
}

/**
 * Indicator chart of the card "Technische Lage": TSI with signal and zero line, RSI (0–100) with the shaded
 * 30/70 zones (areas spanning the plotted points), or MACD with signal line, histogram (gain-soft above, loss-soft below zero) and zero line.
 * The x-axis is the page Period `from..to` (as the price chart); only trading-day points are plotted.
 * Computes nothing: `Number(...)` only for coordinates.
 */
export function TechnicalChart({ indicator, points, from, to }: TechnicalChartProps) {
  const palette = colors(useTheme());
  const plot = useMemo(() => technicalPlotData(points, indicator), [points, indicator]);
  const ticks = useMemo(() => tickDates(periodDates(from, to)), [from, to]);
  const format = useMemo(() => technicalFormatters(points, from, to), [points, from, to]);
  const data = useMemo(() => ({ points, indicator }), [points, indicator]);
  const label = TECHNICAL_INDICATOR_LABELS[indicator];
  const histogram = indicator === "macd";
  // A single value draws no line segment: show it as a mark instead (e.g. 1T).
  const single = (values: readonly (number | null)[]) => values.filter((value) => value !== null).length <= 1;
  return (
    <Box
      role="figure"
      aria-label={technicalAriaLabel(points, indicator)}
      sx={{
        mt: 1.5,
        width: "100%",
        minWidth: 0,
        height: { xs: 160, sm: 200 },
        [`& .MuiLineChart-line[data-series="${MAIN}"]`]: { stroke: palette.main, strokeWidth: 2 },
        [`& .MuiLineChart-line[data-series="${SIGNAL}"]`]: { stroke: palette.signal, strokeWidth: 2 },
        [BACKGROUND.map((id) => `& .MuiLineChart-line[data-series="${id}"]`).join(", ")]: { display: "none" },
        [`& .MuiLineChart-area[data-series="${HISTOGRAM_POSITIVE}"], & .MuiLineChart-area[data-series="${ZONE_OVERSOLD}"]`]: {
          fill: palette.gainSoft,
          filter: "none",
          opacity: 1,
        },
        [`& .MuiLineChart-area[data-series="${HISTOGRAM_NEGATIVE}"], & .MuiLineChart-area[data-series="${ZONE_OVERBOUGHT}"]`]: {
          fill: palette.lossSoft,
          filter: "none",
          opacity: 1,
        },
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
              min: utcDate(from),
              max: utcDate(to),
              tickInterval: ticks,
              tickLabelMinGap: 12,
              disableTicks: true,
              valueFormatter: format.x,
            },
          ]}
          yAxis={[
            {
              position: "left",
              width: 56,
              disableTicks: true,
              valueFormatter: format.y,
              ...(indicator === "rsi" ? { min: 0, max: 100, tickInterval: [0, OVERSOLD, 50, OVERBOUGHT, 100] } : {}),
            },
          ]}
          series={[
            ...(indicator === "rsi"
              ? [
                  {
                    id: ZONE_OVERSOLD,
                    data: plot.dates.map(() => OVERSOLD),
                    area: true,
                    baseline: 0,
                    showMark: false,
                    label: "überverkauft-Zone",
                    color: palette.gainSoft,
                  },
                  {
                    id: ZONE_OVERBOUGHT,
                    data: plot.dates.map(() => 100),
                    area: true,
                    baseline: OVERBOUGHT,
                    showMark: false,
                    label: "überkauft-Zone",
                    color: palette.lossSoft,
                  },
                ]
              : []),
            ...(histogram
              ? [
                  {
                    id: HISTOGRAM_POSITIVE,
                    data: plot.histogramPositive,
                    area: true,
                    baseline: 0,
                    curve: "stepBefore" as const,
                    showMark: false,
                    label: "Histogramm",
                    color: palette.gainSoft,
                  },
                  {
                    id: HISTOGRAM_NEGATIVE,
                    data: plot.histogramNegative,
                    area: true,
                    baseline: 0,
                    curve: "stepBefore" as const,
                    showMark: false,
                    label: "Histogramm",
                    color: palette.lossSoft,
                  },
                ]
              : []),
            { id: MAIN, data: plot.main, curve: "linear", showMark: single(plot.main), label, color: palette.main },
            ...(indicator === "rsi"
              ? []
              : [
                  {
                    id: SIGNAL,
                    data: plot.signal,
                    curve: "linear" as const,
                    showMark: single(plot.signal),
                    label: "Signal",
                    color: palette.signal,
                  },
                ]),
          ]}
          slots={{ tooltip: TechnicalTooltip }}
        >
          {indicator === "rsi" ? (
            <>
              <ChartsReferenceLine y={OVERSOLD} />
              <ChartsReferenceLine y={OVERBOUGHT} />
            </>
          ) : (
            <ChartsReferenceLine y={0} />
          )}
        </LineChart>
      </DataContext.Provider>
    </Box>
  );
}
