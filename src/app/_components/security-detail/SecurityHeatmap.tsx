"use client";

import Box from "@mui/material/Box";
import { ReturnHeatmap } from "@/app/_components/analyses/ReturnHeatmap";
import type { HeatmapYear } from "@/core/return-heatmap";
import { SECURITY_HEATMAP_HEADING } from "./labels";

/**
 * "Performance-Heatmap" card of the Security page (story 7-8): the shared return heatmap over the
 * holding's all-time series with the "Q | M" toggle and "Gesamt" column. Renders the years it is given; computes nothing.
 */
export function SecurityHeatmap({ scope, years }: { scope: string; years: readonly HeatmapYear[] }) {
  return (
    <Box sx={{ mb: 2 }}>
      <ReturnHeatmap
        scope={scope}
        years={years}
        heading={SECURITY_HEATMAP_HEADING}
        headingId="security-heatmap"
        granularityToggle
      />
    </Box>
  );
}
