"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useActionState, useState } from "react";
import {
  deleteSplitAction,
  type DeleteSplitActionState,
  saveSplitAction,
  type SplitActionState,
} from "@/app/_actions/corporate-actions";
import { formatDate } from "@/core/format";
import type { SecuritySummary, SplitRecord } from "@/modules/ledger";
import { formatSplitRatio, splitErrorField, splitErrorMessage } from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

/** The detail of a failure that carries one (the SELL's date). */
function failureDate(state: { ok: false; reason: string; date?: string }): string | undefined {
  return "date" in state ? state.date : undefined;
}

/**
 * Split form: ratio `alt:neu` and effective date. Records a new split of `security`, or edits `split`
 * when given. Inputs are controlled so they keep their text after an error; success calls `onSaved`.
 */
function SplitForm({
  security,
  split,
  onSaved,
  onCancel,
}: {
  security: SecuritySummary;
  split: SplitRecord | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [ratio, setRatio] = useState(split ? formatSplitRatio(split) : "");
  const [date, setDate] = useState(split?.date ?? "");
  const [state, formAction, pending] = useActionState<SplitActionState, FormData>(async (previous, formData) => {
    const result = await saveSplitAction(previous, formData);
    if (result?.ok) onSaved();
    return result;
  }, null);

  const failure = state && !state.ok ? state : undefined;
  const field = failure ? splitErrorField(failure.reason) : undefined;
  const message = failure ? splitErrorMessage(failure.reason, failureDate(failure)) : undefined;

  return (
    <form action={formAction} noValidate aria-label={split ? "Split bearbeiten" : "Split erfassen"}>
      <input type="hidden" name="securityId" value={security.id} />
      {split ? <input type="hidden" name="splitId" value={split.id} /> : null}
      <Stack spacing={2} sx={{ pt: 1 }}>
        {message && !field ? (
          <Alert severity="error" role="alert">
            {message}
          </Alert>
        ) : null}
        <TextField
          name="ratio"
          label="Verhältnis (alt:neu)"
          placeholder="1:4"
          value={ratio}
          onChange={(event) => setRatio(event.target.value)}
          error={field === "ratio"}
          helperText={field === "ratio" ? message : undefined}
          autoFocus
          required
          fullWidth
          slotProps={{ htmlInput: { autoComplete: "off", inputMode: "numeric" } }}
        />
        <TextField
          name="date"
          label="Gültig ab"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          error={field === "date"}
          helperText={field === "date" ? message : undefined}
          required
          fullWidth
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          <Button onClick={onCancel} disabled={pending} sx={TOUCH_TARGET}>
            {split ? "Bearbeitung abbrechen" : "Abbrechen"}
          </Button>
          <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
            {split ? "Speichern" : "Split erfassen"}
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}

/** One recorded split with Bearbeiten / Löschen; Löschen asks for confirmation inline. */
function SplitRow({ split, onEdit, disabled }: { split: SplitRecord; onEdit: () => void; disabled: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const [state, deleteAction, deleting] = useActionState<DeleteSplitActionState, FormData>(
    () => deleteSplitAction(split.id),
    null,
  );
  const failure = state && !state.ok ? splitErrorMessage(state.reason, failureDate(state)) : undefined;
  const label = `Split vom ${formatDate(split.date)} (${formatSplitRatio(split)})`;
  return (
    <Box component="li" sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Typography sx={{ flex: 1, minWidth: 140, fontVariantNumeric: "tabular-nums" }}>
          {formatDate(split.date)} · {formatSplitRatio(split)}
        </Typography>
        {confirming ? null : (
          <>
            <Button onClick={onEdit} disabled={disabled} aria-label={`${label} bearbeiten`} sx={TOUCH_TARGET}>
              Bearbeiten
            </Button>
            <Button
              color="error"
              onClick={() => setConfirming(true)}
              disabled={disabled}
              aria-label={`${label} löschen`}
              sx={TOUCH_TARGET}
            >
              Löschen
            </Button>
          </>
        )}
      </Stack>
      {confirming ? (
        <Stack component="form" action={deleteAction} spacing={1} sx={{ mt: 1 }}>
          {failure ? (
            <Alert severity="error" role="alert">
              {failure}
            </Alert>
          ) : null}
          <Typography variant="body2">{label} löschen?</Typography>
          <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
            <Button onClick={() => setConfirming(false)} disabled={deleting} autoFocus sx={TOUCH_TARGET}>
              Abbrechen
            </Button>
            <Button type="submit" color="error" variant="contained" disabled={deleting} sx={TOUCH_TARGET}>
              Löschen
            </Button>
          </Stack>
        </Stack>
      ) : null}
    </Box>
  );
}

/**
 * "Split – {Security}" dialog: records a new split, and lists the Security's recorded splits with
 * edit and delete. Full-screen below `sm`; Esc and a backdrop click close it.
 */
export function SplitDialog({
  open,
  onClose,
  security,
  splits,
}: {
  open: boolean;
  onClose: () => void;
  security: SecuritySummary;
  /** Recorded splits (any Security); only those of `security` are listed. */
  splits: SplitRecord[];
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [editing, setEditing] = useState<SplitRecord | null>(null);
  const [formKey, setFormKey] = useState(0);
  const own = splits.filter((split) => split.security.id === security.id);
  const titleId = `split-dialog-title-${security.id}`;
  const resetForm = () => {
    setEditing(null);
    setFormKey((value) => value + 1);
  };
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="xs" aria-labelledby={titleId}>
      <DialogTitle id={titleId}>Split – {security.name}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <SplitForm
          key={`${formKey}-${editing?.id ?? "new"}`}
          security={security}
          split={editing}
          onSaved={editing ? resetForm : onClose}
          onCancel={editing ? resetForm : onClose}
        />
        <Divider sx={{ my: 2 }} />
        <Typography id={`${titleId}-list`} component="h3" variant="subtitle2" sx={{ fontWeight: 600 }}>
          Erfasste Splits
        </Typography>
        {own.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Noch keine Splits erfasst.
          </Typography>
        ) : (
          <Box component="ul" aria-labelledby={`${titleId}-list`} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {own.map((split) => (
              <SplitRow
                key={`${split.id}-${split.date}-${formatSplitRatio(split)}`}
                split={split}
                disabled={editing?.id === split.id}
                onEdit={() => {
                  setEditing(split);
                  setFormKey((value) => value + 1);
                }}
              />
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={TOUCH_TARGET}>
          Schließen
        </Button>
      </DialogActions>
    </Dialog>
  );
}
