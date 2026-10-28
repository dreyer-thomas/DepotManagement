"use client";

import { SparkLineChart } from "@mui/x-charts/SparkLineChart";

/**
 * Decorative value line of a Depot card over the Period (no axes, no tooltip). Values are decimal
 * strings and become plot coordinates only here; the figures beside it carry the information.
 */
export function SparklineChart({ values }: { values: readonly string[] }) {
  if (values.length < 2) return null;
  return (
    <div aria-hidden>
      <SparkLineChart data={values.map(Number)} height={56} area curve="linear" color="var(--mui-palette-primary-main)" />
    </div>
  );
}
