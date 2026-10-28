"use client";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useState, useTransition } from "react";
import { refreshKeyFiguresAction } from "@/app/_actions/key-figures";
import { CardHeading } from "@/app/_components/overview/CardHeading";
import { formatCompactAmount, formatDate, formatFigure, formatMoney, formatPercent, formatRate } from "@/core/format";
import { type DatedClose, type FiftyTwoWeekFigures, hasProviderKeyFigures, type ProviderKeyFigures, upcomingEarningsDate } from "@/core/key-figures";
import type { KeyFiguresSnapshot } from "@/modules/classification";

const MISSING = "–";
const NBSP = " ";

/** Source line of the card. */
export const KEY_FIGURES_SOURCE = "Yahoo Finance";
export const KEY_FIGURES_HINT = "Angaben ohne Gewähr, keine Anlageberatung";

type Row = { label: string; value: string };
type Group = { title: string; rows: Row[]; note?: string };

const figure = (value: string | null) => (value === null ? MISSING : formatFigure(value));
const rate = (value: string | null) => (value === null ? MISSING : formatRate(value));
const date = (value: string | null) => (value === null ? MISSING : formatDate(value));
/** An amount with its own currency (never labelled € unless it is EUR). */
const amount = (value: string | null, currency: string | null) =>
  value === null ? MISSING : currency ? formatCompactAmount(value, currency) : formatCompactAmount(value, "").trimEnd();
/** `debtToEquity` arrives in percent units (22.789 = 22,79 %). */
const percentUnits = (value: string | null) => (value === null ? MISSING : `${formatFigure(value)}${NBSP}%`);
const close = (value: DatedClose | null) => (value === null ? MISSING : `${formatMoney(value.price)} (${formatDate(value.date)})`);

function stockGroups(figures: ProviderKeyFigures, today: string): Group[] {
  return [
    {
      title: "Bewertung",
      rows: [
        { label: "KGV", value: figure(figures.trailingPE) },
        { label: "KGV erwartet", value: figure(figures.forwardPE) },
        { label: "KBV", value: figure(figures.priceToBook) },
        { label: "KUV", value: figure(figures.priceToSales) },
        { label: "PEG", value: figure(figures.pegRatio) },
      ],
    },
    {
      title: "Größe",
      rows: [
        { label: "Marktkapitalisierung", value: amount(figures.marketCap, figures.marketCapCurrency) },
        { label: "Umsatz (12 Monate)", value: amount(figures.revenue, figures.revenueCurrency) },
      ],
    },
    {
      title: "Dividende",
      rows: [
        { label: "Dividendenrendite", value: rate(figures.dividendYield) },
        { label: "Ausschüttungsquote", value: rate(figures.payoutRatio) },
        { label: "letzter Ex-Tag", value: date(figures.exDividendDate) },
      ],
    },
    {
      title: "Qualität",
      rows: [
        { label: "Nettomarge", value: rate(figures.profitMargin) },
        { label: "Eigenkapitalrendite", value: rate(figures.returnOnEquity) },
        { label: "Umsatzwachstum", value: rate(figures.revenueGrowth) },
        { label: "Verschuldungsgrad", value: percentUnits(figures.debtToEquity) },
      ],
    },
    { title: "Risiko", rows: [{ label: "Beta", value: figure(figures.beta) }] },
    { title: "Termine", rows: [{ label: "nächste Quartalszahlen", value: date(upcomingEarningsDate(figures.nextEarningsDate, today)) }] },
  ];
}

function fundGroups(figures: ProviderKeyFigures): Group[] {
  return [
    {
      title: "Fonds",
      rows: [
        { label: "Fondsgesellschaft", value: figures.fundFamily ?? MISSING },
        { label: "laufende Kosten (TER)", value: rate(figures.expenseRatio) },
        { label: "Auflagedatum", value: date(figures.inceptionDate) },
      ],
    },
  ];
}

function priceGroup(fiftyTwoWeek: FiftyTwoWeekFigures): Group {
  return {
    title: "Kurs · 52 Wochen",
    note: "auf Schlusskursbasis",
    rows: [
      { label: "52-Wochen-Hoch", value: close(fiftyTwoWeek.high) },
      { label: "52-Wochen-Tief", value: close(fiftyTwoWeek.low) },
      { label: "Abstand zum 52-Wochen-Hoch", value: rate(fiftyTwoWeek.distanceToHigh) },
      { label: "Performance 52 Wochen", value: fiftyTwoWeek.performance === null ? MISSING : formatPercent(fiftyTwoWeek.performance) },
    ],
  };
}

function GroupList({ group, id }: { group: Group; id: string }) {
  return (
    <Box component="section" aria-labelledby={id} sx={{ minWidth: 0 }}>
      <Typography id={id} component="h3" variant="body2" sx={{ fontWeight: 600 }}>
        {group.title}
      </Typography>
      {group.note ? (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
          {group.note}
        </Typography>
      ) : null}
      <Box component="dl" sx={{ m: 0, mt: 0.5, display: "grid", gridTemplateColumns: "1fr auto", columnGap: 2, alignItems: "baseline" }}>
        {group.rows.map((row) => (
          <Box key={row.label} sx={{ display: "contents" }}>
            <Typography component="dt" variant="body2" sx={{ m: 0, py: 0.25 }}>
              {row.label}
            </Typography>
            <Typography component="dd" variant="figure" sx={{ m: 0, py: 0.25, textAlign: "right", whiteSpace: "nowrap" }}>
              {row.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** "Yahoo Finance, Stand TT.MM.JJJJ"; a stale snapshot shows the date as a warning-soft pill. */
function SourceLine({ snapshot }: { snapshot: KeyFiguresSnapshot | null }) {
  if (snapshot === null) {
    return (
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
        Noch keine Daten von {KEY_FIGURES_SOURCE}
      </Typography>
    );
  }
  const stand = `Stand ${formatDate(snapshot.asOf)}`;
  if (!snapshot.stale) {
    return (
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
        {KEY_FIGURES_SOURCE}, {stand}
      </Typography>
    );
  }
  return (
    <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
      {KEY_FIGURES_SOURCE},{" "}
      <Box
        component="span"
        data-stale-badge=""
        sx={{
          display: "inline-flex",
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
        {stand} – veraltet
      </Box>
    </Typography>
  );
}

/**
 * Card "Kennzahlen" (story 9.6, both detail layouts): for a STOCK the provider groups Bewertung · Größe ·
 * Dividende · Qualität · Risiko · Termine, for an ETF/fund Fondsgesellschaft, TER and Auflagedatum (each
 * with source and date, a stale snapshot flagged), and for every type the 52-week figures computed from
 * the stored closes. "Kennzahlen aktualisieren" fetches now (at most once a day). Computes nothing itself.
 */
export function KeyFiguresCard({
  securityId,
  assetType,
  snapshot,
  fiftyTwoWeek,
  canRefresh,
  today,
}: {
  securityId: string;
  assetType: string;
  snapshot: KeyFiguresSnapshot | null;
  fiftyTwoWeek: FiftyTwoWeekFigures;
  /** A held or watched STOCK/ETF/FUND with a Yahoo mapping. */
  canRefresh: boolean;
  today: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const provider = hasProviderKeyFigures(assetType);
  const groups: Group[] = [];
  if (provider && snapshot) groups.push(...(assetType === "STOCK" ? stockGroups(snapshot.figures, today) : fundGroups(snapshot.figures)));
  groups.push(priceGroup(fiftyTwoWeek));
  const fresh = snapshot?.fetchedToday ?? false;

  const refresh = () =>
    startTransition(async () => {
      const result = await refreshKeyFiguresAction(securityId);
      setMessage(result.ok ? result.message : "Sitzung abgelaufen. Bitte erneut anmelden.");
    });

  return (
    <Card component="section" aria-labelledby="security-key-figures" sx={{ mb: 2, minWidth: 0 }}>
      <CardContent>
        <CardHeading id="security-key-figures">Kennzahlen</CardHeading>
        {provider ? <SourceLine snapshot={snapshot} /> : null}
        <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, columnGap: 4, rowGap: 2 }}>
          {groups.map((group, index) => (
            <GroupList key={group.title} group={group} id={`key-figures-group-${index}`} />
          ))}
        </Box>
        <Stack spacing={1} sx={{ mt: 2, alignItems: "flex-start" }}>
          {provider && canRefresh ? (
            <Button variant="outlined" size="small" onClick={refresh} disabled={pending || fresh} sx={{ minHeight: 44 }}>
              {fresh ? "Heute schon aktualisiert" : "Kennzahlen aktualisieren"}
            </Button>
          ) : null}
          {message ? (
            <Typography variant="body2" role="status">
              {message}
            </Typography>
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {KEY_FIGURES_HINT}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
