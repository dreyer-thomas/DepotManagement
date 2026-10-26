import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { formatDate, formatMoney } from "@/core/format";

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
};

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
 * Hero card ("Gesamtwert" at the Period end) and KPI row: invested capital, dividends in the Period,
 * cash, taxes paid in the Period. Renders the figures it is given; computes nothing.
 */
export function ValueSummary({ value, investedCapital, cash, dividends, taxesPaid, periodLabel, to, today }: ValueSummaryProps) {
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
