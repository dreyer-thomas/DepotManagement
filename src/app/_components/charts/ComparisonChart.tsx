"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { type Theme, useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ChartsReferenceLine } from "@mui/x-charts/ChartsReferenceLine";
import { ChartsTooltipContainer, type ChartsTooltipProps, useAxesTooltip } from "@mui/x-charts/ChartsTooltip";
import { createContext, useContext, useMemo } from "react";
import { formatPercent } from "@/core/format";
import { comparisonAriaLabel, comparisonByDate, comparisonTooltipLines, toComparisonPlotData } from "./comparison-chart";
import { type PerformanceChartPoint, performanceFormatters, performanceYDomain } from "./performance-chart";
import { tickDates } from "./value-chart";

export type ComparisonChartProps = {
  /** The scope's cumulative TTWROR, one point per day from the valuation start (ratio strings). */
  line: readonly PerformanceChartPoint[];
  /** Legend and tooltip label of the scope line, e.g. "Portfolio" or the Depot name. */
  scopeLabel: string;
  /** The chosen comparison line (same dates) and its label; none draws the scope line only. */
  comparison?: { label: string; line: readonly PerformanceChartPoint[] } | null;
};

const SCOPE = "scope";
const COMPARISON = "comparison";
const DASH = "6 4";

/** Theme colors as CSS variables (dark mode follows the color scheme), plain palette as fallback. */
function colors(theme: Theme) {
  const palette = (theme.vars ?? theme).palette;
  return {
    scope: palette.primary.main,
    comparison: palette.chart?.series2 ?? palette.info.main,
    baseline: palette.text.secondary,
    grid: palette.divider,
  };
}

type TooltipData = {
  line: readonly PerformanceChartPoint[];
  scopeLabel: string;
  comparison: { label: string; byDate: Map<string, string> } | null;
};
const DataContext = createContext<TooltipData>({ line: [], scopeLabel: "", comparison: null });

function TooltipContent() {
  const { line, scopeLabel, comparison } = useContext(DataContext);
  const axes = useAxesTooltip({ directions: ["x"] });
  const point = axes?.[0] ? line[axes[0].dataIndex] : undefined;
  if (!point) return null;
  const lines = comparisonTooltipLines(point, scopeLabel, comparison);
  return (
    <Paper elevation={3} sx={{ borderRadius: 2, px: 1.5, py: 1, bgcolor: "background.paper", minWidth: 160, maxWidth: 320 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {lines.date}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto auto", columnGap: 2 }}>
        {lines.rows.map((row, index) => (
          // Keyed by series (row 0 = scope, row 1 = comparison): a Depot may share the scope's label.
          <Box key={index === 0 ? SCOPE : COMPARISON} sx={{ display: "contents" }}>
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

/** Axis-triggered tooltip (mouse, touch and keyboard) in a rounded surface card. */
function ComparisonTooltip(props: ChartsTooltipProps) {
  return (
    <ChartsTooltipContainer {...props} trigger="axis">
      <TooltipContent />
    </ChartsTooltipContainer>
  );
}

/** A legend entry: a short solid or dashed line sample in the series color, then the label. */
function LegendItem({ label, color, dashed }: { label: string; color: string; dashed: boolean }) {
  return (
    <Box component="li" sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
      <Box component="svg" aria-hidden width={24} height={8} viewBox="0 0 24 8" sx={{ flex: "none" }}>
        <line x1="0" y1="4" x2="24" y2="4" stroke={color} strokeWidth={2} strokeDasharray={dashed ? DASH : undefined} />
      </Box>
      <Typography variant="body2" component="span">
        {label}
      </Typography>
    </Box>
  );
}

/**
 * Performance comparison chart: the scope's cumulative TTWROR as a solid primary line and the optional
 * comparison as a dashed second line (distinguishable without colour), a 0 % reference line, a legend
 * and an axis tooltip with both values of the day. Hidden without points. Plots exactly the given
 * points; the only computation is `Number(...)` for coordinates.
 */
export function ComparisonChart({ line, scopeLabel, comparison = null }: ComparisonChartProps) {
  const palette = colors(useTheme());
  const comparisonLine = comparison?.line ?? null;
  const plot = useMemo(() => toComparisonPlotData(line, comparisonLine), [line, comparisonLine]);
  const ticks = useMemo(() => tickDates(plot.dates), [plot]);
  const format = useMemo(() => performanceFormatters(line), [line]);
  const comparisonLabel = comparison?.label ?? null;
  const data = useMemo(
    () => ({
      line,
      scopeLabel,
      comparison: comparisonLabel === null ? null : { label: comparisonLabel, byDate: comparisonByDate(comparisonLine) },
    }),
    [line, scopeLabel, comparisonLabel, comparisonLine],
  );
  if (line.length === 0) return null;
  const domain = performanceYDomain([...plot.scope, ...plot.comparison.filter((value): value is number => value !== null)]);
  const comparisonValue = (_: number | null, { dataIndex }: { dataIndex: number }): string => {
    const value = data.comparison?.byDate.get(line[dataIndex]?.date ?? "");
    return value === undefined ? "" : formatPercent(value);
  };
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box
        role="figure"
        aria-label={comparisonAriaLabel(line, scopeLabel, comparison)}
        sx={{
          width: "100%",
          minWidth: 0,
          height: { xs: 160, sm: 200 },
          [`& .MuiLineChart-line[data-series="${SCOPE}"]`]: { stroke: palette.scope, strokeWidth: 2 },
          [`& .MuiLineChart-line[data-series="${COMPARISON}"]`]: {
            stroke: palette.comparison,
            strokeWidth: 2,
            strokeDasharray: DASH,
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
                tickInterval: ticks,
                tickLabelMinGap: 12,
                disableTicks: true,
                valueFormatter: format.x,
              },
            ]}
            yAxis={[{ position: "left", ...domain, width: 64, disableTicks: true, valueFormatter: format.y }]}
            series={[
              {
                id: SCOPE,
                data: plot.scope,
                curve: "linear",
                showMark: false,
                label: scopeLabel,
                valueFormatter: format.value,
                color: palette.scope,
              },
              ...(comparison
                ? [
                    {
                      id: COMPARISON,
                      data: plot.comparison,
                      curve: "linear" as const,
                      showMark: false,
                      connectNulls: true,
                      label: comparison.label,
                      valueFormatter: comparisonValue,
                      color: palette.comparison,
                    },
                  ]
                : []),
            ]}
            slots={{ tooltip: ComparisonTooltip }}
          >
            <ChartsReferenceLine y={0} />
          </LineChart>
        </DataContext.Provider>
      </Box>
      <Box
        component="ul"
        aria-label="Legende"
        sx={{ m: 0, mt: 1, p: 0, listStyle: "none", display: "flex", flexWrap: "wrap", columnGap: 2, rowGap: 0.5 }}
      >
        <LegendItem label={scopeLabel} color={palette.scope} dashed={false} />
        {comparison ? <LegendItem label={comparison.label} color={palette.comparison} dashed /> : null}
      </Box>
    </Box>
  );
}
