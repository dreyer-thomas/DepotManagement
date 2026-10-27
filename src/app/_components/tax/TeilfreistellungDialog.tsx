"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useActionState, useState } from "react";
import { type SetTeilfreistellungActionState, setTeilfreistellungAction } from "@/app/_actions/tax";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "../securities/SecurityDialog";
import { TAX_ACTION_FAILED, TAX_UNAUTHORIZED, teilfreistellungOptions } from "./labels";

type ActionState = SetTeilfreistellungActionState | { ok: false; reason: "action-failed" };

type FundSecurity = { id: string; name: string };

const ERRORS: Record<string, string> = {
  "rate-invalid": "Bitte einen Satz aus der Liste wählen.",
  "security-not-found": "Wertpapier nicht gefunden.",
  unauthorized: TAX_UNAUTHORIZED,
  "action-failed": TAX_ACTION_FAILED,
};

function TeilfreistellungForm({
  security,
  automaticRate,
  override,
  onClose,
}: {
  security: FundSecurity;
  automaticRate: string;
  override: string | null;
  onClose: () => void;
}) {
  const [rate, setRate] = useState(override ?? "");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    try {
      const result = await setTeilfreistellungAction(previous as SetTeilfreistellungActionState, formData);
      if (result?.ok) onClose();
      return result;
    } catch {
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const error = state && !state.ok ? (ERRORS[state.reason] ?? TAX_ACTION_FAILED) : undefined;
  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="securityId" value={security.id} />
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error ? (
            <Alert severity="error" role="alert">
              {error}
            </Alert>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            {security.name}
          </Typography>
          <TextField
            select
            name="rate"
            label="Teilfreistellung"
            value={rate}
            onChange={(event) => setRate(event.target.value)}
            helperText="Automatisch: 30 % für Aktienfonds (Anlageklasse Aktien), sonst 0 %."
            fullWidth
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            {teilfreistellungOptions(automaticRate).map((option) => (
              <MenuItem key={option.value} value={option.value} sx={TOUCH_TARGET}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
          Speichern
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * Button that opens "Teilfreistellung" for a fund (ETF/FUND): "Automatisch (30 %|0 %)" or a manual rate
 * of 0/15/30/60/80 %. `automaticRate` is the rate without override; `override` the stored one, if any.
 */
export function TeilfreistellungButton({
  security,
  automaticRate,
  override,
}: {
  security: FundSecurity;
  automaticRate: string;
  override: string | null;
}) {
  const dialog = useDialog();
  return (
    <>
      <Button variant="outlined" size="small" onClick={dialog.show} aria-label={`Teilfreistellung bearbeiten – ${security.name}`} sx={TOUCH_TARGET}>
        Teilfreistellung
      </Button>
      <SecurityDialog open={dialog.open} onClose={dialog.hide} title="Teilfreistellung bearbeiten">
        <TeilfreistellungForm key={dialog.session} security={security} automaticRate={automaticRate} override={override} onClose={dialog.hide} />
      </SecurityDialog>
    </>
  );
}
