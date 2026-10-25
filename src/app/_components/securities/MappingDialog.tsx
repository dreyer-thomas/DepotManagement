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
import { resolveMappingAction, type SetMappingActionState, setMappingAction, type ResolveMappingActionState } from "@/app/_actions/securities";
import type { ProviderMappingSummary } from "@/modules/prices";
import { ACTION_FAILED_MESSAGE, PROVIDER_OPTIONS, securityErrorMessage } from "./labels";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "./SecurityDialog";

type MappedSecurity = { id: string; name: string; mapping: ProviderMappingSummary | null };

/**
 * "Kursquelle bearbeiten" form: provider + symbol, prefilled with the current mapping. Inputs are
 * controlled so they keep their text after an error; success closes the dialog.
 */
function MappingForm({ security, onClose }: { security: MappedSecurity; onClose: () => void }) {
  const [provider, setProvider] = useState<string>(security.mapping?.provider ?? "");
  const [symbol, setSymbol] = useState(security.mapping?.symbol ?? "");
  const [state, formAction, pending] = useActionState<SetMappingActionState | { ok: false; reason: "action-failed" }, FormData>(
    async (previous, formData) => {
      try {
        const result = await setMappingAction(previous as SetMappingActionState, formData);
        if (result?.ok) onClose();
        return result;
      } catch {
        return { ok: false, reason: "action-failed" };
      }
    },
    null,
  );
  const reason = state && !state.ok ? state.reason : undefined;
  const providerError = reason === "provider-invalid" ? securityErrorMessage(reason) : undefined;
  const symbolError = reason === "symbol-invalid" ? securityErrorMessage(reason) : undefined;
  const alert =
    reason === "action-failed"
      ? ACTION_FAILED_MESSAGE
      : reason && !providerError && !symbolError
        ? securityErrorMessage(reason)
        : undefined;
  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="securityId" value={security.id} />
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {alert ? (
            <Alert severity="error" role="alert">
              {alert}
            </Alert>
          ) : null}
          <Typography variant="body2" color="text.secondary">
            {security.name}
          </Typography>
          <TextField
            select
            name="provider"
            label="Kursquelle"
            value={provider}
            onChange={(event) => setProvider(event.target.value)}
            error={Boolean(providerError)}
            helperText={providerError}
            required
            fullWidth
          >
            {PROVIDER_OPTIONS.map(({ value, label }) => (
              <MenuItem key={value} value={value} sx={TOUCH_TARGET}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            name="symbol"
            label="Symbol"
            value={symbol}
            onChange={(event) => setSymbol(event.target.value)}
            error={Boolean(symbolError)}
            helperText={symbolError ?? "z. B. EUNL.DE, ISIN bei onvista, Coin-ID bei CoinGecko"}
            required
            fullWidth
            autoComplete="off"
          />
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

/** Button that opens the "Kursquelle bearbeiten" dialog of a Security. */
export function MappingDialogButton({ security }: { security: MappedSecurity }) {
  const dialog = useDialog();
  return (
    <>
      <Button variant="outlined" size="small" onClick={dialog.show} aria-label={`Kursquelle bearbeiten – ${security.name}`} sx={TOUCH_TARGET}>
        Kursquelle bearbeiten
      </Button>
      <SecurityDialog open={dialog.open} onClose={dialog.hide} title="Kursquelle bearbeiten">
        <MappingForm key={dialog.session} security={security} onClose={dialog.hide} />
      </SecurityDialog>
    </>
  );
}

/**
 * "Automatisch suchen" for a Security with the "not found" marker: asks the providers again. A miss
 * or failure shows an inline message; a hit refreshes the list (revalidation).
 */
export function ResolveMappingButton({ security }: { security: { id: string; name: string } }) {
  const [state, formAction, pending] = useActionState<ResolveMappingActionState | { ok: false; reason: "action-failed" }, FormData>(
    async (previous, formData) => {
      try {
        return await resolveMappingAction(previous as ResolveMappingActionState, formData);
      } catch {
        return { ok: false, reason: "action-failed" };
      }
    },
    null,
  );
  let message: { severity: "info" | "error"; text: string } | undefined;
  if (state?.ok && state.status === "not-found") message = { severity: "info", text: "Weiterhin keine Kursquelle gefunden." };
  else if (state && !state.ok) {
    message = {
      severity: "error",
      text: state.reason === "action-failed" ? ACTION_FAILED_MESSAGE : securityErrorMessage(state.reason),
    };
  }
  return (
    <Stack component="form" action={formAction} noValidate spacing={1}>
      <input type="hidden" name="securityId" value={security.id} />
      <Button type="submit" variant="outlined" size="small" disabled={pending} aria-label={`Automatisch suchen – ${security.name}`} sx={TOUCH_TARGET}>
        Automatisch suchen
      </Button>
      {message ? (
        <Alert severity={message.severity} role={message.severity === "error" ? "alert" : "status"}>
          {message.text}
        </Alert>
      ) : null}
    </Stack>
  );
}
