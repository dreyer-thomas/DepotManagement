"use client";

import Box from "@mui/material/Box";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useId, useState } from "react";
import { DrawdownChart } from "@/app/_components/charts/DrawdownChart";
import {
  parseValueChartTab,
  storeChartPreference,
  VALUE_CHART_TAB_COOKIE,
  VALUE_CHART_TABS,
  type ValueChartTab,
} from "@/app/_components/charts/chart-preference";
import type { DrawdownChartPoint, DrawdownSummary } from "@/app/_components/charts/drawdown-chart";
import { ValueChart } from "@/app/_components/charts/ValueChart";
import type { ChartPoint } from "@/app/_components/charts/value-chart";
import type { PerformanceComparison } from "./comparison-options";
import { PerformancePanel } from "./PerformancePanel";

export const VALUE_CHART_TAB_LABELS: Record<ValueChartTab, string> = {
  performance: "Wertentwicklung",
  ttwror: "Performance",
  drawdown: "Drawdown",
};

export type ValueChartTabsProps = {
  /** The value chart's points (decimal strings). */
  points: readonly ChartPoint[];
  /** The Period's drawdown (`core/drawdown`): one point per day and the KPIs. */
  drawdown: DrawdownSummary & { points: readonly DrawdownChartPoint[] };
  /** The stored tab (cookie) for the first render. */
  initialTab: ValueChartTab;
  /** The Performance tab's line and comparisons; without it the tab is left out. */
  comparison?: PerformanceComparison;
};

/**
 * Tabs "Wertentwicklung | Performance | Drawdown" of the hero card: the value chart, the TTWROR
 * comparison (when `comparison` is given) or the drawdown chart with its KPI row. Switching never reloads
 * the page; the choice is stored in the shared `dm_chart_tab` cookie.
 */
export function ValueChartTabs({ points, drawdown, initialTab, comparison }: ValueChartTabsProps) {
  const tabs = VALUE_CHART_TABS.filter((value) => value !== "ttwror" || comparison);
  const [tab, setTab] = useState<ValueChartTab>(tabs.includes(initialTab) ? initialTab : "performance");
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const tabId = (value: ValueChartTab) => `value-chart-tab-${id}-${value}`;
  const panelId = (value: ValueChartTab) => `value-chart-panel-${id}-${value}`;
  return (
    <Box sx={{ mt: 1.5 }}>
      <Tabs
        value={tab}
        aria-label="Diagramm"
        onChange={(_, next: string) => {
          const value = parseValueChartTab(next);
          setTab(value);
          storeChartPreference(VALUE_CHART_TAB_COOKIE, value);
        }}
        sx={{ minHeight: 44 }}
      >
        {tabs.map((value) => (
          <Tab
            key={value}
            value={value}
            id={tabId(value)}
            aria-controls={value === tab ? panelId(value) : undefined}
            label={VALUE_CHART_TAB_LABELS[value]}
            sx={{ minHeight: 44, minWidth: 44, textTransform: "none" }}
          />
        ))}
      </Tabs>
      <Box role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {tab === "performance" ? (
          <ValueChart points={points} />
        ) : tab === "ttwror" && comparison ? (
          <PerformancePanel {...comparison} />
        ) : (
          <DrawdownChart points={drawdown.points} summary={drawdown} />
        )}
      </Box>
    </Box>
  );
}
