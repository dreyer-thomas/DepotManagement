"use client";

import Box from "@mui/material/Box";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useState } from "react";
import { DrawdownChart } from "@/app/_components/charts/DrawdownChart";
import { PerformanceChart } from "@/app/_components/charts/PerformanceChart";
import { PriceChart } from "@/app/_components/charts/PriceChart";
import {
  MOVING_AVERAGE_COOKIE,
  type MovingAverageChoice,
  parseSecurityChartMode,
  SECURITY_CHART_COOKIE,
  SECURITY_CHART_MODES,
  storeChartPreference,
} from "@/app/_components/charts/chart-preference";
import type { DrawdownChartDividend, DrawdownChartPoint, DrawdownSummary } from "@/app/_components/charts/drawdown-chart";
import type { PerformanceChartPoint } from "@/app/_components/charts/performance-chart";
import type {
  PriceChartAverage,
  PriceChartAverageWindow,
  PriceChartPoint,
  PriceChartTrade,
} from "@/app/_components/charts/price-chart";
import { ValueChart } from "@/app/_components/charts/ValueChart";
import type { ChartPoint } from "@/app/_components/charts/value-chart";
import { CHART_MODE_LABELS, type ChartMode, MOVING_AVERAGE_LABEL, MOVING_AVERAGE_WINDOW_LABELS } from "./labels";

export type SecurityChartProps = {
  /** The value chart's points (Security series), decimal strings. */
  valuePoints: readonly ChartPoint[];
  /** The daily price of the Period, decimal strings. */
  pricePoints: readonly PriceChartPoint[];
  trades: readonly PriceChartTrade[];
  /** The price drawdown of the Period (`core/drawdown`); without it the "Drawdown" mode is not offered. */
  drawdown?: DrawdownSummary & { points: readonly DrawdownChartPoint[] };
  /** DIVIDEND rows of the Period as markers of the "Drawdown" and "Performance" modes. */
  dividends?: readonly DrawdownChartDividend[];
  /** The cumulative performance per Period day; without it the "Performance" mode is not offered. */
  performance?: readonly PerformanceChartPoint[];
  /** Moving averages of the Period per window; without them the "Kurs" overlay is not offered. */
  movingAverages?: Readonly<Record<PriceChartAverageWindow, readonly PriceChartAverage[]>>;
  /** The stored mode (cookie) for the first render; default "Kurs". */
  initialMode?: ChartMode;
  /** The stored overlay (cookie) for the first render; default off. */
  initialMovingAverage?: MovingAverageChoice;
};

const WINDOWS: readonly PriceChartAverageWindow[] = ["200", "38"];
const TOGGLE_SX = { minHeight: 44, minWidth: 44, px: 1.5, textTransform: "none" } as const;

/**
 * Hero chart of the Security page with the "Kurs" / "Wert" / "Performance" / "Drawdown" toggle and, on
 * "Kurs", the optional "Gleitender Durchschnitt" overlay (200 / 38 Tage). Switching never reloads the
 * page; the choices are stored in the `dm_security_chart` and `dm_moving_average` cookies.
 */
export function SecurityChart({
  valuePoints,
  pricePoints,
  trades,
  drawdown,
  dividends = [],
  performance,
  movingAverages,
  initialMode = "price",
  initialMovingAverage = "off",
}: SecurityChartProps) {
  const modes = SECURITY_CHART_MODES.filter(
    (m) => (m !== "drawdown" || drawdown !== undefined) && (m !== "performance" || performance !== undefined),
  );
  const [selected, setMode] = useState<ChartMode>(initialMode);
  const [averageOn, setAverageOn] = useState(initialMovingAverage !== "off");
  const [averageWindow, setAverageWindow] = useState<PriceChartAverageWindow>(
    initialMovingAverage === "off" ? "200" : initialMovingAverage,
  );
  const mode = modes.includes(selected) ? selected : "price";
  if (valuePoints.length === 0 && pricePoints.length === 0) return null;
  const overlay =
    movingAverages && averageOn ? { window: averageWindow, points: movingAverages[averageWindow] } : undefined;
  const storeAverage = (on: boolean, windowSize: PriceChartAverageWindow) =>
    storeChartPreference(MOVING_AVERAGE_COOKIE, on ? windowSize : "off");
  return (
    <Box sx={{ mt: 1.5 }}>
      <ToggleButtonGroup
        value={mode}
        exclusive
        size="small"
        aria-label="Diagramm"
        onChange={(_, next: string | null) => {
          if (next === null) return;
          const value = parseSecurityChartMode(next);
          setMode(value);
          storeChartPreference(SECURITY_CHART_COOKIE, value);
        }}
      >
        {modes.map((m) => (
          <ToggleButton key={m} value={m} sx={TOGGLE_SX}>
            {CHART_MODE_LABELS[m]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {mode === "price" && movingAverages ? (
        <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <FormControlLabel
            sx={{ minHeight: 44, mr: 0 }}
            control={
              <Switch
                checked={averageOn}
                onChange={(event) => {
                  setAverageOn(event.target.checked);
                  storeAverage(event.target.checked, averageWindow);
                }}
              />
            }
            label={MOVING_AVERAGE_LABEL}
          />
          {averageOn ? (
            <ToggleButtonGroup
              value={averageWindow}
              exclusive
              size="small"
              aria-label="Zeitfenster"
              onChange={(_, next: PriceChartAverageWindow | null) => {
                if (next === null) return;
                setAverageWindow(next);
                storeAverage(true, next);
              }}
            >
              {WINDOWS.map((value) => (
                <ToggleButton key={value} value={value} sx={TOGGLE_SX}>
                  {MOVING_AVERAGE_WINDOW_LABELS[value]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : null}
        </Box>
      ) : null}
      {mode === "price" ? <PriceChart points={pricePoints} trades={trades} average={overlay} /> : null}
      {mode === "value" ? <ValueChart points={valuePoints} /> : null}
      {mode === "performance" && performance ? (
        <PerformanceChart points={performance} trades={trades} dividends={dividends} />
      ) : null}
      {mode === "drawdown" && drawdown ? (
        <DrawdownChart points={drawdown.points} summary={drawdown} trades={trades} dividends={dividends} />
      ) : null}
    </Box>
  );
}
