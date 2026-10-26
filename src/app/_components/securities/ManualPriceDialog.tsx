"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useActionState, useState } from "react";
import { type SaveManualPriceActionState, saveManualPriceAction } from "@/app/_actions/prices";
import { manualPriceErrorMessage } from "../prices/price-labels";
import { ACTION_FAILED_MESSAGE } from "./labels";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "./SecurityDialog";

type ActionState = SaveManualPriceActionState | { ok: false; reason: "action-failed" };

/**
 * "Kurs manuell eintragen" form: date (default today, not after today) and price in German decimal
 * format. Inputs are controlled so they keep their text after an error; success closes the dialog
 * (the action revalidates the page).
 */
function ManualPriceForm({
  security,
  today,
  onClose,
}: {
  security: { id: string; name: string };
  today: string;
  onClose: () => void;
}) {
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState("");
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    try {
      const result = await saveManualPriceAction(previous as SaveManualPriceActionState, formData);
      if (result?.ok) onClose();
      return result;
    } catch {
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const reason = state && !state.ok ? state.reason : undefined;
  const dateError = reason === "date-invalid" ? manualPriceErrorMessage(reason) : undefined;
  const priceError = reason === "price-invalid" ? manualPriceErrorMessage(reason) : undefined;
  const alert =
    reason === "action-failed"
      ? ACTION_FAILED_MESSAGE
      : reason === "not-found" || reason === "unauthorized"
        ? manualPriceErrorMessage(reason)
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
            name="date"
            label="Datum"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            error={Boolean(dateError)}
            helperText={dateError}
            required
            fullWidth
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
          />
          <TextField
            name="price"
            label="Kurs in €"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            error={Boolean(priceError)}
            helperText={priceError ?? "z. B. 12,34"}
            required
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { autoComplete: "off", inputMode: "decimal" } }}
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

/** Button that opens the "Kurs manuell eintragen" dialog of a Security. */
export function ManualPriceButton({ security, today }: { security: { id: string; name: string }; today: string }) {
  const dialog = useDialog();
  return (
    <>
      <Button
        color="inherit"
        variant="outlined"
        size="small"
        onClick={dialog.show}
        aria-label={`Kurs manuell eintragen – ${security.name}`}
        sx={TOUCH_TARGET}
      >
        Kurs manuell eintragen
      </Button>
      <SecurityDialog open={dialog.open} onClose={dialog.hide} title="Kurs manuell eintragen">
        <ManualPriceForm key={dialog.session} security={security} today={today} onClose={dialog.hide} />
      </SecurityDialog>
    </>
  );
}
