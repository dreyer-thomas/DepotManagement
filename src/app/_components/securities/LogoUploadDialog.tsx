"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useActionState, useState } from "react";
import { type UploadLogoActionState, uploadLogoAction } from "@/app/_actions/logos";
import { ACTION_FAILED_MESSAGE, logoErrorMessage } from "./labels";
import { useLogoVersion } from "./LogoContext";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "./SecurityDialog";

type ActionState = UploadLogoActionState | { ok: false; reason: "action-failed" };

export const LOGO_ACCEPT = "image/png,image/jpeg,image/webp";
export const LOGO_HINT = "PNG, JPEG oder WebP, höchstens 1 MB.";

/** "Logo hochladen" form: one image file; success closes the dialog (the action revalidates the page). */
function LogoUploadForm({ security, onClose }: { security: { id: string; name: string }; onClose: () => void }) {
  const [fileName, setFileName] = useState("");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    try {
      const result = await uploadLogoAction(previous as UploadLogoActionState, formData);
      if (result?.ok) onClose();
      return result;
    } catch {
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const reason = state && !state.ok ? state.reason : undefined;
  const alert = reason === undefined ? undefined : reason === "action-failed" ? ACTION_FAILED_MESSAGE : logoErrorMessage(reason);
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
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
            <Button component="label" variant="outlined" disabled={pending} sx={TOUCH_TARGET}>
              Bilddatei wählen
              <input
                type="file"
                name="file"
                accept={LOGO_ACCEPT}
                hidden
                disabled={pending}
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
              />
            </Button>
            <Typography variant="body2" color={fileName ? "text.primary" : "text.secondary"} sx={{ wordBreak: "break-all" }}>
              {fileName || "Keine Datei gewählt"}
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {LOGO_HINT}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
          Hochladen
        </Button>
      </DialogActions>
    </form>
  );
}

/** "Logo hochladen" (no stored logo) / "Logo ersetzen" (stored logo) button with its upload dialog. */
export function LogoUploadButton({ security }: { security: { id: string; name: string } }) {
  const dialog = useDialog();
  const label = useLogoVersion(security.id) === undefined ? "Logo hochladen" : "Logo ersetzen";
  return (
    <>
      <Button
        color="inherit"
        variant="outlined"
        size="small"
        onClick={dialog.show}
        aria-label={`${label} – ${security.name}`}
        sx={TOUCH_TARGET}
      >
        {label}
      </Button>
      <SecurityDialog open={dialog.open} onClose={dialog.hide} title="Logo hochladen">
        <LogoUploadForm key={dialog.session} security={security} onClose={dialog.hide} />
      </SecurityDialog>
    </>
  );
}
