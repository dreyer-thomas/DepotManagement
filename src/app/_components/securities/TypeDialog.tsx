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
import { type ChangeSecurityTypeActionState, changeSecurityTypeAction } from "@/app/_actions/securities";
import type { AssetType } from "@/modules/ledger";
import { ACTION_FAILED_MESSAGE, securityErrorMessage, typeOptions } from "./labels";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "./SecurityDialog";

type TypedSecurity = { id: string; name: string; assetType: AssetType };

function TypeForm({
  security,
  allowedTypes,
  onClose,
}: {
  security: TypedSecurity;
  allowedTypes: readonly AssetType[];
  onClose: () => void;
}) {
  const options = typeOptions(allowedTypes);
  const [assetType, setAssetType] = useState<string>(
    options.some((option) => option.value === security.assetType) ? security.assetType : "",
  );
  const [state, formAction, pending] = useActionState<ChangeSecurityTypeActionState | { ok: false; reason: "action-failed" }, FormData>(
    async (previous, formData) => {
      try {
        const result = await changeSecurityTypeAction(previous as ChangeSecurityTypeActionState, formData);
        if (result?.ok) onClose();
        return result;
      } catch {
        return { ok: false, reason: "action-failed" };
      }
    },
    null,
  );
  const reason = state && !state.ok ? state.reason : undefined;
  const fieldError = reason === "asset-type-invalid" ? securityErrorMessage(reason) : undefined;
  const alert = reason === "action-failed" ? ACTION_FAILED_MESSAGE : reason && !fieldError ? securityErrorMessage(reason) : undefined;
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
            name="assetType"
            label="Typ"
            value={assetType}
            onChange={(event) => setAssetType(event.target.value)}
            error={Boolean(fieldError)}
            helperText={fieldError}
            required
            fullWidth
          >
            {options.map(({ value, label }) => (
              <MenuItem key={value} value={value} sx={TOUCH_TARGET}>
                {label}
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

/** Button that opens the "Typ ändern" dialog; offers only the types valid for the identifier. */
export function TypeDialogButton({ security, allowedTypes }: { security: TypedSecurity; allowedTypes: readonly AssetType[] }) {
  const dialog = useDialog();
  return (
    <>
      <Button variant="outlined" size="small" onClick={dialog.show} aria-label={`Typ ändern – ${security.name}`} sx={TOUCH_TARGET}>
        Typ ändern
      </Button>
      <SecurityDialog open={dialog.open} onClose={dialog.hide} title="Typ ändern">
        <TypeForm key={dialog.session} security={security} allowedTypes={allowedTypes} onClose={dialog.hide} />
      </SecurityDialog>
    </>
  );
}
