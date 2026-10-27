"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { type ReactNode, useId, useState } from "react";
import type { DividendAnalysis, DividendBucket, DividendSecurity, ExpectedDividend } from "@/core/dividend-analysis";
import { formatMoney } from "@/core/format";
import { BarsChart, type BarsSeries } from "../charts/BarsChart";
import { CardHeading } from "../overview/CardHeading";
import { SecurityLink } from "../security-detail/SecurityLink";
import { SecurityLogo } from "../securities/SecurityLogo";
import { Kpi } from "../valuation/ValueSummary";
import { Summary, ValueTable } from "./GainsView";
import {
  DIVIDEND_BUCKET_HEADINGS,
  DIVIDEND_EMPTY_TEXT,
  DIVIDEND_ESTIMATE_NOTE,
  DIVIDEND_LABELS,
  DIVIDEND_MODES,
  DIVIDEND_NO_EXPECTED_TEXT,
  DIVIDEND_NONE_TEXT,
  DIVIDEND_VIEWS,
  type DividendBucketView,
  type DividendMode,
  type DividendView,
  dividendAmount,
  dividendBuckets,
  dividendChartAriaLabel,
  dividendCountText,
  dividendModeLabel,
  dividendRangeTotal,
  dividendSecuritiesAriaLabel,
  dividendYieldText,
  expectedDividendText,
  gainsBucketShortLabel,
  gainsYears,
  sumDividendAmounts,
} from "./labels";

export type DividendsViewProps = {
  /** Buckets, Securities, trailing income and estimate of the scope (`core/dividend-analysis`). */
  analysis: DividendAnalysis;
  /** Security id → name. */
  securityNames: Readonly<Record<string, string>>;
  /** Business date `YYYY-MM-DD`; its year is the default "Jahr". */
  today: string;
  /** The Depot of a single-Depot scope (Security links open it); `null` for the Portfolio. */
  depotId?: string | null;
};

/** Chart coordinate of a decimal string (presentation edge only). */
const plot = (value: string) => Number(value);

const control = { minHeight: 44 } as const;

function ListRow({ securityId, depotId, name, caption, amount }: { securityId: string; depotId: string | null; name: string; caption: string; amount: string }) {
  return (
    <Box
      component="li"
      sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.125, minHeight: 44, borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}
    >
      <SecurityLogo securityId={securityId} name={name} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" component="span" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
          <SecurityLink securityId={securityId} depotId={depotId}>
            {name}
          </SecurityLink>
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {caption}
        </Typography>
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 500, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {amount}
      </Typography>
    </Box>
  );
}

/**
 * Dividenden (FR-22): KPI row (12-month income, yield, estimate), a Brutto/Netto toggle for every figure
 * and the views Monate (of a chosen year), Jahre, Kumuliert, Wertpapiere and Erwartet (labelled as an
 * estimate). View, year and mode are client state; every figure comes from `core/dividend-analysis`.
 */
export function DividendsView({ analysis, securityNames, today, depotId = null }: DividendsViewProps) {
  const theme = useTheme();
  const accent = (theme.vars ?? theme).palette.accent?.main ?? theme.palette.info.main;
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [view, setView] = useState<DividendView>("months");
  const [chosenYear, setChosenYear] = useState(today.slice(0, 4));
  const [mode, setMode] = useState<DividendMode>("gross");

  if (analysis.months.length === 0) {
    return (
      <Card component="section" aria-labelledby={`${ids}-dividends`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-dividends`}>Dividenden</CardHeading>
          <Typography variant="body2">{DIVIDEND_EMPTY_TEXT}</Typography>
        </CardContent>
      </Card>
    );
  }

  const years = gainsYears(analysis.years);
  // A year the scope does not cover (e.g. after a scope change) falls back to the newest year.
  const year = years.includes(chosenYear) ? chosenYear : years[0];
  const amount = (item: { gross: string; net: string }) => formatMoney(dividendAmount(item, mode));
  const name = (securityId: string) => securityNames[securityId] ?? securityId;
  const modeLabel = dividendModeLabel(mode);

  const bucketSeries = (buckets: readonly DividendBucket[]): BarsSeries[] => [
    {
      id: "dividends",
      label: `Dividenden (${modeLabel})`,
      color: accent,
      values: buckets.map((bucket) => plot(dividendAmount(bucket, mode))),
      text: (i) => amount(buckets[i]),
    },
  ];

  function bucketCard(bucketView: DividendBucketView, children?: ReactNode) {
    const buckets = dividendBuckets(analysis, bucketView, year);
    const heading = DIVIDEND_BUCKET_HEADINGS[bucketView];
    const totalLabel = bucketView === "cumulative" ? "Gesamt" : DIVIDEND_LABELS.total;
    return (
      <Card component="section" aria-labelledby={`${ids}-chart`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-chart`}>{heading}</CardHeading>
          {bucketView === "expected" ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {DIVIDEND_ESTIMATE_NOTE}
            </Typography>
          ) : null}
          <BarsChart
            ariaLabel={dividendChartAriaLabel(heading, buckets, mode)}
            categories={buckets.map((bucket) =>
              // Erwartet spans 13 months: today's month appears twice, so add the two-digit year.
              bucketView === "expected" ? `${gainsBucketShortLabel(bucket.period)} ${bucket.period.slice(2, 4)}` : gainsBucketShortLabel(bucket.period),
            )}
            series={bucketSeries(buckets)}
          />
          <Summary entries={[[`${totalLabel} (${modeLabel})`, formatMoney(dividendRangeTotal(buckets, bucketView, mode))]]} />
          <ValueTable<DividendBucket> caption={heading} buckets={buckets} columns={[[modeLabel, amount]]} />
          {children}
        </CardContent>
      </Card>
    );
  }

  function securitiesCard(securities: readonly DividendSecurity[]) {
    return (
      <Card component="section" aria-labelledby={`${ids}-chart`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-chart`}>{DIVIDEND_LABELS.securitiesHeading}</CardHeading>
          {securities.length === 0 ? (
            <Typography variant="body2">{DIVIDEND_NONE_TEXT}</Typography>
          ) : (
            <>
              <BarsChart
                ariaLabel={dividendSecuritiesAriaLabel(securities, securityNames, mode)}
                categories={securities.map((security) => name(security.securityId))}
                series={[
                  {
                    id: "dividends",
                    label: `Dividenden (${modeLabel})`,
                    color: accent,
                    values: securities.map((security) => plot(dividendAmount(security, mode))),
                    text: (i) => amount(securities[i]),
                  },
                ]}
              />
              <Summary entries={[[`${DIVIDEND_LABELS.total} (${modeLabel})`, formatMoney(sumDividendAmounts(securities, mode))]]} />
              <Box component="ol" aria-label={DIVIDEND_LABELS.securitiesHeading} sx={{ listStyle: "none", m: 0, mt: 1.5, p: 0 }}>
                {securities.map((security) => (
                  <ListRow
                    key={security.securityId}
                    securityId={security.securityId}
                    depotId={depotId}
                    name={name(security.securityId)}
                    caption={dividendCountText(security.count, security.lastDate)}
                    amount={amount(security)}
                  />
                ))}
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  function expectedList(expected: readonly ExpectedDividend[]) {
    return (
      <Box component="section" aria-labelledby={`${ids}-expected`} sx={{ mt: 2 }}>
        <CardHeading id={`${ids}-expected`}>{DIVIDEND_LABELS.expectedList}</CardHeading>
        {expected.length === 0 ? (
          <Typography variant="body2">{DIVIDEND_NO_EXPECTED_TEXT}</Typography>
        ) : (
          <Box component="ol" aria-label={DIVIDEND_LABELS.expectedList} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {expected.map((payment, index) => (
              <ListRow
                key={`${payment.depotId}\u0000${payment.securityId}\u0000${payment.date}\u0000${payment.basedOn}\u0000${index}`}
                securityId={payment.securityId}
                depotId={payment.depotId}
                name={name(payment.securityId)}
                caption={expectedDividendText(payment.date, payment.basedOn)}
                amount={amount(payment)}
              />
            ))}
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "center" }, flexWrap: "wrap", rowGap: 1 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label={DIVIDEND_LABELS.view}
          value={view}
          onChange={(_event, next: DividendView | null) => {
            if (next !== null) setView(next);
          }}
          sx={{ flexWrap: "wrap" }}
        >
          {DIVIDEND_VIEWS.map((option) => (
            <ToggleButton key={option.value} value={option.value} sx={{ ...control, px: 2 }}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {view === "months" ? (
          <TextField
            select
            size="small"
            label={DIVIDEND_LABELS.year}
            value={year}
            onChange={(event) => setChosenYear(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: { xs: "100%", sm: 140 }, "& .MuiInputBase-root": control }}
          >
            {years.map((option) => (
              <MenuItem key={option} value={option} sx={control}>
                {option}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label={DIVIDEND_LABELS.mode}
          value={mode}
          onChange={(_event, next: DividendMode | null) => {
            if (next !== null) setMode(next);
          }}
        >
          {DIVIDEND_MODES.map((option) => (
            <ToggleButton key={option.value} value={option.value} sx={{ ...control, px: 2 }}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Box
        component="section"
        aria-label={DIVIDEND_LABELS.kpis}
        sx={{ display: "grid", gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "repeat(3, minmax(0, 1fr))" }, gap: 1.5 }}
      >
        <Kpi label={DIVIDEND_LABELS.income} value={amount(analysis.trailing)} color="accent.main" note={modeLabel} />
        <Kpi
          label={DIVIDEND_LABELS.yield}
          value={dividendYieldText(mode === "net" ? analysis.trailing.netYield : analysis.trailing.grossYield)}
          color="accent.main"
          note={modeLabel}
        />
        <Kpi label={DIVIDEND_LABELS.expectedKpi} value={formatMoney(sumDividendAmounts(analysis.expected, mode))} color="accent.main" note={modeLabel} />
      </Box>

      {view === "securities"
        ? securitiesCard(analysis.bySecurity)
        : view === "expected"
          ? bucketCard("expected", expectedList(analysis.expected))
          : bucketCard(view)}
    </Stack>
  );
}
