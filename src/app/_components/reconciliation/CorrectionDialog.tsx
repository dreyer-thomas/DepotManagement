"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useId, useState, useTransition } from "react";
import { bookReconciliationCorrectionAction } from "@/app/_actions/reconciliation";
import { ExactDecimal } from "@/core/decimal";
import { formatDate, formatMoney, formatQuantity } from "@/core/format";
import type { ReconciliationRowRecord } from "@/modules/ledger";
import { inputValue, reconciliationErrorMessage, rowName } from "./labels";

const TOUCH_TARGET = { minHeight: 44 };
const ACTION_FAILED = "Buchen fehlgeschlagen. Bitte erneut versuchen.";

/**
 * "Korrektur buchen" for a differing row: a Position books a Bestandskorrektur of the signed difference
 * (a positive one with an editable unit cost, prefilled with the average purchase price); the Cash
 * Account an Einzahlung or Auszahlung of the difference with the note "Kontoabgleich". Closes on success.
 */
export function CorrectionDialog({
  runId,
  statementDate,
  row,
  onClose,
}: {
  runId: string;
  statementDate: string;
  /** The row to correct; `null` closes the dialog. */
  row: ReconciliationRowRecord | null;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Dialog open={row !== null} onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="xs">
      {row ? (
        <CorrectionForm
          key={`${row.securityId}|${row.difference}`}
          titleId={titleId}
          runId={runId}
          statementDate={statementDate}
          row={row}
          onClose={onClose}
        />
      ) : null}
    </Dialog>
  );
}

function CorrectionForm({
  titleId,
  runId,
  statementDate,
  row,
  onClose,
}: {
  titleId: string;
  runId: string;
  statementDate: string;
  row: ReconciliationRowRecord;
  onClose: () => void;
}) {
  const isCash = row.securityId === null;
  const difference = new ExactDecimal(row.difference ?? "0");
  const positive = difference.isPositive();
  const [unitCost, setUnitCost] = useState(inputValue(row.defaultUnitCost));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const book = () =>
    startTransition(async () => {
      try {
        const result = await bookReconciliationCorrectionAction(runId, row.securityId, !isCash && positive ? unitCost : undefined);
        if (result.ok) onClose();
        else setError(reconciliationErrorMessage(result, isCash));
      } catch {
        setError(ACTION_FAILED);
      }
    });

  return (
    <>
      <DialogTitle id={titleId}>Korrektur buchen</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          ) : null}
          <Typography>
            {rowName(row)} · am {formatDate(statementDate)}
          </Typography>
          {isCash ? (
            <>
              <Typography sx={{ fontWeight: 600 }}>
                {positive ? "Einzahlung" : "Auszahlung"} {formatMoney(difference.abs().toFixed())}
              </Typography>
              <Typography color="text.secondary">Notiz: Kontoabgleich</Typography>
            </>
          ) : (
            <>
              <Typography sx={{ fontWeight: 600 }}>
                Bestandskorrektur {formatQuantity(difference.toFixed(), { sign: true })} Stück
              </Typography>
              {positive ? (
                <TextField
                  label="Einstandskurs je Stück"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  required
                  fullWidth
                  helperText="Vorbelegt mit dem durchschnittlichen Einstandskurs"
                  slotProps={{ htmlInput: { inputMode: "decimal", autoComplete: "off" } }}
                />
              ) : (
                <Typography color="text.secondary">Die ältesten Stücke werden zum Einstandswert ausgebucht.</Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                Kein Cash-Effekt, kein realisierter Gewinn oder Verlust.
              </Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button variant="contained" onClick={book} disabled={pending} sx={TOUCH_TARGET}>
          Buchen
        </Button>
      </DialogActions>
    </>
  );
}
