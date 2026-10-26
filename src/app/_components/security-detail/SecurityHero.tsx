import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { GainLossPill } from "@/app/_components/positions/GainLossPill";
import { Breakdown, xirrText } from "@/app/_components/valuation/ValueSummary";
import { formatDate, formatMoney } from "@/core/format";
import type { PeriodPerformance } from "@/core/returns";
import { heroLabel } from "./labels";

/**
 * Hero card of the Security page: "Wert · <qty> Stück à <price>", the value at the Period end, "Stand"
 * when the Period ends before today, gain/loss pill with TTWROR, XIRR, the price line, the chart slot
 * (Kurs/Wert toggle) and the "Aufschlüsselung". Renders the figures it is given; computes nothing.
 */
export function SecurityHero({
  quantity,
  price,
  value,
  to,
  today,
  performance,
  priceLine,
  chart,
}: {
  quantity: string;
  /** Resolver price as of the Period end; `null` without one. */
  price: string | null;
  /** Series value at the Period end. */
  value: string;
  to: string;
  today: string;
  performance: PeriodPerformance;
  priceLine: ReactNode;
  /** The hero chart (`SecurityChart`). */
  chart: ReactNode;
}) {
  return (
    <Box component="section" aria-label="Wert" sx={{ mb: 1.5 }}>
      <Card>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {heroLabel(quantity, price)}
          </Typography>
          <Typography variant="figureHero" component="p" sx={{ overflowWrap: "anywhere" }}>
            {formatMoney(value)}
          </Typography>
          {to !== today ? (
            <Typography variant="body2" color="text.secondary">
              Stand {formatDate(to)}
            </Typography>
          ) : null}
          <Stack direction="row" sx={{ mt: 1, flexWrap: "wrap", alignItems: "center", columnGap: 1.5, rowGap: 0.5 }}>
            <GainLossPill gain={performance.gain} ratio={performance.ttwror} ratioLabel="TTWROR" />
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {xirrText(performance.xirr)}
            </Typography>
          </Stack>
          {priceLine}
          {chart}
          <Breakdown performance={performance} />
        </CardContent>
      </Card>
    </Box>
  );
}
