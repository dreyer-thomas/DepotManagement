import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatMoney } from "@/core/format";
import { isStale } from "@/core/prices";
import { GainLossPill } from "../positions/GainLossPill";
import { StaleBadge } from "../prices/StaleBadge";
import { SecurityLink } from "../security-detail/SecurityLink";
import { SecurityLogo } from "../securities/SecurityLogo";
import { CardHeading } from "./CardHeading";
import { type DepotPosition, positionCaption } from "./labels";

function Row({ entry, today }: { entry: DepotPosition; today: string }) {
  const { position } = entry;
  const stale =
    position.priceDate !== null && position.priceSource !== null && isStale(position.priceDate, today)
      ? { date: position.priceDate, source: position.priceSource, fetchedAt: position.priceFetchedAt, provider: position.priceProvider }
      : null;
  return (
    <Box
      component="li"
      sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.125, minHeight: 44, borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}
    >
      <SecurityLogo securityId={position.security.id} name={position.security.name} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ alignItems: "center", columnGap: 1, rowGap: 0.25, flexWrap: "wrap" }}>
          <Typography variant="body2" component="span" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
            <SecurityLink securityId={position.security.id} depotId={entry.depotId}>
              {position.security.name}
            </SecurityLink>
          </Typography>
          {stale ? <StaleBadge info={stale} /> : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
          {positionCaption(entry)}
        </Typography>
      </Box>
      <Stack spacing={0.5} sx={{ alignItems: "flex-end", flexShrink: 0, textAlign: "right" }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {position.value === null ? "–" : formatMoney(position.value)}
        </Typography>
        {position.gain === null ? null : <GainLossPill gain={position.gain} ratio={position.gainRatio} />}
      </Stack>
    </Box>
  );
}

/** "Top-Positionen": the given (already ranked) Positions with logo, caption, value and Gain/Loss. */
export function TopPositions({ entries, today }: { entries: readonly DepotPosition[]; today: string }) {
  return (
    <Card component="section" aria-labelledby="overview-top-positions" sx={{ minWidth: 0 }}>
      <CardContent>
        <CardHeading id="overview-top-positions">Top-Positionen</CardHeading>
        {entries.length === 0 ? (
          <Typography variant="body2">Keine offenen Positionen.</Typography>
        ) : (
          <Box component="ul" aria-label="Top-Positionen" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {entries.map((entry) => (
              <Row key={`${entry.depotId}\u0000${entry.position.security.id}`} entry={entry} today={today} />
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
