"use client";

import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { DepotLink } from "@/app/_components/depots/DepotLink";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { Figure, MigrationSummary } from "@/modules/migration";
import { comparisonStatus } from "./labels";
import { OpeningBalanceForm } from "./OpeningBalanceForm";

const NUMERIC = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

function Scroll({ children }: { children: ReactNode }) {
  return <Box sx={{ overflowX: "auto" }}>{children}</Box>;
}

/** "Abweichung" with an icon, or "gleich" — never color alone. */
function Status({ mismatch }: { mismatch: boolean }) {
  if (!mismatch) {
    return (
      <Typography variant="body2" component="span" color="text.secondary">
        {comparisonStatus(false)}
      </Typography>
    );
  }
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, color: "warning.main", whiteSpace: "nowrap" }}>
      <WarningAmberOutlined fontSize="small" aria-hidden />
      <Typography variant="body2" component="span" sx={{ fontWeight: 600 }}>
        {comparisonStatus(true)}
      </Typography>
    </Box>
  );
}

function FigureRow({ label, figure, format }: { label: string; figure: Figure; format: (value: string) => string }) {
  return (
    <TableRow>
      <TableCell>{label}</TableCell>
      <TableCell align="right" sx={NUMERIC}>
        {format(figure.ledger)}
      </TableCell>
      <TableCell align="right" sx={NUMERIC}>
        {format(figure.file)}
      </TableCell>
      <TableCell>
        <Status mismatch={figure.mismatch} />
      </TableCell>
    </TableRow>
  );
}

function Head({ first }: { first: string }) {
  return (
    <TableHead>
      <TableRow>
        <TableCell>{first}</TableCell>
        <TableCell align="right">Depot</TableCell>
        <TableCell align="right">Parqet</TableCell>
        <TableCell>Abgleich</TableCell>
      </TableRow>
    </TableHead>
  );
}

const money = (value: string) => formatMoney(value);

/** The result of "Übernehmen": what was booked or skipped and the ledger compared with Parqet at export date. */
export function ParqetSummaryView({ summary }: { summary: MigrationSummary }) {
  const { booked, skipped, comparison } = summary;
  const mismatches = comparison
    ? comparison.positions.filter((p) => p.mismatch).length +
      comparison.sales.filter((s) => s.gain.mismatch).length +
      (comparison.investedCapital.mismatch ? 1 : 0) +
      (comparison.cash?.mismatch ? 1 : 0)
    : 0;
  return (
    <Box component="section" aria-labelledby="parqet-summary-title" sx={{ mt: 3 }}>
      <Typography id="parqet-summary-title" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
        Übernommen – {summary.depot.name}
      </Typography>
      <Alert severity="success" role="status">
        Gebucht: {booked.transactions} Buchungen, {booked.isinChanges} ISIN-Wechsel, {booked.securities} neue Wertpapiere.
        Übersprungen: {skipped.duplicates} Doppelbuchungen, {skipped.flags} markierte Zeilen, {skipped.isinChanges} bereits
        erfasste ISIN-Wechsel.
      </Alert>
      <Typography variant="body2" sx={{ mt: 1 }}>
        <DepotLink id={summary.depot.id}>Zum Depot {summary.depot.name}</DepotLink>
      </Typography>

      {comparison && summary.exportDate ? (
        <Box component="section" aria-labelledby="parqet-reconcile-title" sx={{ mt: 3 }}>
          <Typography id="parqet-reconcile-title" component="h3" variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            Abgleich mit Parqet am {formatDate(summary.exportDate)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {mismatches === 0 ? "Keine Abweichung über 0,01 €." : `${mismatches} × Abweichung über 0,01 € (Stück: jede Abweichung).`}
          </Typography>

          {comparison.positions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Keine offenen Positionen.
            </Typography>
          ) : (
            <Scroll>
              <Table size="small" aria-label="Positionen im Abgleich">
                <TableHead>
                  <TableRow>
                    <TableCell>Wertpapier</TableCell>
                    <TableCell align="right">Stück Depot</TableCell>
                    <TableCell align="right">Stück Parqet</TableCell>
                    <TableCell align="right">Einstand Depot</TableCell>
                    <TableCell align="right">Einstand Parqet</TableCell>
                    <TableCell>Abgleich</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {comparison.positions.map((position) => (
                    <TableRow key={position.key}>
                      <TableCell>{position.name}</TableCell>
                      <TableCell align="right" sx={NUMERIC}>
                        {formatQuantity(position.quantity.ledger)}
                      </TableCell>
                      <TableCell align="right" sx={NUMERIC}>
                        {formatQuantity(position.quantity.file)}
                      </TableCell>
                      <TableCell align="right" sx={NUMERIC}>
                        {formatMoney(position.costBasis.ledger)}
                      </TableCell>
                      <TableCell align="right" sx={NUMERIC}>
                        {formatMoney(position.costBasis.file)}
                      </TableCell>
                      <TableCell>
                        <Status mismatch={position.mismatch} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Scroll>
          )}

          <Box sx={{ mt: 2 }}>
            <Scroll>
              <Table size="small" aria-label="Summen im Abgleich">
                <Head first="Summe" />
                <TableBody>
                  <FigureRow label="Investiertes Kapital" figure={comparison.investedCapital} format={money} />
                  {comparison.cash ? <FigureRow label="Verrechnungskonto" figure={comparison.cash} format={money} /> : null}
                </TableBody>
              </Table>
            </Scroll>
          </Box>
          {comparison.cash ? null : (
            <Alert severity="info" sx={{ mt: 2 }}>
              Verrechnungskonto nicht abgeglichen: Die Datei enthält keine Barbuchungen.
            </Alert>
          )}
          {summary.openingBalance ? <OpeningBalanceForm depotId={summary.depot.id} offer={summary.openingBalance} /> : null}

          <Typography component="h4" variant="subtitle2" sx={{ fontWeight: 600, mt: 3, mb: 1 }}>
            Realisierter Gewinn/Verlust je Verkauf
          </Typography>
          {comparison.sales.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Keine Verkäufe mit Parqet-Wert zum Vergleich.
            </Typography>
          ) : (
            <Scroll>
              <Table size="small" aria-label="Verkäufe im Abgleich">
                <Head first="Verkauf" />
                <TableBody>
                  {comparison.sales.map((sale) => (
                    <FigureRow key={sale.key} label={`${formatDate(sale.date)} ${sale.name}`} figure={sale.gain} format={money} />
                  ))}
                </TableBody>
              </Table>
            </Scroll>
          )}
        </Box>
      ) : null}
    </Box>
  );
}
