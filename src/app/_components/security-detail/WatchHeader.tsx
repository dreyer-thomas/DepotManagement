import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { GainLossPill } from "@/app/_components/positions/GainLossPill";
import { formatDate, formatMoney } from "@/core/format";
import type { ResolvedPrice } from "@/core/prices";
import type { PriceChange } from "@/core/security";
import { MISSING } from "./labels";
import { PriceLine } from "./PriceLine";

/**
 * Header card of a never-booked Security (story 9.2, "watch" layout): "Kurs" with the Price as of the
 * Period end, "Stand" when the Period ends before today, the Period change pill (€ per unit and %,
 * labelled with the Period; "–" without one), the price line (stale badge, "Kein Kurs vorhanden.") and
 * the chart slot. Renders what it is given; computes nothing.
 */
export function WatchHeader({
  price,
  security,
  priceChange,
  periodLabel,
  fetched,
  to,
  today,
  chart,
}: {
  price: ResolvedPrice | null;
  /** The Security the price belongs to (the chain's current one). */
  security: { id: string; name: string };
  priceChange: PriceChange | null;
  periodLabel: string;
  /** The price runs fetch this Security (it is on a watchlist): a stale Price gets the hint and the manual price action. */
  fetched: boolean;
  to: string;
  today: string;
  /** The price chart (`SecurityChart`), omitted without a Price. */
  chart?: ReactNode;
}) {
  return (
    <Box component="section" aria-label="Kurs" sx={{ mb: 1.5 }}>
      <Card>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="body2" color="text.secondary">
            Kurs
          </Typography>
          <Typography variant="figureHero" component="p" sx={{ overflowWrap: "anywhere" }}>
            {price === null ? MISSING : formatMoney(price.price)}
          </Typography>
          {to !== today ? (
            <Typography variant="body2" color="text.secondary">
              Stand {formatDate(to)}
            </Typography>
          ) : null}
          <Box sx={{ mt: 1 }}>
            {priceChange === null ? (
              <Typography component="span" variant="body2" color="text.secondary" aria-label={`Veränderung ${periodLabel}`}>
                {MISSING}
              </Typography>
            ) : (
              <GainLossPill gain={priceChange.perUnit} ratio={priceChange.ratio} ratioLabel={periodLabel} />
            )}
          </Box>
          <PriceLine price={price} security={security} held={fetched} today={today} />
          {chart}
        </CardContent>
      </Card>
    </Box>
  );
}
