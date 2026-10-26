"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  finishReconciliationAction,
  openReconciliationAction,
  type OpenReconciliationActionState,
} from "@/app/_actions/reconciliation";
import type { ReconciliationRowRecord, ReconciliationRunView } from "@/modules/ledger";
import { CorrectionDialog } from "./CorrectionDialog";
import { finishConfirmText, progressText, reconciliationErrorMessage, statementDateText } from "./labels";
import { ReconciliationRow } from "./ReconciliationRow";

const TOUCH_TARGET = { minHeight: 44 };
const numeric = { textAlign: "right", whiteSpace: "nowrap" } as const;

/** "Stichtag" (default today, ≤ today) and "Abgleich starten". */
export function ReconciliationStart({ depotId, today }: { depotId: string; today: string }) {
  const [state, formAction, pending] = useActionState<OpenReconciliationActionState | { ok: false; reason: "action-failed" }, FormData>(
    async (previous, formData) => {
      try {
        return await openReconciliationAction(previous as OpenReconciliationActionState, formData);
      } catch {
        return { ok: false, reason: "action-failed" };
      }
    },
    null,
  );
  const error =
    state && !state.ok
      ? state.reason === "action-failed"
        ? "Starten fehlgeschlagen. Bitte erneut versuchen."
        : reconciliationErrorMessage(state)
      : null;
  return (
    <Card>
      <CardContent>
        <Typography sx={{ mb: 2 }}>
          Stichtag des Depotauszugs wählen. Die App zeigt jede Position und das Cash-Konto zu diesem Tag.
        </Typography>
        <Stack component="form" action={formAction} direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ alignItems: { sm: "flex-start" } }}>
          <input type="hidden" name="depotId" value={depotId} />
          <TextField
            name="statementDate"
            label="Stichtag"
            type="date"
            defaultValue={today}
            required
            error={Boolean(error)}
            helperText={error ?? undefined}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
          />
          <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
            Abgleich starten
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

/** "Abgleich abschließen", confirming once when rows are not reconciled; returns to the Depot. */
function FinishButton({ runId, depotId, open }: { runId: string; depotId: string; open: number }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const finish = () =>
    startTransition(async () => {
      try {
        const result = await finishReconciliationAction(runId);
        if (result.ok) {
          setConfirming(false);
          router.push(`/depots/${encodeURIComponent(depotId)}`);
        } else {
          setError(reconciliationErrorMessage(result));
        }
      } catch {
        setError("Abschließen fehlgeschlagen. Bitte erneut versuchen.");
      }
    });
  return (
    <>
      <Button variant="contained" onClick={() => (open > 0 ? setConfirming(true) : finish())} disabled={pending} sx={TOUCH_TARGET}>
        Abgleich abschließen
      </Button>
      {error && !confirming ? (
        <Alert severity="error" role="alert">
          {error}
        </Alert>
      ) : null}
      <Dialog open={confirming} onClose={() => setConfirming(false)} aria-labelledby="finish-reconciliation-title">
        <DialogTitle id="finish-reconciliation-title">Abgleich abschließen?</DialogTitle>
        <DialogContent>
          {error ? (
            <Alert severity="error" role="alert" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <DialogContentText>{finishConfirmText(open)}</DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirming(false)} disabled={pending} sx={TOUCH_TARGET}>
            Abbrechen
          </Button>
          <Button variant="contained" onClick={finish} disabled={pending} sx={TOUCH_TARGET}>
            Trotzdem abschließen
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/**
 * An open run: "Stichtag …" and "x von y abgeglichen", one row per Position plus the Cash Account, and
 * "Abgleich abschließen". `readOnly` (archived Depot) shows the run without any write action.
 */
export function ReconciliationRun({ run, readOnly }: { run: ReconciliationRunView; readOnly: boolean }) {
  const [correcting, setCorrecting] = useState<ReconciliationRowRecord | null>(null);
  const open = run.progress.total - run.progress.reconciled;
  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ flexWrap: "wrap", alignItems: "baseline", columnGap: 3, rowGap: 1 }}>
        <Typography component="h2" variant="h6">
          {statementDateText(run.statementDate)}
        </Typography>
        <Typography aria-live="polite">{progressText(run.progress)}</Typography>
      </Stack>
      <Card sx={{ overflowX: "auto" }}>
        <Table size="small" aria-label="Abgleich">
          <TableHead>
            <TableRow>
              <TableCell>Wertpapier</TableCell>
              <TableCell sx={numeric}>Laut App</TableCell>
              <TableCell>Laut Auszug</TableCell>
              <TableCell padding="checkbox">stimmt</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>
                <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Aktionen</span>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {run.rows.map((row) => (
              <ReconciliationRow
                key={`${row.securityId ?? "cash"}|${row.statementValue ?? ""}`}
                runId={run.id}
                depotId={run.depotId}
                row={row}
                readOnly={readOnly}
                onCorrect={setCorrecting}
              />
            ))}
          </TableBody>
        </Table>
      </Card>
      {readOnly ? null : (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
          <FinishButton runId={run.id} depotId={run.depotId} open={open} />
        </Stack>
      )}
      <CorrectionDialog runId={run.id} statementDate={run.statementDate} row={correcting} onClose={() => setCorrecting(null)} />
    </Stack>
  );
}
