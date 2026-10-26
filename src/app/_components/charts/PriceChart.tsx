"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { type Theme, useTheme } from "@mui/material/styles";
import { LineChart } from "@mui/x-charts/LineChart";
import { ChartsTooltipContainer, type ChartsTooltipProps, useAxesTooltip } from "@mui/x-charts/ChartsTooltip";
import { createContext, useContext, useMemo } from "react";
import {
  NO_PRICE_HISTORY_TEXT,
  type PriceChartPoint,
  type PriceChartTrade,
  hasPriceHistory,
  priceChartAriaLabel,
  priceTooltipLines,
  priceXFormatter,
  toPricePlotData,
} from "./price-chart";
import { tickDates } from "./value-chart";

export type PriceChartProps = {
  /** One point per day, decimal strings (`null` before the first known price). */
  points: readonly PriceChartPoint[];
  /** Trades of the range, in the chart's units. */
  trades: readonly PriceChartTrade[];
};

const PRICE = "price";
const BUY = "buy";
const SELL = "sell";

/** Theme colors as CSS variables (dark mode follows the color scheme), plain palette as fallback. */
function colors(theme: Theme) {
  const palette = (theme.vars ?? theme).palette;
  return {
    price: palette.primary.main,
    buy: palette.chart?.series2 ?? palette.info.main,
    sell: palette.chart?.series3 ?? palette.warning.main,
    grid: palette.divider,
  };
}

type TooltipData = { points: readonly PriceChartPoint[]; trades: readonly PriceChartTrade[] };
const DataContext = createContext<TooltipData>({ points: [], trades: [] });

function TooltipContent() {
  const { points, trades } = useContext(DataContext);
  const axes = useAxesTooltip({ directions: ["x"] });
  const point = axes?.[0] ? points[axes[0].dataIndex] : undefined;
  if (!point) return null;
  const lines = priceTooltipLines(point, trades);
  return (
    <Paper elevation={3} sx={{ borderRadius: 2, px: 1.5, py: 1, bgcolor: "background.paper", minWidth: 160, maxWidth: 320 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {lines.date}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto auto", columnGap: 2 }}>
        <Typography component="dt" variant="body2" color="text.secondary">
          Kurs
        </Typography>
        <Typography component="dd" variant="figure" sx={{ m: 0, textAlign: "right", whiteSpace: "nowrap" }}>
          {lines.price}
        </Typography>
      </Box>
      {lines.trades.length > 0 ? (
        <Box component="ul" sx={{ m: 0, mt: 0.5, p: 0, listStyle: "none" }}>
          {lines.trades.map((line, index) => (
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
function PriceTooltip(props: ChartsTooltipProps) {
  return (
    <ChartsTooltipContainer {...props} trigger="axis">
      <TooltipContent />
    </ChartsTooltipContainer>
  );
}

/**
 * Price chart ("Kurs"): the split-adjusted daily price as a 3 px primary line without area, buys as
 * triangles and sells as diamonds on the line, horizontal grid only, axis tooltip with the day's trades.
 * Plots exactly the given points; the only computation is `Number(...)` for coordinates.
 */
export function PriceChart({ points, trades }: PriceChartProps) {
  const palette = colors(useTheme());
  const plot = useMemo(() => toPricePlotData(points, trades), [points, trades]);
  const ticks = useMemo(() => tickDates(plot.dates), [plot]);
  const formatX = useMemo(() => priceXFormatter(points), [points]);
  const data = useMemo(() => ({ points, trades }), [points, trades]);
  if (points.length === 0) return null;
  if (!hasPriceHistory(points)) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
        {NO_PRICE_HISTORY_TEXT}
      </Typography>
    );
  }
  return (
    <Box
      role="figure"
      aria-label={priceChartAriaLabel(points, trades)}
      sx={{
        mt: 1.5,
        width: "100%",
        minWidth: 0,
        height: { xs: 160, sm: 200 },
        [`& .MuiLineChart-line[data-series="${PRICE}"]`]: { stroke: palette.price, strokeWidth: 3 },
        [`& .MuiLineChart-line[data-series="${BUY}"], & .MuiLineChart-line[data-series="${SELL}"]`]: { display: "none" },
        [`& .MuiLineChart-mark[data-series="${BUY}"]`]: { fill: palette.buy, stroke: palette.buy },
        [`& .MuiLineChart-mark[data-series="${SELL}"]`]: { fill: palette.sell, stroke: palette.sell },
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
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          xAxis={[
            {
              data: plot.dates,
              scaleType: "utc",
              tickInterval: ticks,
              tickLabelMinGap: 12,
              disableTicks: true,
              valueFormatter: formatX,
            },
          ]}
          yAxis={[{ position: "none" }]}
          series={[
            { id: PRICE, data: plot.prices, curve: "linear", showMark: false, label: "Kurs", color: palette.price },
            { id: BUY, data: plot.buys, showMark: true, shape: "triangle", label: "Kauf", color: palette.buy },
            { id: SELL, data: plot.sells, showMark: true, shape: "diamond", label: "Verkauf", color: palette.sell },
          ]}
          slots={{ tooltip: PriceTooltip }}
        />
      </DataContext.Provider>
    </Box>
  );
}
