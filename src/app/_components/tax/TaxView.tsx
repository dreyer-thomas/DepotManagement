"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useId, useState } from "react";
import { formatMoney } from "@/core/format";
import type { TaxBrokerResult, TaxFigures, TaxYear } from "@/core/tax";
import type { Broker } from "@/modules/ledger";
import { BROKER_LABELS } from "../depots/labels";
import { CardHeading } from "../overview/CardHeading";
import { ALLOWANCE_LIMIT_HINT, allowanceExceedsLimit, differenceAmount, differenceLabel, differenceText, lossMoney, signedMoney, TAX_SCOPE_HINT } from "./labels";

const CONTROL = { minHeight: 44 } as const;
const numeric = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

const brokerName = (broker: string) => BROKER_LABELS[broker as Broker] ?? broker;

/** One row of a broker card: label left, amount right; `indent` for the loss-offsetting details. */
function Line({ label, value, strong = false, indent = false }: { label: string; value: string; strong?: boolean; indent?: boolean }) {
  return (
    <Box component="div" role="row" sx={{ display: "flex", justifyContent: "space-between", gap: 2, py: 0.5, pl: indent ? 2 : 0 }}>
      <Typography component="span" role="rowheader" variant="body2" sx={{ fontWeight: strong ? 600 : 400 }}>
        {label}
      </Typography>
      {value === "" ? null : (
        <Typography component="span" role="cell" variant="body2" sx={{ ...numeric, fontWeight: strong ? 600 : 400 }}>
          {value}
        </Typography>
      )}
    </Box>
  );
}

/** The per-broker breakdown: income by pot, loss offsetting, allowance, tax and the withheld comparison. */
function BrokerCard({ id, title, figures }: { id: string; title: string; figures: TaxFigures }) {
  const headingId = `${id}-heading`;
  return (
    <Card component="section" aria-labelledby={headingId} sx={{ minWidth: 0 }}>
      <CardContent>
        <CardHeading id={headingId}>{title}</CardHeading>
        <Box role="table" aria-labelledby={headingId}>
          <Box role="rowgroup">
            <Line label="Dividenden und Zinsen" value={formatMoney(figures.dividends)} />
            <Line label="Aktien Gewinne / Verluste" value={`${signedMoney(figures.stockGains)} / ${lossMoney(figures.stockLosses)}`} />
            <Line label="Fonds/ETFs nach Teilfreistellung" value={signedMoney(figures.fund)} />
            <Line label="Sonstige Erträge" value={signedMoney(figures.other)} />
            <Line label="Verlustverrechnung" value="" strong />
            <Line label="mit Aktiengewinnen verrechnet" value={formatMoney(figures.offsetAgainstStock)} indent />
            <Line label="nicht verrechenbare Aktienverluste" value={formatMoney(figures.unusedStockLoss)} indent />
            <Line label="nicht verrechenbare sonstige Verluste" value={formatMoney(figures.unusedOtherLoss)} indent />
            <Line label="Steuerpflichtige Erträge" value={formatMoney(figures.taxable)} strong />
            <Line label="Freistellungsauftrag genutzt / verbleibend" value={`${formatMoney(figures.allowanceUsed)} / ${formatMoney(figures.allowanceLeft)}`} />
            <Line label="Kapitalertragsteuer 25 %" value={formatMoney(figures.capitalGainsTax)} />
            <Line label="Solidaritätszuschlag 5,5 %" value={formatMoney(figures.solidaritySurcharge)} />
            <Line label="Geschätzte Steuer" value={formatMoney(figures.estimated)} strong />
            <Line label="Einbehaltene Steuer (laut Buchungen)" value={signedMoney(figures.withheld)} />
            <Line label={differenceLabel(figures.difference)} value={differenceAmount(figures.difference)} strong />
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}

/**
 * Analysen › Steuern (story 8.3): a German capital-gains tax estimate per broker and year, from
 * `core/tax` `taxPreview`. The year is client state (default today's year). A summary table lists the
 * estimated, withheld tax and the difference per broker plus "Portfolio gesamt" (field-wise sum); one
 * card per broker shows the breakdown. Always labelled as an estimate, with the scope hint.
 */
export function TaxView({ years, today }: { years: readonly TaxYear[]; today: string }) {
  const ids = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [chosenYear, setChosenYear] = useState(today.slice(0, 4));
  const current = years.find((entry) => entry.year === chosenYear) ?? years[0];

  const rows: { key: string; name: string; figures: TaxFigures }[] = current
    ? [
        ...current.brokers.map((result: TaxBrokerResult) => ({ key: result.broker, name: brokerName(result.broker), figures: result as TaxFigures })),
        { key: "total", name: "Portfolio gesamt", figures: current.total },
      ]
    : [];

  return (
    <Stack spacing={2}>
      <TextField
        select
        size="small"
        label="Jahr"
        value={current?.year ?? chosenYear}
        onChange={(event) => setChosenYear(event.target.value)}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 140 }, "& .MuiInputBase-root": CONTROL }}
      >
        {years.map((entry) => (
          <MenuItem key={entry.year} value={entry.year} sx={CONTROL}>
            {entry.year}
          </MenuItem>
        ))}
      </TextField>

      <Alert severity="info">{TAX_SCOPE_HINT}</Alert>
      {current && allowanceExceedsLimit(current.allowanceSum) ? (
        <Alert severity="warning" role="status">
          {ALLOWANCE_LIMIT_HINT}
        </Alert>
      ) : null}

      <Card component="section" aria-labelledby={`${ids}-summary`} sx={{ minWidth: 0 }}>
        <CardContent>
          <CardHeading id={`${ids}-summary`}>{`Steuerschätzung ${current?.year ?? chosenYear}`}</CardHeading>
          {current && current.brokers.length > 0 ? (
            <Box sx={{ overflowX: "auto" }}>
              <Table size="small" aria-labelledby={`${ids}-summary`}>
                <TableHead>
                  <TableRow>
                    <TableCell>Broker</TableCell>
                    <TableCell sx={numeric}>Geschätzte Steuer</TableCell>
                    <TableCell sx={numeric}>Einbehalten</TableCell>
                    <TableCell sx={numeric}>Differenz</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const total = row.key === "total";
                    const strong = total ? { fontWeight: 600 } : {};
                    return (
                      <TableRow key={row.key}>
                        <TableCell component="th" scope="row" sx={strong}>
                          {row.name}
                        </TableCell>
                        <TableCell sx={{ ...numeric, ...strong }}>{formatMoney(row.figures.estimated)}</TableCell>
                        <TableCell sx={{ ...numeric, ...strong }}>{signedMoney(row.figures.withheld)}</TableCell>
                        <TableCell sx={{ ...numeric, ...strong }}>{differenceText(row.figures.difference)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          ) : (
            <Typography variant="body2">Noch kein Depot.</Typography>
          )}
        </CardContent>
      </Card>

      {rows
        .filter((row) => row.key !== "total")
        .map((row) => (
          <BrokerCard key={row.key} id={`${ids}-${row.key}`} title={`${row.name} – Schätzung ${current?.year}`} figures={row.figures} />
        ))}
    </Stack>
  );
}
