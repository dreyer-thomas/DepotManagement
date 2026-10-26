import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { CardHeading } from "@/app/_components/overview/CardHeading";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { formatMoney } from "@/core/format";
import type { SecurityTotal as SecurityTotalFigures } from "@/core/security";
import { percentOrMissing, ratioTone, signedMoneyOrMissing, TOTAL_HEADING } from "./labels";

const LIST_SX = { m: 0, maxWidth: 480, display: "grid", gridTemplateColumns: "1fr auto", columnGap: 2, alignItems: "baseline" };

/** One `dt`/`dd` pair directly inside the `<dl>` grid. */
function TotalRow({ label, value, note, bold }: { label: string; value: ReactNode; note?: string; bold?: boolean }) {
  const weight = bold ? 700 : undefined;
  return (
    <>
      <Box component="dt" sx={{ m: 0, py: 0.5 }}>
        <Typography variant="body2" component="span" sx={{ fontWeight: weight }}>
          {label}
        </Typography>
        {note ? (
          <Typography variant="caption" color="text.secondary" component="span" sx={{ display: "block" }}>
            {note}
          </Typography>
        ) : null}
      </Box>
      <Typography variant="figure" component="dd" sx={{ m: 0, py: 0.5, whiteSpace: "nowrap", textAlign: "right", fontWeight: weight }}>
        {value}
      </Typography>
    </>
  );
}

/** Signed percentage with an arrow (never color alone), neutral without a direction; `–` without a ratio. */
function ReturnValue({ ratio }: { ratio: string | null }) {
  const tone = ratioTone(ratio);
  const Arrow = tone === "loss" ? ArrowDownward : ArrowUpward;
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: tone ? `${tone}.main` : undefined }}>
      {tone ? <Arrow aria-hidden sx={{ fontSize: 14 }} /> : null}
      {percentOrMissing(ratio)}
    </Box>
  );
}

/**
 * Card "Gesamt seit Erstkauf": the all-time result of the holding as of today, independent of the
 * Period — realized, unrealized, dividends, fees, total, then taxes paid (separate), total invested,
 * return on invested and XIRR. Renders the figures it is given; computes nothing.
 */
export function SecurityTotal({ total }: { total: SecurityTotalFigures }) {
  return (
    <Card component="section" aria-labelledby="security-total" sx={{ mb: 2, minWidth: 0 }}>
      <CardContent>
        <CardHeading id="security-total">{TOTAL_HEADING}</CardHeading>
        <Box component="dl" sx={LIST_SX}>
          <TotalRow label="Realisiert" value={signedMoneyOrMissing(total.realized)} />
          <TotalRow label="Unrealisiert" value={signedMoneyOrMissing(total.unrealized)} />
          <TotalRow label="Dividenden" value={signedMoneyOrMissing(total.dividends)} />
          <TotalRow label="Gebühren" value={signedMoneyOrMissing(canonicalDecimal(new ExactDecimal(total.fees).negated()))} />
          <TotalRow label="Gesamt" value={signedMoneyOrMissing(total.total)} bold />
        </Box>
        <Divider sx={{ my: 1, maxWidth: 480 }} />
        <Box component="dl" sx={LIST_SX}>
          <TotalRow label="Steuern gezahlt" value={signedMoneyOrMissing(total.taxesPaid)} note="nicht in Gewinn/Verlust enthalten" />
          <TotalRow label="Investiert gesamt" value={formatMoney(total.totalInvested)} />
          <TotalRow label="Rendite auf Investiert" value={<ReturnValue ratio={total.returnRatio} />} />
          <TotalRow label="XIRR" value={percentOrMissing(total.xirr)} />
        </Box>
      </CardContent>
    </Card>
  );
}
