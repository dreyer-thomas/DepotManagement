"use client";

import { SparkLineChart } from "@mui/x-charts/SparkLineChart";

/**
 * Decorative value line of a Depot card over the Period (no axes, no tooltip), scaled to the Period's
 * own min..max so moves stay visible. Values are decimal strings and become plot coordinates only
 * here; the figures beside it carry the information.
 */
export function SparklineChart({ values, height = 56 }: { values: readonly string[]; height?: number }) {
  if (values.length < 2) return null;
  const data = values.map(Number);
  const min = Math.min(...data);
  const max = Math.max(...data);
  return (
    <div aria-hidden>
      <SparkLineChart
        data={data}
        height={height}
        curve="linear"
        yAxis={{ min, max: max > min ? max : min + 1 }}
        color="var(--mui-palette-primary-main)"
      />
    </div>
  );
}
