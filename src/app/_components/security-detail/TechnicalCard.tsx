"use client";

import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import {
  DEFAULT_TECHNICAL_INDICATOR,
  parseTechnicalIndicator,
  storeChartPreference,
  TECHNICAL_INDICATOR_COOKIE,
  TECHNICAL_INDICATORS,
  type TechnicalIndicator,
} from "@/app/_components/charts/chart-preference";
import type { TechnicalSeriesPoint } from "@/core/technical";
import { CollapsibleCard } from "./CollapsibleCard";
import { TechnicalChart } from "./TechnicalChart";
import {
  hasIndicatorValues,
  INSUFFICIENT_TEXT,
  NO_SERIES_TEXT,
  TECHNICAL_INDICATOR_LABELS,
  type TechnicalRow,
  type TechnicalSignals,
  technicalRows,
  technicalSourceLine,
} from "./technical-labels";

const TOGGLE_SX = { minHeight: 44, minWidth: 44, px: 1.5, textTransform: "none" } as const;

/** Interpretation as a pill; the tone (soft background, main text colour) is only a secondary cue. */
function LabelPill({ row }: { row: TechnicalRow }) {
  return (
    <Box
      component="span"
      data-tone={row.tone ?? "none"}
      sx={{
        display: "inline-flex",
        px: 1,
        py: 0.25,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...(row.tone ? { bgcolor: `${row.tone}.soft`, color: `${row.tone}.main` } : { color: "text.primary" }),
      }}
    >
      {row.label}
    </Box>
  );
}

/** One row per signal: "Signal · Wert · Einordnung" (narrow screens: value on its own line). */
function SignalRows({ rows }: { rows: TechnicalRow[] }) {
  return (
    <Box component="dl" sx={{ m: 0, mt: 1, maxWidth: 640 }}>
      {rows.map((row) => (
        <Box
          key={row.signal}
          data-signal={row.signal}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr auto", sm: "6rem 1fr auto" },
            columnGap: 2,
            alignItems: "center",
            py: 0.5,
          }}
        >
          <Typography component="dt" variant="body2" sx={{ m: 0, fontWeight: 600 }}>
            {row.signal}
          </Typography>
          {row.value === null ? (
            <Typography
              component="dd"
              variant="body2"
              color="text.secondary"
              sx={{ m: 0, gridColumn: { xs: "1 / -1", sm: "2 / -1" }, gridRow: { xs: 2, sm: 1 } }}
            >
              {INSUFFICIENT_TEXT}
            </Typography>
          ) : (
            <>
              <Typography
                component="dd"
                variant="figure"
                sx={{ m: 0, gridColumn: { xs: "1 / -1", sm: 2 }, gridRow: { xs: 2, sm: 1 }, overflowWrap: "anywhere" }}
              >
                {row.value}
              </Typography>
              <Box component="dd" sx={{ m: 0, gridColumn: { xs: 2, sm: 3 }, gridRow: 1, justifySelf: "end" }}>
                <LabelPill row={row} />
              </Box>
            </>
          )}
        </Box>
      ))}
    </Box>
  );
}

function SourceText({ asOf }: { asOf: string }) {
  return (
    <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
      {technicalSourceLine(asOf)}
    </Typography>
  );
}

/**
 * Card "Technische Lage" (story 11.3, both detail layouts, after "Kennzahlen"): closed (default) the source
 * line and one row per signal (Trend, RSI, MACD, TSI, 52 Wochen) as "Signal · Wert · Einordnung"; opened
 * also the indicator chart with the toggle TSI · RSI · MACD over the page Period (choice stored in the
 * `dm_technical_indicator` cookie, never a reload). Without any close only "zu wenig Kursdaten". Computes
 * nothing: values and interpretations come from `technicalPosition` (AD-23); no combined verdict.
 */
export function TechnicalCard({
  position,
  series,
  asOf,
  from,
  to,
  initialIndicator,
}: {
  /** The five signals of `technicalPosition`. */
  position: TechnicalSignals;
  /** The indicator series points dated `from..to`. */
  series: readonly TechnicalSeriesPoint[];
  /** Date of the last close; `null` without any close. */
  asOf: string | null;
  /** The page Period. */
  from: string;
  to: string;
  /** The stored indicator (cookie) for the first render; default TSI. */
  initialIndicator?: TechnicalIndicator;
}) {
  const [indicator, setIndicator] = useState<TechnicalIndicator>(initialIndicator ?? DEFAULT_TECHNICAL_INDICATOR);
  if (asOf === null) {
    const empty = (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {INSUFFICIENT_TEXT}
      </Typography>
    );
    return <CollapsibleCard id="security-technical" heading="Technische Lage" collapsed={empty} expanded={empty} />;
  }
  const rows = <SignalRows rows={technicalRows(position)} />;
  return (
    <CollapsibleCard
      id="security-technical"
      heading="Technische Lage"
      collapsed={
        <>
          <SourceText asOf={asOf} />
          {rows}
        </>
      }
      expanded={
        <>
          <SourceText asOf={asOf} />
          {rows}
          <ToggleButtonGroup
            exclusive
            size="small"
            value={indicator}
            aria-label="Indikator"
            onChange={(_, value: string | null) => {
              if (value === null) return;
              const next = parseTechnicalIndicator(value);
              setIndicator(next);
              storeChartPreference(TECHNICAL_INDICATOR_COOKIE, next);
            }}
            sx={{ mt: 2 }}
          >
            {TECHNICAL_INDICATORS.map((value) => (
              <ToggleButton key={value} value={value} sx={TOGGLE_SX}>
                {TECHNICAL_INDICATOR_LABELS[value]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {hasIndicatorValues(series, indicator) ? (
            <TechnicalChart indicator={indicator} points={series} from={from} to={to} />
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
              {NO_SERIES_TEXT}
            </Typography>
          )}
        </>
      }
    />
  );
}
