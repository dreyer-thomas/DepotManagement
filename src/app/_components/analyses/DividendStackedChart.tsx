"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import type { DividendBucket, DividendMonthSplit } from "@/core/dividend-analysis";
import { formatMoney } from "@/core/format";
import { BarsChart, type BarsItem, type BarsSeries } from "../charts/BarsChart";
import { SecurityLogo } from "../securities/SecurityLogo";
import { type DividendMode, DIVIDEND_LABELS, dividendAmount, dividendSplitAmount, gainsBucketLabel } from "./labels";

export type DividendStackedChartProps = {
  /** Text alternative (`role="figure"`): each month's total and its Securities' amounts. */
  ariaLabel: string;
  /** Axis label per month. */
  categories: readonly string[];
  /** Month totals, aligned with `splits`. */
  buckets: readonly DividendBucket[];
  /** Per-Security split of each shown month. */
  splits: readonly DividendMonthSplit[];
  /** Securities paying in the shown range, in `bySecurity` order (bottom to top). */
  securityIds: readonly string[];
  colorOf: (securityId: string) => string;
  name: (securityId: string) => string;
  mode: DividendMode;
};

/** Chart coordinate of a decimal string (presentation edge only). */
const plot = (value: string) => Number(value);

/**
 * Monthly dividends stacked by Security (story 7.7): one series per paying Security in its stable colour,
 * the month total as a label above the topmost non-zero segment, an item tooltip per segment (logo, name,
 * amount, month total).
 */
export function DividendStackedChart({ ariaLabel, categories, buckets, splits, securityIds, colorOf, name, mode }: DividendStackedChartProps) {
  // Per month: the last (topmost) Security with a non-zero amount carries the total label.
  const topmost = splits.map((split) => {
    for (let i = securityIds.length - 1; i >= 0; i -= 1) {
      if (dividendSplitAmount(split, securityIds[i], mode) !== "0") return securityIds[i];
    }
    return null;
  });
  const total = (index: number) => formatMoney(dividendAmount(buckets[index], mode));

  const series: BarsSeries[] = securityIds.map((securityId) => ({
    id: securityId,
    label: name(securityId),
    color: colorOf(securityId),
    stack: "dividends",
    values: splits.map((split) => {
      const amount = dividendSplitAmount(split, securityId, mode);
      return amount === "0" ? null : plot(amount);
    }),
    text: (index) => formatMoney(dividendSplitAmount(splits[index], securityId, mode)),
    barLabel: (index) => (topmost[index] === securityId ? total(index) : null),
  }));

  const tooltip = ({ seriesId, dataIndex }: BarsItem) => {
    const split = splits[dataIndex];
    if (!split) return null;
    return (
      <Paper elevation={3} sx={{ borderRadius: 2, px: 1.5, py: 1, bgcolor: "background.paper", minWidth: 180, maxWidth: 320 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <SecurityLogo securityId={seriesId} name={name(seriesId)} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
              {name(seriesId)}
            </Typography>
            <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {formatMoney(dividendSplitAmount(split, seriesId, mode))}
            </Typography>
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5, fontVariantNumeric: "tabular-nums" }}>
          {`${DIVIDEND_LABELS.total} ${gainsBucketLabel(split.period)}: ${total(dataIndex)}`}
        </Typography>
      </Paper>
    );
  };

  return <BarsChart ariaLabel={ariaLabel} categories={categories} series={series} itemTooltip={tooltip} hideLegend />;
}
