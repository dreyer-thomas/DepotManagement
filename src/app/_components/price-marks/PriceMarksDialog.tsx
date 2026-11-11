"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useActionState, useId } from "react";
import { type SetPriceMarksActionState, setPriceMarksAction } from "@/app/_actions/price-marks";
import { PRICE_MARK_FIELDS } from "./form-fields";
import { PriceMarkFields, type PriceMarksEditInfo, usePriceMarksForm } from "./PriceMarkFields";

const TOUCH_TARGET = { minHeight: 44 };

const FAILURES: Record<"not-found" | "unauthorized", string> = {
  "not-found": "Wertpapier nicht gefunden.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

function PriceMarksForm({
  security,
  info,
  today,
  titleId,
  onClose,
}: {
  security: { id: string; name: string; isin: string | null; cryptoSymbol: string | null };
  info: PriceMarksEditInfo;
  today: string;
  titleId: string;
  onClose: () => void;
}) {
  const { form, update } = usePriceMarksForm(info.marks, today);
  const [state, formAction, pending] = useActionState<SetPriceMarksActionState, FormData>(async (previous, formData) => {
    const result = await setPriceMarksAction(previous, formData);
    if (result?.ok) onClose();
    return result;
  }, null);
  const fieldError = state && !state.ok && state.reason === "price-marks-invalid" ? { field: state.field, problem: state.problem } : undefined;
  const alert = state && !state.ok && state.reason !== "price-marks-invalid" ? FAILURES[state.reason] : undefined;
  return (
    <>
      <DialogTitle id={titleId}>Kursmarken bearbeiten</DialogTitle>
      <Box component="form" action={formAction} noValidate sx={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {alert ? (
              <Alert severity="error" role="alert">
                {alert}
              </Alert>
            ) : null}
            <input type="hidden" name={PRICE_MARK_FIELDS.securityId} value={security.id} />
            <Typography sx={{ fontWeight: 600 }}>
              {security.name}{" "}
              <Typography component="span" variant="body2" color="text.secondary">
                {security.isin ?? security.cryptoSymbol ?? ""}
              </Typography>
            </Typography>
            <PriceMarkFields
              form={form}
              onChange={update}
              today={today}
              latestPrice={info.latestPrice}
              analystTarget={info.analystTarget}
              error={fieldError}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, mt: "auto" }}>
          <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET}>
            Abbrechen
          </Button>
          <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
            Speichern
          </Button>
        </DialogActions>
      </Box>
    </>
  );
}

/**
 * Dialog "Kursmarken bearbeiten" (story 12.2) of one Security: stop and target with source and set date,
 * warnings against the latest Price and the analyst-target suggestion; "Kein Stopp" and an empty target
 * clear the marks. A new `formKey` starts a fresh form. Opened from the detail page's actions menu (and the
 * marks card of story 12.3).
 */
export function PriceMarksDialog({
  open,
  onClose,
  formKey,
  security,
  info,
  today,
}: {
  open: boolean;
  onClose: () => void;
  formKey: number;
  security: { id: string; name: string; isin: string | null; cryptoSymbol: string | null };
  info: PriceMarksEditInfo;
  today: string;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <PriceMarksForm key={formKey} security={security} info={info} today={today} titleId={titleId} onClose={onClose} />
    </Dialog>
  );
}
