import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import Box from "@mui/material/Box";
import { ExactDecimal } from "@/core/decimal";
import { formatMoney, formatPercent } from "@/core/format";

/** Signed pill text: `+28,80 € · +7,97 %`, or the amount alone without a ratio. */
export function gainLossText(gain: string, ratio: string | null): string {
  const amount = formatMoney(gain, { sign: true });
  return ratio === null ? amount : `${amount} · ${formatPercent(ratio)}`;
}

/** Tone of a gain as displayed (rounded half-up to cents): `null` when it shows as 0,00 €. */
export function gainLossTone(gain: string): "gain" | "loss" | null {
  const cents = new ExactDecimal(gain).toDecimalPlaces(2, ExactDecimal.ROUND_HALF_UP);
  if (cents.isZero()) return null;
  return cents.isNegative() ? "loss" : "gain";
}

/**
 * Gain/Loss pill: soft gain/loss background, arrow and signed text (never color alone);
 * a zero gain is neutral and has no arrow.
 */
export function GainLossPill({ gain, ratio }: { gain: string; ratio: string | null }) {
  const tone = gainLossTone(gain);
  const Arrow = tone === "loss" ? ArrowDownward : ArrowUpward;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 1.25,
        py: 0.5,
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
        bgcolor: tone ? `${tone}.soft` : "action.hover",
        color: tone ? `${tone}.main` : "text.secondary",
      }}
    >
      {tone ? <Arrow aria-hidden sx={{ fontSize: 14 }} /> : null}
      {gainLossText(gain, ratio)}
    </Box>
  );
}
