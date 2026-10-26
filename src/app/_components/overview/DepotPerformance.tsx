"use client";

import ArrowDownward from "@mui/icons-material/ArrowDownward";
import ArrowUpward from "@mui/icons-material/ArrowUpward";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import MuiLink from "@mui/material/Link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import NextLink from "next/link";
import { formatMoney, formatPercent } from "@/core/format";
import { GainLossPill } from "../positions/GainLossPill";
import { ratioTone } from "./labels";
import { CardHeading } from "./CardHeading";

/** One Depot's Period figures as the Depots card shows them (decimal strings; ratios `null` when unknown). */
export type DepotPerformanceRow = {
  id: string;
  name: string;
  value: string;
  gain: string;
  ttwror: string | null;
  xirr: string | null;
};

const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

const depotHref = (id: string) => `/depots/${encodeURIComponent(id)}`;

/** A return ratio: signed percentage with arrow and gain/loss color (never color alone), "–" without one. */
export function ReturnValue({ ratio }: { ratio: string | null }) {
  if (ratio === null) return <span>–</span>;
  const tone = ratioTone(ratio);
  const Arrow = tone === "loss" ? ArrowDownward : ArrowUpward;
  return (
    <Box
      component="span"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, color: tone ? `${tone}.main` : "text.secondary", fontVariantNumeric: "tabular-nums" }}
    >
      {tone ? <Arrow aria-hidden sx={{ fontSize: 14 }} /> : null}
      {formatPercent(ratio)}
    </Box>
  );
}

/**
 * "Depots" card: per Depot value, Period Gain/Loss, TTWROR and XIRR. From `lg` a table whose name link
 * covers the row; below `lg` (incl. the narrow md column beside Nachrichten) one stacked link row per Depot. Each row opens the Depot detail page.
 */
export function DepotPerformance({ rows, periodLabel }: { rows: readonly DepotPerformanceRow[]; periodLabel: string }) {
  return (
    <Card component="section" aria-labelledby="overview-depots" sx={{ minWidth: 0 }}>
      <CardContent>
        <CardHeading id="overview-depots">Depots</CardHeading>
        <Table size="small" aria-labelledby="overview-depots" sx={{ display: { xs: "none", lg: "table" } }}>
          <TableHead>
            <TableRow>
              <TableCell>Depot</TableCell>
              <TableCell sx={numeric}>Wert</TableCell>
              <TableCell sx={numeric}>G/V · {periodLabel}</TableCell>
              <TableCell sx={numeric}>TTWROR</TableCell>
              <TableCell sx={numeric}>XIRR</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                hover
                sx={{ position: "relative", cursor: "pointer", "&:focus-within": { bgcolor: "action.hover" } }}
              >
                <TableCell sx={{ height: 44 }}>
                  <MuiLink
                    component={NextLink}
                    href={depotHref(row.id)}
                    color="inherit"
                    underline="hover"
                    sx={{
                      fontWeight: 500,
                      // The link's hit area covers the whole row.
                      "&::after": { content: '""', position: "absolute", inset: 0 },
                      "&:focus-visible": { outline: "none" },
                      "&:focus-visible::after": { outline: 2, outlineStyle: "solid", outlineColor: "primary.main", outlineOffset: -2 },
                    }}
                  >
                    {row.name}
                  </MuiLink>
                </TableCell>
                <TableCell sx={numeric}>{formatMoney(row.value)}</TableCell>
                <TableCell sx={numeric}>
                  <GainLossPill gain={row.gain} ratio={null} />
                </TableCell>
                <TableCell sx={numeric}>
                  <ReturnValue ratio={row.ttwror} />
                </TableCell>
                <TableCell sx={numeric}>
                  <ReturnValue ratio={row.xirr} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <Box component="ul" aria-label="Depots" sx={{ display: { xs: "block", lg: "none" }, listStyle: "none", m: 0, p: 0 }}>
          {rows.map((row) => (
            <Box component="li" key={row.id} sx={{ borderBottom: 1, borderColor: "divider", "&:last-child": { borderBottom: 0 } }}>
              <MuiLink
                component={NextLink}
                href={depotHref(row.id)}
                color="inherit"
                underline="none"
                sx={{ display: "block", minHeight: 44, py: 1.25 }}
              >
                <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1.5, alignItems: "baseline" }}>
                  <Typography component="span" variant="body2" sx={{ fontWeight: 600, overflowWrap: "anywhere", minWidth: 0 }}>
                    {row.name}
                  </Typography>
                  <Typography component="span" variant="body2" sx={{ ...numeric, fontWeight: 600 }}>
                    {formatMoney(row.value)}
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 1, rowGap: 0.5, mt: 0.5 }}>
                  <GainLossPill gain={row.gain} ratio={null} />
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                    TTWROR <ReturnValue ratio={row.ttwror} /> · XIRR <ReturnValue ratio={row.xirr} />
                  </Typography>
                </Box>
              </MuiLink>
            </Box>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
