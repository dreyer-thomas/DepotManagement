import Box from "@mui/material/Box";
import { Kpi } from "@/app/_components/valuation/Kpi";
import { gainLossTone } from "@/app/_components/positions/GainLossPill";
import { formatMoney, formatQuantity } from "@/core/format";
import type { SecuritySnapshot } from "@/core/security";
import { MISSING } from "./labels";

/**
 * KPI row of the Security page: Stück, Cost Basis, Unrealisiert (signed), dividends in the Period and
 * average purchase price; `–` where a figure is unknown. 2 columns on phones, one row from `md`.
 */
export function SecurityKpis({
  snapshot,
  dividends,
  periodLabel,
}: {
  snapshot: SecuritySnapshot;
  dividends: string;
  periodLabel: string;
}) {
  const tone = snapshot.unrealized === null ? null : gainLossTone(snapshot.unrealized);
  return (
    <Box
      component="section"
      aria-label="Kennzahlen"
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(5, minmax(0, 1fr))" },
        gap: 1.5,
        mb: 2,
      }}
    >
      <Kpi label="Stück" value={formatQuantity(snapshot.quantity)} color="chart.series2" />
      <Kpi label="Cost Basis" value={formatMoney(snapshot.costBasis)} color="primary.main" />
      <Kpi
        label="Unrealisiert"
        value={snapshot.unrealized === null ? MISSING : formatMoney(snapshot.unrealized, { sign: true })}
        color={tone ? `${tone}.main` : "divider"}
      />
      <Kpi label={`Dividenden · ${periodLabel}`} value={formatMoney(dividends)} color="accent.main" />
      <Kpi
        label="Ø Kaufkurs"
        value={snapshot.averagePrice === null ? MISSING : formatMoney(snapshot.averagePrice)}
        color="chart.series4"
      />
    </Box>
  );
}
