"use client";

import Box from "@mui/material/Box";
import MuiLink from "@mui/material/Link";
import NextLink from "next/link";
import { ReturnHeatmap } from "@/app/_components/analyses/ReturnHeatmap";
import { analysisHref, DEFAULT_ALLOCATION_DIMENSION, PORTFOLIO_SCOPE } from "@/app/_components/analyses/labels";
import type { HeatmapYear } from "@/core/return-heatmap";
import { PORTFOLIO_HEATMAP_LINK_TEXT, SECURITY_HEATMAP_HEADING } from "./labels";

/**
 * "Performance-Heatmap" card of the Security page (story 7-8): the shared return heatmap over the
 * holding's all-time series with the "Q | M" toggle and "Gesamt" column, plus a link to the Portfolio
 * heatmap (Analysen › Rendite). Renders the years it is given; computes nothing.
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
        footer={
          <Box sx={{ mt: 1.5 }}>
            <MuiLink
              component={NextLink}
              href={analysisHref("returns", PORTFOLIO_SCOPE, DEFAULT_ALLOCATION_DIMENSION)}
              underline="hover"
              sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
            >
              {PORTFOLIO_HEATMAP_LINK_TEXT}
            </MuiLink>
          </Box>
        }
      />
    </Box>
  );
}
