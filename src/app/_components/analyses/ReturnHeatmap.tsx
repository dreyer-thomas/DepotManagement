"use client";

import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import type { SxProps, Theme } from "@mui/material/styles";
import { type ReactNode, useState } from "react";
import type { HeatmapMonth, HeatmapYear } from "@/core/return-heatmap";
import { formatDate, formatMoney, formatMonth, formatPercent } from "@/core/format";
import { CardHeading } from "../overview/CardHeading";
import {
  HEATMAP_EMPTY_TEXT,
  HEATMAP_GRANULARITIES,
  HEATMAP_MONTH_LABELS,
  HEATMAP_QUARTER_LABELS,
  HEATMAP_RUNNING_LABEL,
  HEATMAP_TOTAL_LABEL,
  HEATMAP_YEAR_LABEL,
  type HeatmapGranularity,
  heatmapCellTone,
  heatmapTintAlpha,
} from "./labels";

export type ReturnHeatmapProps = {
  /** Scope value (`portfolio` or a Depot id); a change clears the selected month. */
  scope: string;
  /** Years newest first (`core/return-heatmap`). */
  years: readonly HeatmapYear[];
  /** Card heading; default "Rendite je Monat". */
  heading?: string;
  /** Id of the heading element; default `heatmap-heading`. */
  headingId?: string;
  /**
   * Security variant (story 7-8): a "Q | M" toggle (default M) instead of the fixed months + quarters +
   * "Jahr" columns — M shows the 12 months, Q the four quarters, each followed by "Gesamt".
   */
  granularityToggle?: boolean;
  /** Optional content below the grid (e.g. a link). */
  footer?: ReactNode;
};

const DEFAULT_HEADING_ID = "heatmap-heading";

const percentText = (ratio: string | null) => (ratio === null ? "–" : formatPercent(ratio));

/** Background tint of a cell: gain/loss colour over the surface, stronger with |r|; neutral cells stay plain. */
function tint(ratio: string | null): SxProps<Theme> {
  const { tone, intensity } = heatmapCellTone(ratio);
  if (tone === "neutral") return {};
  const mix = (alpha: number) => `color-mix(in srgb, var(--mui-palette-${tone}-main) ${Math.round(alpha * 100)}%, transparent)`;
  return (theme: Theme) => ({
    bgcolor: mix(heatmapTintAlpha(intensity, "light")),
    ...theme.applyStyles("dark", { bgcolor: mix(heatmapTintAlpha(intensity, "dark")) }),
  });
}

/**
 * Signed value with a small arrow in the cell's tone (none when neutral), so gain/loss never relies on
 * colour alone (UX-DR21); the arrow is decorative, the sign carries the meaning for screen readers.
 */
function SignedPercent({ ratio }: { ratio: string | null }) {
  const { tone } = heatmapCellTone(ratio);
  const Arrow = tone === "loss" ? ArrowDownward : ArrowUpward;
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
      {tone === "neutral" ? null : <Arrow aria-hidden sx={{ fontSize: 12 }} />}
      {percentText(ratio)}
    </Box>
  );
}

const cellBase = {
  p: 0.5,
  minWidth: 68,
  height: 44,
  textAlign: "center",
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
  fontSize: 13,
  color: "text.primary",
  borderBottom: 1,
  borderColor: "divider",
} as const;

const headerCell = { ...cellBase, fontWeight: 600, color: "text.secondary", fontSize: 12, height: 32 } as const;

/** Sticky first column so the year stays visible while the grid scrolls sideways. */
const yearColumn = { position: "sticky", left: 0, zIndex: 1, bgcolor: "background.paper", minWidth: 56, textAlign: "left", pl: 1 } as const;

function monthLabel(month: HeatmapMonth): string {
  return formatMonth(`${month.month}-01`);
}

function MonthCell({ month, selected, onToggle }: { month: HeatmapMonth; selected: boolean; onToggle: () => void }) {
  const label = `${monthLabel(month)}: ${percentText(month.return)}${month.running ? `, ${HEATMAP_RUNNING_LABEL}` : ""}`;
  return (
    <Box component="td" sx={[{ ...cellBase, p: 0 }, tint(month.return)] as SxProps<Theme>}>
      <ButtonBase
        aria-label={label}
        aria-pressed={selected}
        onClick={onToggle}
        sx={{
          width: "100%",
          minHeight: 44,
          px: 0.5,
          flexDirection: "column",
          font: "inherit",
          color: "inherit",
          outline: selected ? 2 : 0,
          outlineColor: "primary.main",
          outlineOffset: -2,
          "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
        }}
      >
        <SignedPercent ratio={month.return} />
        {month.running ? (
          <Typography component="span" variant="caption" sx={{ fontSize: 10, lineHeight: 1.2, color: "inherit" }}>
            {HEATMAP_RUNNING_LABEL}
          </Typography>
        ) : null}
      </ButtonBase>
    </Box>
  );
}

function TotalCell({ ratio, strong = false }: { ratio: string | null; strong?: boolean }) {
  return (
    <Box component="td" sx={[{ ...cellBase, fontWeight: strong ? 600 : 400 }, tint(ratio)] as SxProps<Theme>}>
      <SignedPercent ratio={ratio} />
    </Box>
  );
}

function Detail({ month, headingId }: { month: HeatmapMonth; headingId: string }) {
  const entries: [string, string][] = [
    ["Startwert", formatMoney(month.startValue)],
    ["Endwert", formatMoney(month.endValue)],
    ["Rendite", percentText(month.return)],
    ["Externe Zuflüsse (netto)", formatMoney(month.netExternalFlows, { sign: true })],
    ["Transaktionen", String(month.transactions)],
  ];
  return (
    <Box component="section" aria-labelledby={headingId} sx={{ mt: 2 }}>
      <CardHeading id={headingId}>{`${monthLabel(month)}${month.running ? ` (${HEATMAP_RUNNING_LABEL})` : ""}`}</CardHeading>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
        {`${formatDate(month.from)} – ${formatDate(month.to)}`}
      </Typography>
      <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.5 }}>
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
    </Box>
  );
}

/**
 * "Rendite je Monat": years × months grid of monthly TTWRORs with chained quarter and year totals, tinted
 * green/red by sign (stronger with magnitude) and always showing the signed value. Tapping a month shows
 * its figures below; tapping it again closes them. The grid scrolls sideways inside the card.
 */
export function ReturnHeatmap({
  scope,
  years,
  heading = "Rendite je Monat",
  headingId = DEFAULT_HEADING_ID,
  granularityToggle = false,
  footer,
}: ReturnHeatmapProps) {
  const [selection, setSelection] = useState<{ scope: string; month: string } | null>(null);
  const [granularity, setGranularity] = useState<HeatmapGranularity>("M");
  const showMonths = !granularityToggle || granularity === "M";
  const showQuarters = !granularityToggle || granularity === "Q";
  const columns = [
    ...(showMonths ? HEATMAP_MONTH_LABELS : []),
    ...(showQuarters ? HEATMAP_QUARTER_LABELS : []),
    granularityToggle ? HEATMAP_TOTAL_LABEL : HEATMAP_YEAR_LABEL,
  ];
  const detailId = headingId === DEFAULT_HEADING_ID ? "heatmap-detail-heading" : `${headingId}-detail`;
  const selectedKey = selection?.scope === scope ? selection.month : null;
  const selected = years.flatMap((year) => year.months).find((month) => month !== null && month.month === selectedKey) ?? null;

  return (
    <Card component="section" aria-labelledby={headingId} sx={{ minWidth: 0 }}>
      <CardContent>
        {granularityToggle ? (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
            <CardHeading id={headingId}>{heading}</CardHeading>
            {years.length > 0 ? (
              <ToggleButtonGroup
                value={granularity}
                exclusive
                size="small"
                aria-label="Zeitraster"
                onChange={(_, next: HeatmapGranularity | null) => {
                  if (next === null) return;
                  setGranularity(next);
                  setSelection(null);
                }}
              >
                {HEATMAP_GRANULARITIES.map((value) => (
                  <ToggleButton
                    key={value}
                    value={value}
                    aria-label={value === "Q" ? "Q (Quartale)" : "M (Monate)"}
                    sx={{ minHeight: 44, minWidth: 44, px: 1.5, textTransform: "none" }}
                  >
                    {value}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            ) : null}
          </Box>
        ) : (
          <CardHeading id={headingId}>{heading}</CardHeading>
        )}
        {years.length === 0 ? (
          <Typography variant="body2">{HEATMAP_EMPTY_TEXT}</Typography>
        ) : (
          <>
            <Box sx={{ overflowX: "auto", maxWidth: "100%" }}>
              <Box component="table" aria-labelledby={headingId} sx={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <Box component="td" sx={{ ...headerCell, ...yearColumn }} />
                    {columns.map((label) => (
                      <Box component="th" scope="col" key={label} sx={headerCell}>
                        {label}
                      </Box>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {years.map((year) => (
                    <tr key={year.year}>
                      <Box component="th" scope="row" sx={{ ...headerCell, ...yearColumn, color: "text.primary", fontSize: 13 }}>
                        {year.year}
                      </Box>
                      {(showMonths ? year.months : []).map((month, index) =>
                        month === null ? (
                          <Box component="td" key={index} sx={cellBase} />
                        ) : (
                          <MonthCell
                            key={month.month}
                            month={month}
                            selected={month.month === selectedKey}
                            onToggle={() => setSelection(month.month === selectedKey ? null : { scope, month: month.month })}
                          />
                        ),
                      )}
                      {(showQuarters ? year.quarters : []).map((quarter, index) => (
                        <TotalCell key={`q${index}`} ratio={quarter} />
                      ))}
                      <TotalCell ratio={year.total} strong />
                    </tr>
                  ))}
                </tbody>
              </Box>
            </Box>
            {selected && showMonths ? <Detail month={selected} headingId={detailId} /> : null}
          </>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}
