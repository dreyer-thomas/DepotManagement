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
import { type FormEvent, type ReactNode, useState, useTransition } from "react";
import { confirmParqetAction, previewParqetAction } from "@/app/_actions/migration";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { MigrationSummary, ParqetPreview, PreviewSecurity } from "@/modules/migration";
import {
  carryDecisions,
  type ClassificationType,
  EMPTY_DECISIONS,
  initialDecisions,
  type MigrationDecisions,
  openDecisions,
  submittedDecisions,
} from "@/modules/migration/decisions";
import {
  ACTION_FAILED_MESSAGE,
  CLASSIFICATION_OPTIONS,
  confirmFailureMessage,
  countRows,
  fundingNote,
  openDecisionsLabel,
  previewFailureMessage,
  securityTypeLabel,
} from "./labels";
import { ParqetDecisions } from "./ParqetDecisions";
import { ParqetSummaryView } from "./ParqetSummaryView";

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

type Classification = {
  decisions: MigrationDecisions;
  onChange: (decisions: MigrationDecisions) => void;
  disabled?: boolean;
};

/** A new ISIN Security's estimated type as an inline select (an override is a classification decision). */
function TypeSelect({ security, classification }: { security: PreviewSecurity; classification?: Classification }) {
  const value = classification?.decisions.classifications[security.key] ?? security.assetType;
  return (
    <TextField
      select
      size="small"
      label="Art (geschätzt)"
      value={value}
      disabled={!classification || classification.disabled}
      onChange={(event) => {
        if (!classification) return;
        const { decisions, onChange } = classification;
        const rest = { ...decisions.classifications };
        delete rest[security.key];
        const next = event.target.value as ClassificationType;
        onChange({ ...decisions, classifications: next === security.assetType ? rest : { ...rest, [security.key]: next } });
      }}
      slotProps={{ select: { native: true }, htmlInput: { "aria-label": `Art von ${security.name}` } }}
      sx={{ minWidth: 160 }}
    >
      {CLASSIFICATION_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </TextField>
  );
}

/**
 * The preview of a Parqet export (counts, splits, ISIN changes, deliveries, Securities, figures). Each
 * new ISIN Security shows its estimated type as an inline select, editable with `classification`.
 */
export function ParqetPreviewView({ preview, classification }: { preview: ParqetPreview; classification?: Classification }) {
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

      <Section id="parqet-splits" title="Splits">
        {preview.splits.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Splits erkannt.
          </Typography>
        ) : (
          <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
            {preview.splits.map((split) => (
              <li key={split.records.join("-")}>
                <Typography variant="body2" component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
                  {formatDate(split.date)}: {securityLabel(split.key)}, Verhältnis {split.ratioOld}:{split.ratioNew} (
                  {formatQuantity(split.oldQuantity)} → {formatQuantity(split.newQuantity)} Stück)
                  {split.recorded ? " · bereits erfasst, wird nicht erneut gebucht" : ""}
                </Typography>
              </li>
            ))}
          </Box>
        )}
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
                  {change.recorded ? " · bereits erfasst, wird nicht erneut gebucht" : ""}
                </Typography>
              </li>
            ))}
          </Box>
        )}
      </Section>

      <Section id="parqet-deliveries" title="Einlieferungen">
        {preview.deliveries.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Keine Einlieferungen erkannt.
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Eingelieferte Wertpapiere werden als Kauf zu Parqets Einstand gebucht, mit einer gleich hohen Einzahlung am
              selben Tag – das Verrechnungskonto bleibt unverändert.
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
              {preview.deliveries.map((delivery) => (
                <li key={delivery.records.join("-")}>
                  <Typography variant="body2" component="span" sx={{ fontVariantNumeric: "tabular-nums" }}>
                    {formatDate(delivery.date)}: {securityLabel(delivery.securityKey ?? "")},{" "}
                    {formatQuantity(delivery.quantity ?? "0")} Stück, {formatMoney(delivery.amount)}
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
                {security.estimated ? (
                  <TypeSelect security={security} classification={classification} />
                ) : (
                  <Chip
                    size="small"
                    label={securityTypeLabel(security.assetType)}
                    color={security.assetType === "UNCLASSIFIED" ? "warning" : "default"}
                    variant="outlined"
                  />
                )}
              </Box>
            ))}
          </Box>
        )}
      </Section>

      {preview.hasCashRows ? null : (
        <Alert severity="info" sx={{ mt: 3 }}>
          {fundingNote(preview.fundingCount)}
        </Alert>
      )}

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

type Loaded = { preview: ParqetPreview; file: File; depotId: string };

/**
 * "Aus Parqet übernehmen" wizard: pick a Parqet CSV and the target Depot, review the preview (optionally
 * override estimated types, decide duplicates and flagged rows), then "Übernehmen" re-sends the same file
 * and Depot with the decisions ("Alle wie in Parqet übernehmen": bookable flags as Parqet has them); the
 * summary compares the booked ledger with Parqet. Server actions are called directly so preview,
 * decisions and summary live in one client state; nothing is written optimistically.
 */
export function ParqetMigrationWizard({ depots }: { depots: WizardDepot[] }) {
  const [depotId, setDepotId] = useState(depots[0]?.id ?? "");
  const [fileName, setFileName] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [decisions, setDecisions] = useState<MigrationDecisions>(EMPTY_DECISIONS);
  const [summary, setSummary] = useState<MigrationSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** A changed file or Depot makes the preview (and any summary) stale. */
  const reset = () => {
    setLoaded(null);
    setSummary(null);
    setError(null);
    setDecisions(EMPTY_DECISIONS);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    const target = String(data.get("depotId") ?? "");
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof previewParqetAction>>;
      try {
        result = await previewParqetAction(null, data);
      } catch {
        setError(ACTION_FAILED_MESSAGE);
        return;
      }
      setSummary(null);
      if (result?.ok && file instanceof File) {
        setLoaded({ preview: result.preview, file, depotId: target });
        setDecisions(initialDecisions(result.preview));
        setError(null);
      } else {
        setLoaded(null);
        setError(result && !result.ok ? previewFailureMessage(result) : null);
      }
    });
  };

  /** A changed decision makes the last failure message stale. */
  const changeDecisions = (next: MigrationDecisions) => {
    setDecisions(next);
    setError(null);
  };

  const open = loaded ? openDecisions(loaded.preview, decisions) : [];

  const confirm = (asIs = false) => {
    if (!loaded || open.length > 0) return;
    const data = new FormData();
    data.set("file", loaded.file);
    data.set("depotId", loaded.depotId);
    data.set("decisions", JSON.stringify(submittedDecisions(loaded.preview, decisions, asIs)));
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof confirmParqetAction>>;
      try {
        result = await confirmParqetAction(data);
      } catch {
        setError(ACTION_FAILED_MESSAGE);
        return;
      }
      if (result.ok) {
        setSummary(result.summary);
        setLoaded(null);
        setError(null);
        return;
      }
      if (result.reason === "decisions-open") {
        setLoaded({ ...loaded, preview: result.preview });
        setDecisions(carryDecisions(result.preview, decisions));
      }
      setError(confirmFailureMessage(result));
    });
  };

  return (
    <>
      <Card>
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Lade den CSV-Export eines Parqet-Portfolios hoch und wähle das Ziel-Depot. Die Vorschau zeigt, was gebucht
            würde – gebucht wird erst mit „Übernehmen“.
          </Typography>
          <form onSubmit={submit} noValidate aria-label="Parqet-Export prüfen">
            <Stack spacing={2}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
                <Button component="label" variant="outlined" disabled={pending} sx={TOUCH_TARGET}>
                  CSV-Datei wählen
                  <input
                    type="file"
                    name="file"
                    accept=".csv,text/csv"
                    hidden
                    disabled={pending}
                    onChange={(event) => {
                      setFileName(event.target.files?.[0]?.name ?? "");
                      reset();
                    }}
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
                onChange={(event) => {
                  setDepotId(event.target.value);
                  reset();
                }}
                disabled={pending}
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
                  {pending && !loaded ? "Wird gelesen …" : "Vorschau anzeigen"}
                </Button>
              </Box>
            </Stack>
          </form>
        </CardContent>
      </Card>
      {error ? (
        <Alert severity="error" role="alert" sx={{ mt: 2 }}>
          {error}
        </Alert>
      ) : null}
      {loaded ? (
        <>
          <ParqetPreviewView
            preview={loaded.preview}
            classification={{ decisions, onChange: changeDecisions, disabled: pending }}
          />
          <ParqetDecisions
            preview={loaded.preview}
            decisions={decisions}
            onChange={changeDecisions}
            disabled={pending}
            onConfirmAsIs={open.length > 0 || pending ? undefined : () => confirm(true)}
          />
          <ConfirmBar openCount={open.length} pending={pending} onConfirm={() => confirm()} />
        </>
      ) : null}
      {summary ? <ParqetSummaryView summary={summary} /> : null}
    </>
  );
}

/** "Offene Entscheidungen: n" (undecided duplicates) and "Übernehmen" (enabled only with none open and nothing pending). */
export function ConfirmBar({ openCount, pending, onConfirm }: { openCount: number; pending: boolean; onConfirm: () => void }) {
  return (
    <Box sx={{ mt: 3, mb: 2, display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
      <Typography variant="body2" sx={{ fontWeight: openCount > 0 ? 600 : 400 }} role="status">
        {openDecisionsLabel(openCount)}
      </Typography>
      <Button variant="contained" onClick={onConfirm} disabled={openCount > 0 || pending} sx={TOUCH_TARGET}>
        {pending ? "Wird gebucht …" : "Übernehmen"}
      </Button>
    </Box>
  );
}
