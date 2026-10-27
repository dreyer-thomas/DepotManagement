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
import { type SetClassificationActionState, setClassificationAction } from "@/app/_actions/classification";
import { securityTypeLabel } from "@/app/_components/migration/labels";
import { ASSET_CLASSES, type Classification, COMPANY_SIZES, type Dimension, DIMENSIONS, REGIONS, SECTOR_LABELS } from "@/core/classification";
import {
  ACTION_FAILED_MESSAGE,
  automaticLabel,
  CLASSIFICATION_FIELD_LABELS,
  classificationErrorField,
  classificationErrorMessage,
} from "./labels";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "./SecurityDialog";

type ActionState = SetClassificationActionState | { ok: false; reason: "action-failed" };

type ClassifiedSecurity = { id: string; name: string };

const SECTORS = [...new Set(Object.values(SECTOR_LABELS))].sort((a, b) => a.localeCompare(b, "de-DE"));

/** Options of the select dimensions; a stored manual value outside the list is offered too. */
const SELECT_OPTIONS: Partial<Record<Dimension, readonly string[]>> = {
  assetClass: ASSET_CLASSES,
  sector: SECTORS,
  region: REGIONS,
  companySize: COMPANY_SIZES,
};

function ClassificationForm({
  security,
  classification,
  onClose,
}: {
  security: ClassifiedSecurity;
  classification: Classification;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<Dimension, string>>(
    () => Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, classification[dimension].manual ?? ""])) as Record<Dimension, string>,
  );
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    try {
      const result = await setClassificationAction(previous as SetClassificationActionState, formData);
      if (result?.ok) onClose();
      return result;
    } catch {
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const reason = state && !state.ok ? state.reason : undefined;
  const errorField = reason && reason !== "action-failed" ? classificationErrorField(reason) : null;
  const alert =
    reason === undefined ? undefined : reason === "action-failed" ? ACTION_FAILED_MESSAGE : errorField ? undefined : classificationErrorMessage(reason);
  const set = (dimension: Dimension) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [dimension]: event.target.value }));

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
          <div>
            <Typography variant="body2">Typ: {securityTypeLabel(classification.type)}</Typography>
            <Typography variant="caption" color="text.secondary">
              Ändern über „Typ ändern“
            </Typography>
          </div>
          {DIMENSIONS.map((dimension) => {
            const label = CLASSIFICATION_FIELD_LABELS[dimension];
            const error = errorField === dimension && reason && reason !== "action-failed" ? classificationErrorMessage(reason) : undefined;
            const automatic = automaticLabel(classification[dimension]);
            const options = SELECT_OPTIONS[dimension];
            if (options) {
              const current = values[dimension];
              const all = current && !options.includes(current) ? [...options, current] : options;
              return (
                <TextField
                  key={dimension}
                  select
                  name={dimension}
                  label={label}
                  value={current}
                  onChange={set(dimension)}
                  error={Boolean(error)}
                  helperText={error}
                  fullWidth
                  slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                >
                  <MenuItem value="" sx={TOUCH_TARGET}>
                    {automatic}
                  </MenuItem>
                  {all.map((option) => (
                    <MenuItem key={option} value={option} sx={TOUCH_TARGET}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
              );
            }
            return (
              <TextField
                key={dimension}
                name={dimension}
                label={label}
                value={values[dimension]}
                onChange={set(dimension)}
                error={Boolean(error)}
                helperText={error ?? automatic}
                placeholder="Automatisch"
                fullWidth
                slotProps={{ htmlInput: { maxLength: dimension === "currency" ? 3 : 80 }, inputLabel: { shrink: true } }}
              />
            );
          })}
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

/** Button that opens "Klassifizierung bearbeiten": manual overrides per dimension ("Automatisch" = none). */
export function ClassificationButton({ security, classification }: { security: ClassifiedSecurity; classification: Classification }) {
  const dialog = useDialog();
  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={dialog.show}
        aria-label={`Klassifizierung bearbeiten – ${security.name}`}
        sx={TOUCH_TARGET}
      >
        Klassifizierung
      </Button>
      <SecurityDialog open={dialog.open} onClose={dialog.hide} title="Klassifizierung bearbeiten">
        <ClassificationForm key={dialog.session} security={security} classification={classification} onClose={dialog.hide} />
      </SecurityDialog>
    </>
  );
}
