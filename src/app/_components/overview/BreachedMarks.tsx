import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { formatMoney } from "@/core/format";
import type { BreachedPriceMark } from "@/modules/marks";
import { HELD_IN_DEPOT_LABEL, visuallyHidden } from "../news/labels";
import { BreachPill } from "../price-marks/BreachPill";
import { BREACHED_MARKS_HEADING, breachPillText, stopRowText, targetRowText } from "../price-marks/labels";
import { SecurityLink } from "../security-detail/SecurityLink";
import { SecurityLogo } from "../securities/SecurityLogo";
import { CardHeading } from "./CardHeading";

/** The breached mark's row text (value and distance), as the detail card shows it. */
function markText({ marks, state }: BreachedPriceMark): string | null {
  if (state.breached === "stop") return marks.stop && state.stop ? stopRowText(marks.stop, state.stop) : null;
  return state.target ? targetRowText(state.target) : null;
}

function Row({ item }: { item: BreachedPriceMark }) {
  const caption = markText(item);
  return (
    <Box
      component="li"
      sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.125, minHeight: 44, borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}
    >
      <SecurityLogo securityId={item.securityId} name={item.name} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ alignItems: "center", columnGap: 1, rowGap: 0.25, flexWrap: "wrap" }}>
          <Typography variant="body2" component="span" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
            <SecurityLink securityId={item.securityId}>{item.name}</SecurityLink>
          </Typography>
          {item.state.priceDate !== null ? <BreachPill>{breachPillText(item.state.breached, item.state.priceDate)}</BreachPill> : null}
          {item.held ? (
            <Chip label={HELD_IN_DEPOT_LABEL} size="small" variant="outlined" color="primary" component="span" sx={{ height: 20 }} />
          ) : null}
        </Stack>
        {caption !== null ? (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ fontVariantNumeric: "tabular-nums", overflowWrap: "anywhere" }}>
            {caption}
          </Typography>
        ) : null}
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0, textAlign: "right" }}>
        <Box component="span" sx={visuallyHidden}>
          Letzter Kurs{" "}
        </Box>
        {item.state.price === null ? "–" : formatMoney(item.state.price)}
      </Typography>
    </Box>
  );
}

/**
 * "Kursmarken erreicht" (story 12.4, dashboard): every Security whose stop is undercut or target reached
 * (`breachedPriceMarks`, core state only) with logo, linked name, breach pill, "im Depot" when held, the
 * breached mark with its distance and the latest Price. Nothing when no mark is breached; no dismiss.
 */
export function BreachedMarks({ items }: { items: readonly BreachedPriceMark[] }) {
  if (items.length === 0) return null;
  return (
    <Card component="section" aria-labelledby="overview-breached-marks" sx={{ mb: 2 }}>
      <CardContent>
        <CardHeading id="overview-breached-marks">{BREACHED_MARKS_HEADING}</CardHeading>
        <Box component="ul" aria-label={BREACHED_MARKS_HEADING} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {items.map((item) => (
            <Row key={item.securityId} item={item} />
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
