"use client";

import ExpandLess from "@mui/icons-material/ExpandLess";
import ExpandMore from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useId, useState } from "react";
import { CardHeading } from "@/app/_components/overview/CardHeading";
import {
  type AnalystChange,
  analystConsensusOf,
  analystCountOf,
  type AnalystRatings,
  currentTrend,
  hasAnalystData,
  type PriceTarget,
  type RatingCounts,
  ratingShares,
  type RatingShares,
  targetChange,
  type TrendPeriod,
} from "@/core/analyst-ratings";
import { formatDate, formatFigure, formatPercent, formatQuantity, formatShare } from "@/core/format";
import type { KeyFiguresSnapshot } from "@/modules/classification";
import { SourceLine } from "./KeyFiguresCard";
import { CONSENSUS_LABELS } from "./labels";

const MISSING = "–";
const NBSP = " ";

export const ANALYST_RATINGS_HINT = "Einschätzungen von Analysten, keine Anlageberatung";


const PERIOD_LABELS: Record<TrendPeriod, string> = {
  "-3m": "vor 3 Monaten",
  "-2m": "vor 2 Monaten",
  "-1m": "vor 1 Monat",
  "0m": "aktuell",
};

const visuallyHidden = {
  position: "absolute",
  width: 1,
  height: 1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
  p: 0,
  m: "-1px",
} as const;

const GAIN = "var(--mui-palette-gain-main)";
const LOSS = "var(--mui-palette-loss-main)";
const HOLD = "var(--mui-palette-cash-main)";
/** Lighter tone of a group (normal part): gain/loss at 45 % opacity; Halten is `cash.main` throughout. */
const LIGHT_OPACITY = 0.45;

type GroupKey = keyof RatingShares;
type Group = { key: GroupKey; label: string; color: string; lightOpacity: number; strong: number; normal: number };

/** The three chart groups of a month's counts. */
function groupsOf(counts: RatingCounts): Group[] {
  return [
    { key: "buy", label: "Kaufen", color: GAIN, lightOpacity: LIGHT_OPACITY, strong: counts.strongBuy, normal: counts.buy },
    { key: "hold", label: "Halten", color: HOLD, lightOpacity: 1, strong: 0, normal: counts.hold },
    { key: "sell", label: "Verkaufen", color: LOSS, lightOpacity: LIGHT_OPACITY, strong: counts.strongSell, normal: counts.sell },
  ];
}

/** "Kaufen 20+11" (normal+strong), "Halten 14". */
function groupText(group: Group): string {
  return group.key === "hold" ? `${group.label} ${group.normal}` : `${group.label} ${group.normal}+${group.strong}`;
}

/** A price in the listing's currency: € for EUR, else the ISO code (never converted). */
function price(value: string | null, currency: string | null): string {
  if (value === null) return MISSING;
  const unit = currency === null ? "" : currency === "EUR" ? `${NBSP}€` : `${NBSP}${currency}`;
  return `${formatFigure(value)}${unit}`;
}

// ---- Donut (presentation only: finished share strings are converted with Number() for the geometry) ----

const SIZE = 132;
const CENTER = SIZE / 2;
const OUTER = 64;
const INNER = 38;

function point(radius: number, fraction: number): string {
  const angle = 2 * Math.PI * fraction - Math.PI / 2;
  return `${(CENTER + radius * Math.cos(angle)).toFixed(3)} ${(CENTER + radius * Math.sin(angle)).toFixed(3)}`;
}

/** Annular sector from `start` to `end` (fractions of the circle, clockwise from 12 o'clock). */
function sectorPath(start: number, end: number, inner: number, outer: number): string {
  // An arc cannot span the full circle: draw a (near) full sector as two halves.
  if (end - start > 0.5) {
    const middle = start + (end - start) / 2;
    return `${sectorPath(start, middle, inner, outer)} ${sectorPath(middle, end, inner, outer)}`;
  }
  return [
    `M ${point(outer, start)}`,
    `A ${outer} ${outer} 0 0 1 ${point(outer, end)}`,
    `L ${point(inner, end)}`,
    `A ${inner} ${inner} 0 0 0 ${point(inner, start)}`,
    "Z",
  ].join(" ");
}

function Donut({ groups, shares }: { groups: Group[]; shares: RatingShares }) {
  const sizes = groups.map((group) => Number(shares[group.key].share));
  // Each sector starts where the previous ones end, measured from 12 o'clock.
  const sectors = groups.flatMap((group, index) => {
    const share = sizes[index];
    if (share <= 0) return [];
    const from = sizes.slice(0, index).reduce((sum, size) => sum + size, 0);
    const strongShare = Number(shares[group.key].strongShare);
    return [{ group, from, to: from + share, strongOuter: INNER + (OUTER - INNER) * strongShare }];
  });
  return (
    <Box component="svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" data-analyst-donut="" sx={{ width: SIZE, height: SIZE, flexShrink: 0 }}>
      {sectors.map(({ group, from, to, strongOuter }) => (
        <g key={group.key} data-sector={group.key}>
          <path d={sectorPath(from, to, INNER, OUTER)} fill={group.color} fillOpacity={group.lightOpacity} />
          {strongOuter > INNER ? <path data-strong="" d={sectorPath(from, to, INNER, strongOuter)} fill={group.color} /> : null}
        </g>
      ))}
    </Box>
  );
}

function Legend({ groups }: { groups: Group[] }) {
  return (
    <Box component="ul" aria-hidden="true" sx={{ listStyle: "none", m: 0, p: 0, display: "grid", gap: 0.75 }}>
      {groups.map((group) => (
        <Stack key={group.key} component="li" direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box
            component="span"
            sx={{
              width: 12,
              height: 12,
              borderRadius: "3px",
              flexShrink: 0,
              bgcolor: group.color,
              opacity: group.key === "hold" ? 1 : 0.85,
            }}
          />
          <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums" }}>
            {groupText(group)}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}

/** The current month as a table for keyboard and screen-reader users (visually hidden). */
function SharesTable({ groups, shares }: { groups: Group[]; shares: RatingShares }) {
  return (
    <Box component="table" sx={visuallyHidden}>
      <caption>Analystenbewertungen aktuell</caption>
      <thead>
        <tr>
          <th scope="col">Bewertung</th>
          <th scope="col">Stark</th>
          <th scope="col">Normal</th>
          <th scope="col">Anteil</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.key}>
            <th scope="row">{group.label}</th>
            <td>{group.key === "hold" ? MISSING : group.strong}</td>
            <td>{group.normal}</td>
            <td>{formatShare(shares[group.key].share)}</td>
          </tr>
        ))}
      </tbody>
    </Box>
  );
}

// ---- Trend: four stacked columns, heights by count via flex-grow (no number arithmetic) ----

const TREND_HEIGHT = 96;

function TrendColumns({ trend }: { trend: AnalystRatings["trend"] }) {
  const max = Math.max(...trend.map((month) => month.strongBuy + month.buy + month.hold + month.sell + month.strongSell), 0);
  return (
    <Box component="section" aria-labelledby="analyst-trend" sx={{ minWidth: 0 }}>
      <Typography id="analyst-trend" component="h3" variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
        Entwicklung
      </Typography>
      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-end" }}>
        {trend.map((month) => {
          const total = month.strongBuy + month.buy + month.hold + month.sell + month.strongSell;
          const label = `${PERIOD_LABELS[month.period]}: Stark kaufen ${month.strongBuy}, Kaufen ${month.buy}, Halten ${month.hold}, Verkaufen ${month.sell}, Stark verkaufen ${month.strongSell}`;
          const parts = [
            { key: "strongBuy", count: month.strongBuy, color: GAIN, opacity: 1 },
            { key: "buy", count: month.buy, color: GAIN, opacity: LIGHT_OPACITY },
            { key: "hold", count: month.hold, color: HOLD, opacity: 1 },
            { key: "sell", count: month.sell, color: LOSS, opacity: LIGHT_OPACITY },
            { key: "strongSell", count: month.strongSell, color: LOSS, opacity: 1 },
          ];
          return (
            <Stack key={month.period} role="img" aria-label={label} data-trend-month={month.period} sx={{ alignItems: "center", flex: 1, minWidth: 0 }}>
              <Box sx={{ height: TREND_HEIGHT, width: "100%", maxWidth: 40, display: "flex", flexDirection: "column" }}>
                <Box sx={{ flexGrow: max - total }} />
                {parts.map((part) =>
                  part.count > 0 ? (
                    <Box key={part.key} data-part={part.key} sx={{ flexGrow: part.count, flexBasis: 0, bgcolor: part.color, opacity: part.opacity }} />
                  ) : null,
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" aria-hidden="true" sx={{ mt: 0.5, textAlign: "center", whiteSpace: "nowrap" }}>
                {PERIOD_LABELS[month.period]}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Box>
  );
}

function TargetSection({ target }: { target: PriceTarget }) {
  const change = targetChange(target);
  const range = target.low === null || target.high === null ? MISSING : `${price(target.low, null)} – ${price(target.high, target.currency)}`;
  return (
    <Box component="section" aria-labelledby="analyst-target" sx={{ minWidth: 0 }}>
      <Typography id="analyst-target" component="h3" variant="body2" sx={{ fontWeight: 600 }}>
        Kursziel
      </Typography>
      <Typography variant="figure" component="p" sx={{ m: 0, fontSize: 20, fontWeight: 600 }}>
        Ø {price(target.mean, target.currency)}
      </Typography>
      <Typography variant="body2" component="p" sx={{ m: 0 }}>
        Spanne {range}
      </Typography>
      <Typography variant="body2" component="p" sx={{ m: 0 }}>
        <Box
          component="span"
          data-target-change=""
          sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", color: change === null ? undefined : change.startsWith("-") ? "loss.main" : "gain.main" }}
        >
          {change === null ? MISSING : formatPercent(change)}
        </Box>{" "}
        zum aktuellen Kurs
        {target.currency && target.currency !== "EUR" ? ` (${target.currency})` : null}
      </Typography>
    </Box>
  );
}

/** "21.10.2026 · Firm · Hold → Buy · Kursziel 250 → 270". */
function changeText(change: AnalystChange): string {
  const grade = change.fromGrade ? `${change.fromGrade} → ${change.toGrade}` : change.toGrade;
  const parts = [formatDate(change.date), change.firm, grade];
  if (change.priceTargetTo !== null) {
    parts.push(
      change.priceTargetFrom !== null
        ? `Kursziel ${formatQuantity(change.priceTargetFrom)} → ${formatQuantity(change.priceTargetTo)}`
        : `Kursziel ${formatQuantity(change.priceTargetTo)}`,
    );
  }
  return parts.join(" · ");
}

function RecentChanges({ changes }: { changes: AnalystChange[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (changes.length === 0) return null;
  return (
    <Box>
      <Button
        size="small"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        endIcon={open ? <ExpandLess aria-hidden /> : <ExpandMore aria-hidden />}
        sx={{ minHeight: 44, px: 0 }}
      >
        Letzte Änderungen
      </Button>
      {open ? (
        <Box component="ul" id={listId} sx={{ m: 0, pl: 2.5 }}>
          {changes.map((change, index) => (
            <Typography key={`${change.date}-${change.firm}-${index}`} component="li" variant="body2" sx={{ py: 0.25 }}>
              {changeText(change)}
            </Typography>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}

/**
 * Card "Analystenbewertungen" (story 9.7, stocks only, both detail layouts): consensus "Optimistisch ·
 * 51 Analysten", a Kaufen/Halten/Verkaufen donut (strong parts as the darker inner band, labels with
 * counts, a visually hidden table for screen readers), the 4-month trend as stacked columns, the Kursziel
 * (mean, range, implied change against the same listing's price, in its currency), the collapsible
 * "Letzte Änderungen", source with date (stale pill; "· Daten von AAPL" when the analyst listing differs)
 * and the no-advice hint. Renders nothing without analyst data. Computes nothing itself (core does).
 */
export function AnalystRatingsCard({ snapshot }: { snapshot: KeyFiguresSnapshot }) {
  const ratings = snapshot.analysts;
  if (!hasAnalystData(ratings)) return null;
  const consensus = analystConsensusOf(ratings);
  const count = analystCountOf(ratings);
  const current = currentTrend(ratings);
  const shares = current ? ratingShares(current) : null;
  const groups = current ? groupsOf(current) : [];
  const headline = [
    consensus ? CONSENSUS_LABELS[consensus] : null,
    count !== null && count > 0 ? `${count} ${count === 1 ? "Analyst" : "Analysten"}` : null,
  ].filter(Boolean);
  const otherListing = snapshot.analystSymbol !== null && snapshot.analystSymbol.toUpperCase() !== snapshot.symbol.toUpperCase();

  return (
    <Card component="section" aria-labelledby="security-analyst-ratings" sx={{ mb: 2, minWidth: 0 }}>
      <CardContent>
        <CardHeading id="security-analyst-ratings">Analystenbewertungen</CardHeading>
        <SourceLine snapshot={snapshot} suffix={otherListing ? `· Daten von ${snapshot.analystSymbol}` : undefined} />
        {headline.length > 0 ? (
          <Typography component="p" variant="subtitle1" data-consensus={consensus ?? undefined} sx={{ m: 0, mt: 1, fontWeight: 600 }}>
            {headline.join(" · ")}
          </Typography>
        ) : null}
        <Box sx={{ mt: 1.5, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, columnGap: 4, rowGap: 2.5 }}>
          {shares ? (
            <Stack direction="row" spacing={2} sx={{ alignItems: "center", minWidth: 0 }}>
              <Donut groups={groups} shares={shares} />
              <Legend groups={groups} />
              <SharesTable groups={groups} shares={shares} />
            </Stack>
          ) : null}
          {ratings.trend.length > 0 ? <TrendColumns trend={ratings.trend} /> : null}
          <TargetSection target={ratings.target} />
        </Box>
        <Stack spacing={1} sx={{ mt: 2, alignItems: "flex-start" }}>
          <RecentChanges changes={ratings.changes} />
          <Typography variant="caption" color="text.secondary">
            {ANALYST_RATINGS_HINT}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

