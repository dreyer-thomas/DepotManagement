"use client";

import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { ComparisonChart } from "@/app/_components/charts/ComparisonChart";
import { BENCHMARK_COOKIE, NO_BENCHMARK_CHOICE, storeChartPreference } from "@/app/_components/charts/chart-preference";
import { returnDifference } from "@/core/benchmarks";
import { formatPercent, formatPercentagePoints } from "@/core/format";
import { NO_COMPARISON_LABEL, type PerformanceComparison } from "./comparison-options";
import { Kpi } from "./Kpi";

export type PerformancePanelProps = PerformanceComparison;

export const NO_PRICES_TEXT = "Keine Kurse für den Vergleich";
export const PERFORMANCE_KPI_LABEL = "Performance";
export const DIFFERENCE_KPI_LABEL = "Differenz";

/**
 * The "Performance" tab of the hero card: a "Vergleich mit" select, the scope's cumulative TTWROR with
 * the chosen comparison as a dashed line, and a KPI row (scope return, comparison return, difference in
 * percentage points). A comparison without prices shows "Keine Kurse für den Vergleich" instead of its
 * line and KPIs. The KPIs show each line's Period return (`ttwror`, so the scope KPI equals the hero
 * TTWROR; `null` → "–") and the difference only when both are non-null. The choice is stored in the
 * `dm_benchmark` cookie; switching never reloads the page.
 */
export function PerformancePanel({ scopeLabel, line, ttwror, options, initialChoice }: PerformancePanelProps) {
  const [choice, setChoice] = useState(initialChoice);
  const option = options.find((candidate) => candidate.key === choice) ?? null;
  const comparison = option?.line ? { label: option.label, line: option.line } : null;
  const comparisonReturn = option?.ttwror ?? null;
  const difference = returnDifference(ttwror, comparisonReturn);
  return (
    <Box>
      <TextField
        select
        label="Vergleich mit"
        value={option ? option.key : NO_BENCHMARK_CHOICE}
        onChange={(event) => {
          setChoice(event.target.value);
          storeChartPreference(BENCHMARK_COOKIE, event.target.value);
        }}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ mt: 2, width: { xs: "100%", sm: 260 } }}
      >
        <MenuItem value={NO_BENCHMARK_CHOICE} sx={{ minHeight: 44 }}>
          {NO_COMPARISON_LABEL}
        </MenuItem>
        {options.map((candidate) => (
          <MenuItem key={candidate.key} value={candidate.key} sx={{ minHeight: 44 }}>
            {candidate.label}
          </MenuItem>
        ))}
      </TextField>
      <ComparisonChart line={line} scopeLabel={scopeLabel} comparison={comparison} />
      {option && !option.line ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {NO_PRICES_TEXT}
        </Typography>
      ) : null}
      <Box
        sx={{
          mt: 1.5,
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(3, minmax(0, 1fr))" },
          gap: 1.5,
        }}
      >
        <Kpi
          label={PERFORMANCE_KPI_LABEL}
          value={ttwror === null ? "–" : formatPercent(ttwror)}
          color="primary.main"
          note={scopeLabel}
        />
        {comparison ? (
          <Kpi
            label={comparison.label}
            value={comparisonReturn === null ? "–" : formatPercent(comparisonReturn)}
            color="chart.series2"
            note="gestrichelt"
          />
        ) : null}
        {comparison && difference !== null ? (
          <Kpi
            label={DIFFERENCE_KPI_LABEL}
            value={formatPercentagePoints(difference)}
            color="text.secondary"
            note={`gegenüber ${comparison.label}`}
          />
        ) : null}
      </Box>
    </Box>
  );
}
