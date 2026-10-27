"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { type Theme, useTheme } from "@mui/material/styles";
import { useId, useState } from "react";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import { bestAndWorstSales, type GainsAnalysis, type GainsBucket, type GainsSale } from "@/core/gains-analysis";
import { BarsChart, type BarsSeries } from "../charts/BarsChart";
import { CardHeading } from "../overview/CardHeading";
import { GainLossPill } from "../positions/GainLossPill";
import { SecurityLink } from "../security-detail/SecurityLink";
import { SecurityLogo } from "../securities/SecurityLogo";
import {
  cashFlowAriaLabel,
  GAINS_EMPTY_TEXT,
  GAINS_LABELS,
  GAINS_NO_BEST_TEXT,
  GAINS_NO_SALES_TEXT,
  GAINS_NO_WORST_TEXT,
  GAINS_VIEWS,
  type GainsView as GainsViewMode,
  gainsBucketLabel,
  gainsBucketShortLabel,
  gainsBuckets,
  gainsChartAriaLabel,
  gainsSalesInRange,
  gainsYears,
  negateAmount,
  sumGainsBuckets,
} from "./labels";

export type GainsViewProps = {
  /** Months, years and sales of the scope (`core/gains-analysis`). */
  analysis: GainsAnalysis;
  /** Security id → name. */
  securityNames: Readonly<Record<string, string>>;
  /** Business date `YYYY-MM-DD`; its year is the default "Jahr". */
  today: string;
};

const money = (value: string) => formatMoney(value, { sign: true });
/** Chart coordinate of a decimal string (presentation edge only). */
const plot = (value: string) => Number(value);

function colors(theme: Theme) {
  const palette = (theme.vars ?? theme).palette;
  return {
    gain: palette.gain?.main ?? palette.success.main,
    loss: palette.loss?.main ?? palette.error.main,
    dividends: palette.chart?.series2 ?? palette.info.main,
    fees: palette.chart?.series3 ?? palette.warning.main,
    inflow: palette.primary.main,
    outflow: palette.chart?.series4 ?? palette.secondary.main,
  };
}

/** Summary of the selected range as a definition list. */
function Summary({ entries }: { entries: [string, string][] }) {
  return (
    <Box component="dl" sx={{ m: 0, mt: 1.5, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.5, maxWidth: 360 }}>
      {entries.map(([term, value]) => (
        <Box key={term} sx={{ display: "contents" }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {term}
          </Typography>
          <Typography component="dd" variant="body2" sx={{ m: 0, textAlign: "right", fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const cell = { px: 1, py: 0.75, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", fontSize: 13, borderBottom: 1, borderColor: "divider" } as const;

/** Compact value table: "Zeitraum" plus one column per value, so nothing relies on colour or hover. */
function ValueTable({ caption, columns, buckets }: { caption: string; columns: [string, (bucket: GainsBucket) => string][]; buckets: readonly GainsBucket[] }) {
  return (
    <Box sx={{ overflowX: "auto", maxWidth: "100%", mt: 1.5 }}>
      <Box component="table" sx={{ borderCollapse: "collapse", width: "100%" }}>
        <Box component="caption" sx={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          {caption}
        </Box>
        <thead>
          <tr>
            <Box component="th" scope="col" sx={{ ...cell, textAlign: "left", fontWeight: 600, color: "text.secondary", fontSize: 12 }}>
              {GAINS_LABELS.period}
            </Box>
            {columns.map(([label]) => (
              <Box component="th" scope="col" key={label} sx={{ ...cell, fontWeight: 600, color: "text.secondary", fontSize: 12 }}>
                {label}
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {buckets.map((bucket) => (
            <tr key={bucket.period}>
              <Box component="th" scope="row" sx={{ ...cell, textAlign: "left", fontWeight: 500 }}>
                {gainsBucketLabel(bucket.period)}
              </Box>
              {columns.map(([label, value]) => (
                <Box component="td" key={label} sx={cell}>
                  {value(bucket)}
                </Box>
              ))}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function SaleRow({ sale, name }: { sale: GainsSale; name: string }) {
  return (
    <Box
      component="li"
      sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.125, minHeight: 44, borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}
    >
      <SecurityLogo securityId={sale.securityId} name={name} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" component="span" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
          <SecurityLink securityId={sale.securityId} depotId={sale.depotId}>
            {name}
          </SecurityLink>
        </Typography>
        <Typography variant="caption" color="text.secondary" component="p">
          {`${formatDate(sale.date)} · ${formatQuantity(sale.quantity)} Stk.`}
        </Typography>
      </Box>
      <GainLossPill gain={sale.gain} ratio={sale.gainRatio} />
    </Box>
  );
}

function SaleList({ id, heading, sales, emptyText, names }: { id: string; heading: string; sales: readonly GainsSale[]; emptyText: string; names: Readonly<Record<string, string>> }) {
  return (
    <Box component="section" aria-labelledby={id} sx={{ flex: 1, minWidth: 0 }}>
      <CardHeading id={id}>{heading}</CardHeading>
      {sales.length === 0 ? (
        <Typography variant="body2">{emptyText}</Typography>
      ) : (
        <Box component="ol" aria-label={heading} sx={{ listStyle: "none", m: 0, p: 0 }}>
          {sales.map((sale) => (
            <SaleRow key={`${sale.depotId}\u0000${sale.date}\u0000${sale.sequence}`} sale={sale} name={names[sale.securityId] ?? sale.securityId} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Gewinne (FR-22): realized gains per month of a chosen year or per year, with switchable dividend and
 * fee layers (taxes only in the summary), the five best and worst sales, and the net Kapitalfluss
 * (Deposits − Withdrawals). View, year and layers are client state; every figure comes from
 * `core/gains-analysis`.
 */
export function GainsView({ analysis, securityNames, today }: GainsViewProps) {
  const palette = colors(useTheme());
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [view, setView] = useState<GainsViewMode>("months");
  const [chosenYear, setChosenYear] = useState(today.slice(0, 4));
  const [layers, setLayers] = useState({ dividends: false, fees: false });

  if (analysis.months.length === 0) {
    return (
      <Card component="section" aria-labelledby={`${ids}-gains`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-gains`}>{GAINS_LABELS.gainsHeading}</CardHeading>
          <Typography variant="body2">{GAINS_EMPTY_TEXT}</Typography>
        </CardContent>
      </Card>
    );
  }

  const years = gainsYears(analysis.years);
  // A year the scope does not cover (e.g. after a scope change) falls back to the newest year.
  const year = years.includes(chosenYear) ? chosenYear : years[0];
  const buckets = gainsBuckets(analysis.months, analysis.years, view, year);
  const totals = sumGainsBuckets(buckets);
  const categories = buckets.map((bucket) => gainsBucketShortLabel(bucket.period));
  const { best, worst } = bestAndWorstSales(gainsSalesInRange(analysis.sales, view, year));
  const noSales = best.length === 0 && worst.length === 0;

  const gainSeries: BarsSeries[] = [
    {
      id: "gain",
      label: `${GAINS_LABELS.realized} (Gewinn)`,
      color: palette.gain,
      stack: "realized",
      values: buckets.map((b) => (plot(b.realized) > 0 ? plot(b.realized) : null)),
      text: (i) => (plot(buckets[i].realized) > 0 ? money(buckets[i].realized) : null),
    },
    {
      id: "loss",
      label: `${GAINS_LABELS.realized} (Verlust)`,
      color: palette.loss,
      stack: "realized",
      values: buckets.map((b) => (plot(b.realized) < 0 ? plot(b.realized) : null)),
      text: (i) => (plot(buckets[i].realized) < 0 ? money(buckets[i].realized) : null),
    },
  ];
  if (layers.dividends) {
    gainSeries.push({ id: "dividends", label: GAINS_LABELS.dividends, color: palette.dividends, values: buckets.map((b) => plot(b.dividends)), text: (i) => money(buckets[i].dividends) });
  }
  if (layers.fees) {
    gainSeries.push({ id: "fees", label: GAINS_LABELS.fees, color: palette.fees, values: buckets.map((b) => -plot(b.fees)), text: (i) => money(negateAmount(buckets[i].fees)) });
  }

  const flowSeries: BarsSeries[] = [
    {
      id: "inflow",
      label: "Netto-Zufluss",
      color: palette.inflow,
      stack: "net",
      values: buckets.map((b) => (plot(b.netCashFlow) > 0 ? plot(b.netCashFlow) : null)),
      text: (i) => (plot(buckets[i].netCashFlow) > 0 ? money(buckets[i].netCashFlow) : null),
    },
    {
      id: "outflow",
      label: "Netto-Abfluss",
      color: palette.outflow,
      stack: "net",
      values: buckets.map((b) => (plot(b.netCashFlow) < 0 ? plot(b.netCashFlow) : null)),
      text: (i) => (plot(buckets[i].netCashFlow) < 0 ? money(buckets[i].netCashFlow) : null),
    },
  ];

  const control = { minHeight: 44 } as const;

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { xs: "stretch", sm: "center" }, flexWrap: "wrap", rowGap: 1 }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          aria-label={GAINS_LABELS.view}
          value={view}
          onChange={(_event, next: GainsViewMode | null) => {
            if (next !== null) setView(next);
          }}
        >
          {GAINS_VIEWS.map((option) => (
            <ToggleButton key={option.value} value={option.value} sx={{ ...control, px: 2 }}>
              {option.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        {view === "months" ? (
          <TextField
            select
            size="small"
            label={GAINS_LABELS.year}
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
        <FormControlLabel
          sx={{ ...control, mx: 0 }}
          control={<Switch checked={layers.dividends} onChange={(event) => setLayers({ ...layers, dividends: event.target.checked })} />}
          label={GAINS_LABELS.dividendsLayer}
        />
        <FormControlLabel
          sx={{ ...control, mx: 0 }}
          control={<Switch checked={layers.fees} onChange={(event) => setLayers({ ...layers, fees: event.target.checked })} />}
          label={GAINS_LABELS.feesLayer}
        />
      </Stack>

      <Card component="section" aria-labelledby={`${ids}-gains`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-gains`}>{GAINS_LABELS.gainsHeading}</CardHeading>
          <BarsChart ariaLabel={gainsChartAriaLabel(buckets, layers)} categories={categories} series={gainSeries} />
          <Summary
            entries={[
              [GAINS_LABELS.realized, money(totals.realized)],
              [GAINS_LABELS.dividends, money(totals.dividends)],
              [GAINS_LABELS.fees, money(negateAmount(totals.fees))],
              [GAINS_LABELS.taxes, formatMoney(totals.taxes)],
            ]}
          />
          <ValueTable
            caption={GAINS_LABELS.gainsHeading}
            buckets={buckets}
            columns={[
              [GAINS_LABELS.realized, (b) => money(b.realized)],
              [GAINS_LABELS.dividends, (b) => money(b.dividends)],
              [GAINS_LABELS.fees, (b) => money(negateAmount(b.fees))],
              [GAINS_LABELS.taxes, (b) => formatMoney(b.taxes)],
            ]}
          />
        </CardContent>
      </Card>

      <Card
        component="section"
        aria-labelledby={noSales ? `${ids}-sales` : undefined}
        aria-label={noSales ? undefined : GAINS_LABELS.sales}
        sx={{ minWidth: 0 }}
      >
        <CardContent>
          {noSales ? (
            <>
              <CardHeading id={`${ids}-sales`}>{GAINS_LABELS.sales}</CardHeading>
              <Typography variant="body2">{GAINS_NO_SALES_TEXT}</Typography>
            </>
          ) : (
            <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
              <SaleList id={`${ids}-best`} heading={GAINS_LABELS.bestHeading} sales={best} emptyText={GAINS_NO_BEST_TEXT} names={securityNames} />
              <SaleList id={`${ids}-worst`} heading={GAINS_LABELS.worstHeading} sales={worst} emptyText={GAINS_NO_WORST_TEXT} names={securityNames} />
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby={`${ids}-flow`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-flow`}>{GAINS_LABELS.cashFlowHeading}</CardHeading>
          <BarsChart ariaLabel={cashFlowAriaLabel(buckets)} categories={categories} series={flowSeries} />
          <Summary
            entries={[
              [GAINS_LABELS.deposits, money(totals.deposits)],
              [GAINS_LABELS.withdrawals, money(negateAmount(totals.withdrawals))],
              [GAINS_LABELS.net, money(totals.netCashFlow)],
            ]}
          />
          <ValueTable
            caption={GAINS_LABELS.cashFlowHeading}
            buckets={buckets}
            columns={[
              [GAINS_LABELS.deposits, (b) => money(b.deposits)],
              [GAINS_LABELS.withdrawals, (b) => money(negateAmount(b.withdrawals))],
              [GAINS_LABELS.net, (b) => money(b.netCashFlow)],
            ]}
          />
        </CardContent>
      </Card>
    </Stack>
  );
}
