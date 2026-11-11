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
  PIVOTS_COOKIE,
  type PivotChoice,
  SECURITY_CHART_COOKIE,
  SECURITY_CHART_MODES,
  storeChartPreference,
} from "@/app/_components/charts/chart-preference";
import type { DrawdownChartDividend, DrawdownChartPoint, DrawdownSummary } from "@/app/_components/charts/drawdown-chart";
import type { PerformanceChartPoint } from "@/app/_components/charts/performance-chart";
import type {
  PriceChartAverage,
  PriceChartAverageWindow,
  PriceChartMarks,
  PriceChartPoint,
  PriceChartTrade,
} from "@/app/_components/charts/price-chart";
import { DEFAULT_ZIGZAG_THRESHOLD, ZIGZAG_THRESHOLDS, type ZigzagResult, type ZigzagThreshold } from "@/core/zigzag";
import { ValueChart } from "@/app/_components/charts/ValueChart";
import type { ChartPoint } from "@/app/_components/charts/value-chart";
import {
  CHART_MODE_LABELS,
  type ChartMode,
  MOVING_AVERAGE_LABEL,
  MOVING_AVERAGE_WINDOW_LABELS,
  PIVOT_THRESHOLD_GROUP_LABEL,
  PIVOT_THRESHOLD_LABELS,
  PIVOTS_LABEL,
} from "./labels";

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
  /** ZigZag pivots and Fibonacci levels per threshold (story 11.5); without them the "Wendepunkte" switch is not offered. */
  pivots?: Readonly<Record<ZigzagThreshold, ZigzagResult>>;
  /** The stored pivots choice (cookie) for the first render; default off. */
  initialPivots?: PivotChoice;
  /** Price marks as chart lines (story 12.3), drawn on "Kurs" only; absent or empty draws none. */
  marks?: PriceChartMarks;
};

const WINDOWS: readonly PriceChartAverageWindow[] = ["200", "38"];
const TOGGLE_SX = { minHeight: 44, minWidth: 44, px: 1.5, textTransform: "none" } as const;

/**
 * Hero chart of the Security page with the "Kurs" / "Wert" / "Performance" / "Drawdown" toggle (modes
 * without data are not offered — no value points, no "Wert"; a single mode shows no toggle) and, on
 * "Kurs", the optional "Gleitender Durchschnitt" overlay (200 / 38 Tage) and the "Wendepunkte" overlay
 * (ZigZag with Fibonacci levels at 5 / 8 / 12 %, story 11.5) plus the price marks (story 12.3). Switching never reloads the page; the
 * choices are stored in the `dm_security_chart`, `dm_moving_average` and `dm_pivots` cookies.
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
  pivots,
  initialPivots = "off",
  marks,
}: SecurityChartProps) {
  const modes = SECURITY_CHART_MODES.filter(
    (m) =>
      (m !== "value" || valuePoints.length > 0) &&
      (m !== "drawdown" || drawdown !== undefined) &&
      (m !== "performance" || performance !== undefined),
  );
  const [selected, setMode] = useState<ChartMode>(initialMode);
  const [averageOn, setAverageOn] = useState(initialMovingAverage !== "off");
  const [averageWindow, setAverageWindow] = useState<PriceChartAverageWindow>(
    initialMovingAverage === "off" ? "200" : initialMovingAverage,
  );
  const [pivotsOn, setPivotsOn] = useState(initialPivots !== "off");
  const [pivotThreshold, setPivotThreshold] = useState<ZigzagThreshold>(
    initialPivots === "off" ? DEFAULT_ZIGZAG_THRESHOLD : initialPivots,
  );
  const mode = modes.includes(selected) ? selected : "price";
  if (valuePoints.length === 0 && pricePoints.length === 0) return null;
  const overlay =
    movingAverages && averageOn ? { window: averageWindow, points: movingAverages[averageWindow] } : undefined;
  const storeAverage = (on: boolean, windowSize: PriceChartAverageWindow) =>
    storeChartPreference(MOVING_AVERAGE_COOKIE, on ? windowSize : "off");
  const pivotOverlay = pivots && pivotsOn ? { threshold: pivotThreshold, ...pivots[pivotThreshold] } : undefined;
  const storePivots = (on: boolean, threshold: ZigzagThreshold) =>
    storeChartPreference(PIVOTS_COOKIE, on ? threshold : "off");
  return (
    <Box sx={{ mt: 1.5 }}>
      {modes.length > 1 ? (
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
      ) : null}
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
      {mode === "price" && pivots ? (
        <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <FormControlLabel
            sx={{ minHeight: 44, mr: 0 }}
            control={
              <Switch
                checked={pivotsOn}
                onChange={(event) => {
                  setPivotsOn(event.target.checked);
                  storePivots(event.target.checked, pivotThreshold);
                }}
              />
            }
            label={PIVOTS_LABEL}
          />
          {pivotsOn ? (
            <ToggleButtonGroup
              value={pivotThreshold}
              exclusive
              size="small"
              aria-label={PIVOT_THRESHOLD_GROUP_LABEL}
              onChange={(_, next: ZigzagThreshold | null) => {
                if (next === null) return;
                setPivotThreshold(next);
                storePivots(true, next);
              }}
            >
              {ZIGZAG_THRESHOLDS.map((value) => (
                <ToggleButton key={value} value={value} sx={TOGGLE_SX}>
                  {PIVOT_THRESHOLD_LABELS[value]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          ) : null}
        </Box>
      ) : null}
      {mode === "price" ? <PriceChart points={pricePoints} trades={trades} average={overlay} pivots={pivotOverlay} marks={marks} /> : null}
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
