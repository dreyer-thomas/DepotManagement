"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useActionState } from "react";
import { type DeleteManualPriceActionResult, deleteManualPriceAction } from "@/app/_actions/prices";
import { formatDate } from "@/core/format";
import type { ManualPriceRow } from "@/modules/prices";
import { deleteManualPriceConfirmText, manualPriceErrorMessage, manualPriceText } from "../prices/price-labels";
import { ACTION_FAILED_MESSAGE } from "./labels";
import { ManualPriceEditDialog } from "./ManualPriceDialog";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "./SecurityDialog";

type DeleteState = DeleteManualPriceActionResult | { ok: false; reason: "action-failed" } | null;

/** Confirm step of "Löschen": deletes after the server confirmed, closing on success. */
function DeleteManualPriceForm({
  security,
  price,
  onClose,
}: {
  security: { name: string };
  price: ManualPriceRow;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<DeleteState, FormData>(async () => {
    try {
      const result = await deleteManualPriceAction(price.id);
      if (result.ok) onClose();
      return result;
    } catch {
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const reason = state && !state.ok ? state.reason : undefined;
  const alert =
    reason === "action-failed"
      ? ACTION_FAILED_MESSAGE
      : reason === "not-found"
        ? manualPriceErrorMessage("price-not-found")
        : reason
          ? manualPriceErrorMessage(reason)
          : undefined;
  return (
    <form action={formAction}>
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {alert ? (
            <Alert severity="error" role="alert">
              {alert}
            </Alert>
          ) : null}
          <Typography>{deleteManualPriceConfirmText(price.date, security.name)}</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET} autoFocus>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" color="error" disabled={pending} sx={TOUCH_TARGET}>
          Löschen
        </Button>
      </DialogActions>
    </form>
  );
}

/** One manual Price: date, price, "Bearbeiten" and "Löschen" (after confirming). */
function ManualPriceItem({
  security,
  price,
  today,
}: {
  security: { id: string; name: string };
  price: ManualPriceRow;
  today: string;
}) {
  const edit = useDialog();
  const remove = useDialog();
  const date = formatDate(price.date);
  return (
    <Box
      component="li"
      sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 2, rowGap: 0.5 }}
    >
      <Typography variant="body2" sx={{ minWidth: "6.5rem" }}>
        {date}
      </Typography>
      <Typography variant="body2" sx={{ flexGrow: 1, fontVariantNumeric: "tabular-nums" }}>
        {manualPriceText(price.price)}
      </Typography>
      <Stack direction="row" sx={{ gap: 1 }}>
        <Button
          size="small"
          onClick={edit.show}
          aria-label={`Manuellen Kurs vom ${date} bearbeiten – ${security.name}`}
          sx={TOUCH_TARGET}
        >
          Bearbeiten
        </Button>
        <Button
          size="small"
          color="error"
          onClick={remove.show}
          aria-label={`Manuellen Kurs vom ${date} löschen – ${security.name}`}
          sx={TOUCH_TARGET}
        >
          Löschen
        </Button>
      </Stack>
      <ManualPriceEditDialog
        security={security}
        today={today}
        price={price}
        open={edit.open}
        session={edit.session}
        onClose={edit.hide}
      />
      <SecurityDialog open={remove.open} onClose={remove.hide} title="Manuellen Kurs löschen">
        <DeleteManualPriceForm key={remove.session} security={security} price={price} onClose={remove.hide} />
      </SecurityDialog>
    </Box>
  );
}

/** "Manuelle Kurse" of a Security, newest first; nothing when it has none. */
export function ManualPriceList({
  security,
  prices,
  today,
}: {
  security: { id: string; name: string };
  prices: readonly ManualPriceRow[];
  today: string;
}) {
  if (prices.length === 0) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Typography component="p" variant="subtitle2">
        Manuelle Kurse
      </Typography>
      <Box component="ul" aria-label={`Manuelle Kurse – ${security.name}`} sx={{ listStyle: "none", p: 0, m: 0 }}>
        {prices.map((price) => (
          <ManualPriceItem key={price.id} security={security} price={price} today={today} />
        ))}
      </Box>
    </Box>
  );
}
