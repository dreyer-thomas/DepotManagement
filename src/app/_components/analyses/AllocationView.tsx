"use client";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useState } from "react";
import type { AllocationPosition } from "@/core/allocation";
import type { CompositionSegment } from "@/core/composition";
import { formatMoney, formatShare } from "@/core/format";
import { Donut, Legend, segmentColor } from "../composition/CompositionCard";
import { segmentColorKeys } from "../composition/labels";
import { CardHeading } from "../overview/CardHeading";
import { SecurityLink } from "../security-detail/SecurityLink";
import { SecurityLogo } from "../securities/SecurityLogo";
import { ALLOCATION_CASH_TEXT, ALLOCATION_EMPTY_TEXT, allocationAriaLabel, fundWeightLabel } from "./labels";

export type AllocationViewProps = {
  /** Scope value (`portfolio` or a Depot id); a change clears the selected segment. */
  scope: string;
  /** German label of the dimension, e.g. "Sektor"; a change clears the selected segment. */
  dimensionLabel: string;
  segments: readonly CompositionSegment[];
  positions: Readonly<Record<string, readonly AllocationPosition[]>>;
  /** Portfolio scope: each Position shows its Depot name. */
  showDepot: boolean;
};

function PositionRow({ position, showDepot }: { position: AllocationPosition; showDepot: boolean }) {
  return (
    <Box
      component="li"
      sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.125, minHeight: 44, borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}
    >
      <SecurityLogo securityId={position.securityId} name={position.securityName} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" component="span" sx={{ fontWeight: 500, overflowWrap: "anywhere" }}>
          <SecurityLink securityId={position.securityId} depotId={position.depotId}>
            {position.securityName}
          </SecurityLink>
        </Typography>
        {position.weight !== undefined ? (
          <Typography variant="caption" color="text.secondary" component="p">
            {fundWeightLabel(position.weight)}
          </Typography>
        ) : null}
        {showDepot ? (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ overflowWrap: "anywhere" }}>
            {position.depotName}
          </Typography>
        ) : null}
      </Box>
      <Stack spacing={0.25} sx={{ alignItems: "flex-end", flexShrink: 0, textAlign: "right" }}>
        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {formatMoney(position.value)}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
          {formatShare(position.share)}
        </Typography>
      </Stack>
    </Box>
  );
}

/**
 * "Aufteilung nach …": donut and legend of the allocation segments (from `core/allocation`). Tapping a
 * legend row selects its segment and lists its Positions below; tapping it again deselects.
 */
export function AllocationView({ scope, dimensionLabel, segments, positions, showDepot }: AllocationViewProps) {
  const theme = useTheme();
  const context = `${scope}\u0000${dimensionLabel}`;
  const [selection, setSelection] = useState<{ context: string; key: string } | null>(null);
  const colors = segmentColorKeys(segments).map((key) => segmentColor(theme, key));
  // Only a drawn (positive) segment of the current scope and dimension can be selected.
  const selectedKey = selection?.context === context ? selection.key : null;
  const selected = segments.find((s) => s.key === selectedKey && !s.amount.startsWith("-")) ?? null;
  const listed = selected ? (positions[selected.key] ?? []) : [];

  return (
    <Card component="section" aria-labelledby="allocation-heading" sx={{ minWidth: 0 }}>
      <CardContent>
        <CardHeading id="allocation-heading">{`Aufteilung nach ${dimensionLabel}`}</CardHeading>
        {segments.length === 0 ? (
          <Typography variant="body2">{ALLOCATION_EMPTY_TEXT}</Typography>
        ) : (
          <>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { xs: "center", sm: "flex-start" } }}>
              <Donut
                segments={segments}
                colors={colors}
                highlighted={selected?.key ?? null}
                label={allocationAriaLabel(dimensionLabel, segments)}
              />
              <Legend
                segments={segments}
                colors={colors}
                highlighted={selected?.key ?? null}
                onToggle={(key) => setSelection(selected?.key === key ? null : { context, key })}
              />
            </Stack>
            {selected ? (
              <Box component="section" aria-labelledby="allocation-positions-heading" sx={{ mt: 2 }}>
                <CardHeading id="allocation-positions-heading">{selected.label}</CardHeading>
                {selected.kind === "cash" ? (
                  <Typography variant="body2">{ALLOCATION_CASH_TEXT}</Typography>
                ) : (
                  <Box component="ul" aria-label={`Positionen: ${selected.label}`} sx={{ listStyle: "none", m: 0, p: 0 }}>
                    {listed.map((position) => (
                      <PositionRow key={`${position.depotId}\u0000${position.securityId}`} position={position} showDepot={showDepot} />
                    ))}
                  </Box>
                )}
              </Box>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
