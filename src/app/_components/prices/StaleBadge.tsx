"use client";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { type PriceDateInfo, priceDateText, priceSourceText } from "./price-labels";

/**
 * Stale badge "Kurs vom dd.mm.yyyy – veraltet": warning-soft pill (text, never color alone),
 * keyboard-focusable, with a tooltip naming the source and fetch time.
 */
export function StaleBadge({ info }: { info: Omit<PriceDateInfo, "stale"> }) {
  const source = priceSourceText(info);
  return (
    // Opens on tap (no long press) on touch screens.
    <Tooltip title={source} describeChild enterTouchDelay={0}>
      <Box
        component="span"
        tabIndex={0}
        data-stale-badge=""
        sx={{
          display: "inline-flex",
          alignItems: "center",
          px: 1,
          py: 0.25,
          borderRadius: 999,
          fontSize: 12,
          fontWeight: 600,
          lineHeight: 1.4,
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
          bgcolor: "stale.soft",
          color: "stale.main",
          "&:focus-visible": { outline: 2, outlineStyle: "solid", outlineColor: "stale.main", outlineOffset: 2 },
        }}
      >
        {priceDateText(info.date, true)}
      </Box>
    </Tooltip>
  );
}

/** The latest price date: plain "Kurs vom dd.mm.yyyy", or the stale badge when `info.stale`. */
export function PriceDate({ info }: { info: PriceDateInfo }) {
  if (info.stale) return <StaleBadge info={info} />;
  return (
    <Typography component="span" variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {priceDateText(info.date, false)}
    </Typography>
  );
}
