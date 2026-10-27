"use client";

import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useState } from "react";
import { DrawdownChart } from "@/app/_components/charts/DrawdownChart";
import { PriceChart } from "@/app/_components/charts/PriceChart";
import {
  parseSecurityChartMode,
  SECURITY_CHART_COOKIE,
  SECURITY_CHART_MODES,
  storeChartPreference,
} from "@/app/_components/charts/chart-preference";
import type { DrawdownChartDividend, DrawdownChartPoint, DrawdownSummary } from "@/app/_components/charts/drawdown-chart";
import type { PriceChartPoint, PriceChartTrade } from "@/app/_components/charts/price-chart";
import { ValueChart } from "@/app/_components/charts/ValueChart";
import type { ChartPoint } from "@/app/_components/charts/value-chart";
import { CHART_MODE_LABELS, type ChartMode } from "./labels";

export type SecurityChartProps = {
  /** The value chart's points (Security series), decimal strings. */
  valuePoints: readonly ChartPoint[];
  /** The daily price of the Period, decimal strings. */
  pricePoints: readonly PriceChartPoint[];
  trades: readonly PriceChartTrade[];
  /** The price drawdown of the Period (`core/drawdown`); without it the "Drawdown" mode is not offered. */
  drawdown?: DrawdownSummary & { points: readonly DrawdownChartPoint[] };
  /** DIVIDEND rows of the Period as markers of the "Drawdown" mode. */
  dividends?: readonly DrawdownChartDividend[];
  /** The stored mode (cookie) for the first render; default "Kurs". */
  initialMode?: ChartMode;
};

/**
 * Hero chart of the Security page with the "Kurs" / "Wert" / "Drawdown" toggle; switching never reloads
 * the page, the choice is stored in the `dm_security_chart` cookie.
 */
export function SecurityChart({ valuePoints, pricePoints, trades, drawdown, dividends = [], initialMode = "price" }: SecurityChartProps) {
  const modes = SECURITY_CHART_MODES.filter((m) => m !== "drawdown" || drawdown !== undefined);
  const [selected, setMode] = useState<ChartMode>(initialMode);
  const mode = modes.includes(selected) ? selected : "price";
  if (valuePoints.length === 0 && pricePoints.length === 0) return null;
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
          <ToggleButton key={m} value={m} sx={{ minHeight: 44, minWidth: 44, px: 1.5, textTransform: "none" }}>
            {CHART_MODE_LABELS[m]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {mode === "price" ? <PriceChart points={pricePoints} trades={trades} /> : null}
      {mode === "value" ? <ValueChart points={valuePoints} /> : null}
      {mode === "drawdown" && drawdown ? (
        <DrawdownChart points={drawdown.points} summary={drawdown} trades={trades} dividends={dividends} />
      ) : null}
    </Box>
  );
}
