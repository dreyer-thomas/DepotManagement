"use client";

import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useState } from "react";
import { PriceChart } from "@/app/_components/charts/PriceChart";
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
};

const MODES: readonly ChartMode[] = ["price", "value"];

/** Hero chart of the Security page with the "Kurs" / "Wert" toggle (default "Kurs"); local state only. */
export function SecurityChart({ valuePoints, pricePoints, trades }: SecurityChartProps) {
  const [mode, setMode] = useState<ChartMode>("price");
  if (valuePoints.length === 0 && pricePoints.length === 0) return null;
  return (
    <Box sx={{ mt: 1.5 }}>
      <ToggleButtonGroup
        value={mode}
        exclusive
        size="small"
        aria-label="Diagramm"
        onChange={(_, next: ChartMode | null) => {
          if (next !== null) setMode(next);
        }}
      >
        {MODES.map((m) => (
          <ToggleButton key={m} value={m} sx={{ minHeight: 44, minWidth: 44, px: 1.5, textTransform: "none" }}>
            {CHART_MODE_LABELS[m]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {mode === "price" ? <PriceChart points={pricePoints} trades={trades} /> : <ValueChart points={valuePoints} />}
    </Box>
  );
}
