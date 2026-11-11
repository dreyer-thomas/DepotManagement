import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import { ExactDecimal } from "@/core/decimal";
import { formatPercent } from "@/core/format";
import type { NewsSecurityContext } from "@/modules/news";
import { priceDateText } from "../prices/price-labels";
import { HELD_IN_DEPOT_LABEL, visuallyHidden } from "./labels";

/** Tone of a ratio as displayed (2 decimals in %): `null` when it shows as 0,00 %. */
export function ratioTone(ratio: string): "gain" | "loss" | null {
  const shown = new ExactDecimal(ratio).times(100).toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);
  if (shown.isZero()) return null;
  return shown.isNegative() ? "loss" : "gain";
}

/**
 * Context of a news item next to the Security name (story 12.1): the "im Depot" chip when held, the signed
 * change today (sign in the text, colour only as a second cue) and, when the Price is stale, a
 * "Kurs vom dd.mm.yyyy – veraltet" pill. Not focusable (the row is already a link or a button); no hooks,
 * so it renders in server and client components alike. Renders nothing without chip and change.
 */
export function NewsContext({ context }: { context: NewsSecurityContext | undefined }) {
  if (!context || (!context.held && context.changeToday === null)) return null;
  const tone = context.changeToday === null ? null : ratioTone(context.changeToday);
  return (
    <>
      {context.held && (
        <Chip label={HELD_IN_DEPOT_LABEL} size="small" variant="outlined" color="primary" component="span" sx={{ height: 20 }} />
      )}
      {context.changeToday !== null && (
        <Box
          component="span"
          data-news-change=""
          sx={{
            typography: "body2",
            color: tone ? `${tone}.main` : "text.secondary",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
          }}
        >
          {formatPercent(context.changeToday)}
          <Box component="span" sx={visuallyHidden}>
            {" heute"}
          </Box>
        </Box>
      )}
      {context.changeToday !== null && context.stale && context.priceDate !== null && (
        <Box
          component="span"
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
          }}
        >
          {priceDateText(context.priceDate, true)}
        </Box>
      )}
    </>
  );
}
