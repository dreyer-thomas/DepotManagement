import ExpandMore from "@mui/icons-material/ExpandMore";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { GainLossPill } from "@/app/_components/positions/GainLossPill";
import { formatDate, formatMoney, formatPercent } from "@/core/format";
import type { PeriodPerformance } from "@/core/returns";

export type ValueSummaryProps = {
  /** Series point at the Period end (decimal strings). */
  value: string;
  investedCapital: string;
  cash: string;
  /** Period flows (decimal strings). */
  dividends: string;
  taxesPaid: string;
  /** Period label for the captions, e.g. `1J` or `01.01.2026 – 30.06.2026`. */
  periodLabel: string;
  /** Period end and today (`YYYY-MM-DD`); "Stand" is shown when they differ. */
  to: string;
  today: string;
  /** Period Gain/Loss, its split, TTWROR and XIRR (`core/returns`). */
  performance: PeriodPerformance;
};

/** `XIRR +10,87 %`, or `XIRR –` when it could not be solved. */
export function xirrText(xirr: string | null): string {
  return `XIRR ${xirr === null ? "–" : formatPercent(xirr)}`;
}

/** One `dt`/`dd` pair, rendered directly inside the `<dl>` grid (no wrapper element). */
function BreakdownRow({ label, amount, note }: { label: string; amount: string; note?: string }) {
  return (
    <>
      <Box component="dt" sx={{ m: 0, py: 0.5 }}>
        <Typography variant="body2" component="span">
          {label}
        </Typography>
        {note ? (
          <Typography variant="caption" color="text.secondary" component="span" sx={{ display: "block" }}>
            {note}
          </Typography>
        ) : null}
      </Box>
      <Typography variant="figure" component="dd" sx={{ m: 0, py: 0.5, whiteSpace: "nowrap", textAlign: "right" }}>
        {formatMoney(amount, { sign: true })}
      </Typography>
    </>
  );
}

/** A breakdown list: label left, amount right, as a two-column grid. */
const LIST_SX = { m: 0, maxWidth: 480, display: "grid", gridTemplateColumns: "1fr auto", columnGap: 2, alignItems: "baseline" };

/**
 * Collapsed "Aufschlüsselung" of the Period Gain/Loss: realized, unrealized, dividends, fees (as their
 * negative contribution), then taxes paid separately. Neutral text color; signs carry the direction.
 */
function Breakdown({ performance }: { performance: PeriodPerformance }) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{ mt: 1.5, bgcolor: "transparent", "&::before": { display: "none" } }}
    >
      <AccordionSummary
        id="gain-loss-breakdown-header"
        aria-controls="gain-loss-breakdown-content"
        expandIcon={<ExpandMore />}
        sx={{ minHeight: 44, px: 0 }}
      >
        <Typography component="span" variant="body2" sx={{ fontWeight: 600 }}>
          Aufschlüsselung
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ px: 0, pt: 0 }}>
        <Box component="dl" sx={LIST_SX}>
          <BreakdownRow label="Realisiert" amount={performance.realized} />
          <BreakdownRow label="Unrealisiert" amount={performance.unrealized} />
          <BreakdownRow label="Dividenden" amount={performance.dividends} />
          <BreakdownRow label="Gebühren" amount={performance.feesContribution} />
        </Box>
        <Divider sx={{ my: 1, maxWidth: 480 }} />
        <Box component="dl" sx={LIST_SX}>
          <BreakdownRow label="Steuern gezahlt" amount={performance.taxesPaid} note="nicht in Gewinn/Verlust enthalten" />
        </Box>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
          Ordergebühren stecken in realisiert/unrealisiert.
        </Typography>
      </AccordionDetails>
    </Accordion>
  );
}

function Kpi({ label, value, color, note }: { label: string; value: string; color: string; note?: string }) {
  return (
    <Card sx={{ borderTop: 4, borderTopColor: color, minWidth: 0 }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="figureKpi" component="p" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
          {value}
        </Typography>
        {note ? (
          <Typography variant="caption" color="text.secondary">
            {note}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Hero card ("Gesamtwert" at the Period end, gain/loss pill with TTWROR, XIRR, "Aufschlüsselung") and
 * KPI row: invested capital, dividends in the Period, cash, taxes paid in the Period. Renders the
 * figures it is given; computes nothing.
 */
export function ValueSummary({
  value,
  investedCapital,
  cash,
  dividends,
  taxesPaid,
  periodLabel,
  to,
  today,
  performance,
}: ValueSummaryProps) {
  return (
    <Box component="section" aria-label="Depotwert" sx={{ mb: 2 }}>
      <Card sx={{ mb: 1.5 }}>
        <CardContent sx={{ p: { xs: 2, md: 2.5 } }}>
          <Typography variant="body2" color="text.secondary">
            Gesamtwert
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
          <Breakdown performance={performance} />
        </CardContent>
      </Card>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
          gap: 1.5,
        }}
      >
        <Kpi label="Investiertes Kapital" value={formatMoney(investedCapital)} color="primary.main" note="Cost Basis offener Positionen" />
        <Kpi label={`Dividenden · ${periodLabel}`} value={formatMoney(dividends)} color="accent.main" />
        <Kpi label="Guthaben" value={formatMoney(cash)} color="cash.main" />
        <Kpi label={`Steuern gezahlt · ${periodLabel}`} value={formatMoney(taxesPaid)} color="chart.series4" note="separat ausgewiesen" />
      </Box>
    </Box>
  );
}
