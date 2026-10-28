import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { isStale, type ResolvedPrice } from "@/core/prices";
import { PriceDate } from "../prices/StaleBadge";
import { ManualPriceButton } from "../securities/ManualPriceDialog";
import { NO_PRICE_TEXT, STALE_HINT_TEXT } from "./labels";

/**
 * The latest price's date ("Kurs vom …", or the stale badge), "Kein Kurs vorhanden." without one. A stale
 * price of a held or watched Security adds "Keine Kursquelle liefert aktuelle Kurse." with "Kurs manuell
 * eintragen" for `security` (prices are only fetched for held or watched Securities, so a sold one is not flagged).
 */
export function PriceLine({
  price,
  security,
  held,
  today,
}: {
  price: ResolvedPrice | null;
  /** The Security the price belongs to (the chain's current one). */
  security: { id: string; name: string };
  /** Prices are fetched for it: scope quantity > 0, or on a watchlist. */
  held: boolean;
  today: string;
}) {
  if (price === null) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {NO_PRICE_TEXT}
      </Typography>
    );
  }
  const stale = isStale(price.date, today);
  return (
    <Box sx={{ mt: 1 }}>
      <PriceDate info={{ date: price.date, source: price.source, fetchedAt: price.fetchedAt, provider: price.provider, stale }} />
      {stale && held ? (
        <Stack direction="row" sx={{ mt: 1, alignItems: "center", flexWrap: "wrap", columnGap: 1.5, rowGap: 1 }}>
          <Typography variant="body2">{STALE_HINT_TEXT}</Typography>
          <ManualPriceButton security={security} today={today} />
        </Stack>
      ) : null}
    </Box>
  );
}
