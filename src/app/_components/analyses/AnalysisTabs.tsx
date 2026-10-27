"use client";

import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import NextLink from "next/link";
import { ANALYSIS_TABS, type AllocationDimension, type AnalysisTab, analysisHref, analysisTabId, analysisTabPanelId } from "./labels";

/** Tab bar of the Analysen page; each tab is a link to `?tab=<value>&scope=<scope>&dimension=<dimension>` so the URL holds the state. */
export function AnalysisTabs({ value, scope, dimension }: { value: AnalysisTab; scope: string; dimension: AllocationDimension }) {
  return (
    <Tabs value={value} aria-label="Analysen" variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }}>
      {ANALYSIS_TABS.map((tab) => (
        <Tab
          key={tab.value}
          value={tab.value}
          label={tab.label}
          id={analysisTabId(tab.value)}
          aria-controls={tab.value === value ? analysisTabPanelId(tab.value) : undefined}
          component={NextLink}
          href={analysisHref(tab.value, scope, dimension)}
          scroll={false}
          sx={{ minHeight: 48 }}
        />
      ))}
    </Tabs>
  );
}
