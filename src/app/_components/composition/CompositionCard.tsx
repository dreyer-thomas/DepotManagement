"use client";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { type Theme, useTheme } from "@mui/material/styles";
import { useState } from "react";
import type { CompositionSegment } from "@/core/composition";
import { formatMoney, formatShare } from "@/core/format";
import { CardHeading } from "../overview/CardHeading";
import {
  COMPOSITION_DEFAULT_VIEW,
  COMPOSITION_EMPTY_TEXT,
  COMPOSITION_VIEW_LABELS,
  type CompositionView,
  type SegmentColorKey,
  compositionAriaLabel,
  segmentColorKeys,
} from "./labels";

export type CompositionViewData = { view: CompositionView; segments: readonly CompositionSegment[] };

export type CompositionCardProps = {
  /** The breakdowns in toggle order (Overview: Position, Typ, Depot; Depot detail: Position, Typ). */
  views: readonly CompositionViewData[];
  /** Id of the card heading that labels the section. */
  headingId?: string;
};

/** Radius of a circle with circumference 100, so dash lengths are percentages. */
const RADIUS = 50 / Math.PI;
const STROKE = 6;
const STROKE_HIGHLIGHTED = 8;

/** SVG geometry rounded to 4 decimals (keeps float noise out of the markup). */
const geometry = (value: number) => Number(value.toFixed(4));

/** Segment colors as theme CSS variables (dark mode follows); plain palette fallbacks for a bare render. */
export function segmentColor(theme: Theme, key: SegmentColorKey): string {
  const palette = (theme.vars ?? theme).palette;
  if (key === "cash") return palette.cash?.main ?? palette.grey[400];
  return palette.chart?.[key] ?? palette.primary.main;
}

/** Donut ring of the positive segments; negative ones (negative cash) are listed but not drawn. */
export function Donut({
  segments,
  colors,
  highlighted,
  label,
}: {
  segments: readonly CompositionSegment[];
  colors: readonly string[];
  highlighted: string | null;
  label: string;
}) {
  // Presentation edge: the only number conversion. Negative segments (negative cash) are not drawn;
  // the drawn ring spans the positive segments.
  const drawn = segments.flatMap((segment, index) => {
    const share = Number(segment.share);
    return share > 0 ? [{ segment, color: colors[index], share }] : [];
  });
  const positive = drawn.reduce((sum, entry) => sum + entry.share, 0);
  const lengths = drawn.map((entry) => (entry.share / positive) * 100);
  // Each segment starts where the previous ones end, measured from 12 o'clock.
  const starts = lengths.map((_, index) => lengths.slice(0, index).reduce((sum, length) => sum + length, 0));
  return (
    <Box component="svg" viewBox="0 0 42 42" role="img" aria-label={label} sx={{ width: 132, height: 132, flexShrink: 0 }}>
      {drawn.map(({ segment, color }, index) => {
        const length = lengths[index];
        const offset = 25 - starts[index];
        const isHighlighted = highlighted === segment.key;
        const dimmed = highlighted !== null && !isHighlighted;
        return (
          <circle
            key={segment.key}
            data-segment={segment.key}
            data-highlighted={isHighlighted ? "true" : undefined}
            cx="21"
            cy="21"
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={isHighlighted ? STROKE_HIGHLIGHTED : STROKE}
            strokeOpacity={dimmed ? 0.35 : 1}
            strokeDasharray={`${geometry(length)} ${geometry(100 - length)}`}
            strokeDashoffset={geometry(offset)}
          />
        );
      })}
    </Box>
  );
}

/** Legend rows (label, display share, amount); tapping a row toggles its segment. */
export function Legend({
  segments,
  colors,
  highlighted,
  onToggle,
}: {
  segments: readonly CompositionSegment[];
  colors: readonly string[];
  highlighted: string | null;
  onToggle: (key: string) => void;
}) {
  return (
    <Box component="ul" aria-label="Legende" sx={{ listStyle: "none", m: 0, p: 0, flex: 1, minWidth: 0, width: "100%" }}>
      {segments.map((segment, index) => {
        const pressed = highlighted === segment.key;
        return (
          <li key={segment.key}>
            <ButtonBase
              aria-pressed={pressed}
              onClick={() => onToggle(segment.key)}
              sx={{
                width: "100%",
                minHeight: 44,
                px: 1,
                gap: 1,
                justifyContent: "flex-start",
                textAlign: "left",
                borderRadius: 1,
                bgcolor: pressed ? "action.selected" : undefined,
                "&:hover": { bgcolor: pressed ? "action.selected" : "action.hover" },
                "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: -2 },
              }}
            >
              <Box
                component="span"
                aria-hidden="true"
                data-swatch
                sx={{ width: 10, height: 10, borderRadius: "3px", flexShrink: 0, bgcolor: colors[index] }}
              />
              <Typography component="span" variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {segment.label}
              </Typography>
              <Typography component="span" variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {formatShare(segment.displayShare)}
              </Typography>
              <Typography
                component="span"
                variant="body2"
                color="text.secondary"
                sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", minWidth: 88, textAlign: "right" }}
              >
                {formatMoney(segment.amount)}
              </Typography>
            </ButtonBase>
          </li>
        );
      })}
    </Box>
  );
}

/**
 * "Zusammensetzung": donut with legend and a view toggle. Segments come ready from `core/composition`;
 * the card only draws them. Tapping a legend row highlights its segment; switching the view clears it.
 */
export function CompositionCard({ views, headingId = "composition-heading" }: CompositionCardProps) {
  const theme = useTheme();
  const initial = views.some((v) => v.view === COMPOSITION_DEFAULT_VIEW) ? COMPOSITION_DEFAULT_VIEW : views[0]?.view;
  const [view, setView] = useState<CompositionView | undefined>(initial);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const current = views.find((v) => v.view === view) ?? views[0];
  const segments = current?.segments ?? [];
  const empty = views.every((v) => v.segments.length === 0);
  const colors = segmentColorKeys(segments).map((key) => segmentColor(theme, key));
  // Only a drawn (positive) segment of the current view can be highlighted; a stale or negative key is ignored.
  const active = segments.some((s) => s.key === highlighted && !s.amount.startsWith("-")) ? highlighted : null;

  return (
    <Card component="section" aria-labelledby={headingId} sx={{ minWidth: 0 }}>
      <CardContent>
        <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", columnGap: 1, rowGap: 0.5, mb: 1 }}>
          <CardHeading id={headingId}>Zusammensetzung</CardHeading>
          {empty || views.length < 2 ? null : (
            <ToggleButtonGroup
              value={current?.view}
              exclusive
              size="small"
              aria-label="Aufteilung"
              onChange={(_, next: CompositionView | null) => {
                if (next === null || next === current?.view) return;
                setView(next);
                setHighlighted(null);
              }}
            >
              {views.map((v) => (
                <ToggleButton key={v.view} value={v.view} sx={{ minHeight: 44, minWidth: 44, px: 1.5, textTransform: "none" }}>
                  {COMPOSITION_VIEW_LABELS[v.view]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
        </Stack>
        {segments.length === 0 || !current ? (
          <Typography variant="body2">{COMPOSITION_EMPTY_TEXT}</Typography>
        ) : (
          <Stack
            direction={{ xs: "column", sm: "row", md: "column", lg: "row" }}
            spacing={2}
            sx={{ alignItems: { xs: "center", sm: "flex-start", md: "center", lg: "flex-start" } }}
          >
            <Donut
              segments={segments}
              colors={colors}
              highlighted={active}
              label={compositionAriaLabel(COMPOSITION_VIEW_LABELS[current.view], segments)}
            />
            <Legend
              segments={segments}
              colors={colors}
              highlighted={active}
              onToggle={(key) => setHighlighted(active === key ? null : key)}
            />
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
