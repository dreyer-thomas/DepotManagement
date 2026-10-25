"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, type ReactNode, startTransition, useActionState, useState } from "react";
import { previewParqetAction, type PreviewParqetActionState } from "@/app/_actions/migration";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { ParqetPreview } from "@/modules/migration";
import { countRows, flagReasonLabel, previewFailureMessage, recordsLabel, securityTypeLabel } from "./labels";

const TOUCH_TARGET = { minHeight: 44 };
const NUMERIC = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;

export type WizardDepot = { id: string; name: string };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Box component="section" aria-labelledby={id} sx={{ mt: 3 }}>
      <Typography id={id} component="h3" variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** Tables scroll inside their own box at phone width; the page never scrolls sideways. */
function Scroll({ children }: { children: ReactNode }) {
  return <Box sx={{ overflowX: "auto" }}>{children}</Box>;
}

/** The read-only preview of a Parqet export (counts, ISIN changes, flags, Securities, figures). */
export function ParqetPreviewView({ preview }: { preview: ParqetPreview }) {
  const nameOf = new Map(preview.securities.map((security) => [security.key, security.name]));
  const securityLabel = (key: string) => `${nameOf.get(key) ?? key} (${key})`;
  const title = preview.exportDate
    ? `Vorschau – ${preview.depot.name}, Stand ${formatDate(preview.exportDate)}`
    : `Vorschau – ${preview.depot.name}`;
  return (
    <Box component="section" aria-labelledby="parqet-preview-title" sx={{ mt: 3 }}>
      <Typography id="parqet-preview-title" component="h2" variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
        {title}
      </Typography>
      <Alert severity="info">Es wurde noch nichts gebucht.</Alert>
      {preview.adjustedCount > 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Rundung angeglichen: {preview.adjustedCount}
        </Typography>
      ) : null}

      <Section id="parqet-counts" title="Buchungen">
        <Scroll>
          <Table size="small" aria-labelledby="parqet-counts">
            <TableHead>
              <TableRow>
                <TableCell>Buchungsart</TableCell>
                <TableCell align="right">Anzahl</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {countRows(preview.counts).map((row) => (
                <TableRow key={row.type}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell align="right" sx={NUMERIC}>
                    {row.count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Scroll>
      </Section>

      <Section id="parqet-isin-changes" title="ISIN-Wechsel">
        {preview.isinChanges.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine ISIN-Wechsel erkannt.
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {preview.isinChanges.map((change) => (
              <li key={change.records.join("-")}>
                <Typography variant="body2" component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatDate(change.date)}: {securityLabel(change.oldKey)} → {securityLabel(change.newKey)},{" "}
                  {formatQuantity(change.oldQuantity)} : {formatQuantity(change.newQuantity)}
                </Typography>
              </li>
            ))}
          </Box>
        )}
      </Section>

      <Section id="parqet-flagged" title="Markierte Zeilen">
        {preview.flagged.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine markierten Zeilen.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Diese Zeilen werden nicht gebucht und fließen in keine Zahl ein.
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {preview.flagged.map((flag) => (
                <li key={flag.records.join("-")}>
                  <Typography variant="body2" component="span">
                    {recordsLabel(flag.records)} – {flagReasonLabel(flag)}
                  </Typography>
                </li>
              ))}
            </Box>
          </>
        )}
      </Section>

      <Section id="parqet-securities" title="Wertpapiere">
        {preview.securities.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Wertpapiere.
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {preview.securities.map((security) => (
              <Box
                component="li"
                key={security.key}
                sx={{ py: 1, borderBottom: 1, borderColor: "divider", display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}
              >
                <Box sx={{ flex: 1, minWidth: 160 }}>
                  <Typography variant="body2">{security.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {security.key}
                    {security.existing ? " · bereits vorhanden" : ""}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  label={securityTypeLabel(security.assetType)}
                  color={security.assetType === "UNCLASSIFIED" ? "warning" : "default"}
                  variant="outlined"
                />
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <Section id="parqet-result" title={preview.exportDate ? `Ergebnis laut Datei am ${formatDate(preview.exportDate)}` : "Ergebnis laut Datei"}>
        {preview.figures ? (
          <>
            {preview.figures.positions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Keine offenen Positionen.
              </Typography>
            ) : (
              <Scroll>
                <Table size="small" aria-label="Positionen">
                  <TableHead>
                    <TableRow>
                      <TableCell>Wertpapier</TableCell>
                      <TableCell align="right">Stück</TableCell>
                      <TableCell align="right">Einstand</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {preview.figures.positions.map((position) => (
                      <TableRow key={position.securityKey}>
                        <TableCell>{position.name}</TableCell>
                        <TableCell align="right" sx={NUMERIC}>
                          {formatQuantity(position.quantity)}
                        </TableCell>
                        <TableCell align="right" sx={NUMERIC}>
                          {formatMoney(position.costBasis)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Scroll>
            )}
            <Box component="dl" sx={{ display: "grid", gridTemplateColumns: "auto auto", columnGap: 2, rowGap: 0.5, mt: 2, mb: 0 }}>
              <Typography component="dt" variant="body2">
                Investiertes Kapital
              </Typography>
              <Typography component="dd" variant="body2" sx={{ ...NUMERIC, m: 0, textAlign: "right" }}>
                {formatMoney(preview.figures.investedCapital)}
              </Typography>
              <Typography component="dt" variant="body2">
                Verrechnungskonto
              </Typography>
              <Typography component="dd" variant="body2" sx={{ ...NUMERIC, m: 0, textAlign: "right" }}>
                {formatMoney(preview.figures.cashBalance)}
              </Typography>
            </Box>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Keine Zahlen: Die Datei enthält keine datierte Zeile.
          </Typography>
        )}
      </Section>
    </Box>
  );
}

/**
 * "Aus Parqet übernehmen" wizard, step 1: pick a Parqet CSV and the target Depot, then show the read-only
 * preview. Booking (and classifying Securities) follows in story 2.4.
 */
export function ParqetMigrationWizard({ depots }: { depots: WizardDepot[] }) {
  const [depotId, setDepotId] = useState(depots[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [state, formAction, pending] = useActionState<PreviewParqetActionState, FormData>(previewParqetAction, null);

  // Submit manually so the chosen file stays selected after the preview (React resets action forms).
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  };

  const failure = state && !state.ok ? state : undefined;

  return (
    <>
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Lade den CSV-Export eines Parqet-Portfolios hoch und wähle das Ziel-Depot. Die Vorschau zeigt, was gebucht
            würde – gebucht wird noch nichts.
          </Typography>
          <form onSubmit={submit} noValidate aria-label="Parqet-Export prüfen">
            <Stack spacing={2}>
              {failure ? (
                <Alert severity="error" role="alert">
                  {previewFailureMessage(failure)}
                </Alert>
              ) : null}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
                <Button component="label" variant="outlined" sx={TOUCH_TARGET}>
                  CSV-Datei wählen
                  <input
                    type="file"
                    name="file"
                    accept=".csv,text/csv"
                    hidden
                    onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
                  />
                </Button>
                <Typography variant="body2" color={fileName ? "text.primary" : "text.secondary"} sx={{ wordBreak: "break-all" }}>
                  {fileName || "Keine Datei gewählt"}
                </Typography>
              </Stack>
              <TextField
                select
                name="depotId"
                label="Ziel-Depot"
                value={depotId}
                onChange={(event) => setDepotId(event.target.value)}
                fullWidth
                slotProps={{ select: { native: true } }}
              >
                {depots.map((depot) => (
                  <option key={depot.id} value={depot.id}>
                    {depot.name}
                  </option>
                ))}
              </TextField>
              <Box>
                <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
                  {pending ? "Wird gelesen …" : "Vorschau anzeigen"}
                </Button>
              </Box>
            </Stack>
          </form>
        </CardContent>
      </Card>
      {state?.ok ? <ParqetPreviewView preview={state.preview} /> : null}
    </>
  );
}
