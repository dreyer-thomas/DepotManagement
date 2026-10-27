"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Decimal from "decimal.js";
import { startTransition, useActionState, useState } from "react";
import { type SetRegionSplitActionState, setRegionSplitAction } from "@/app/_actions/classification";
import { parseDecimalInput } from "@/core/decimal-input";
import { formatQuantity } from "@/core/format";
import { type RegionWeights, SPLIT_REGIONS } from "@/core/region-split";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "./SecurityDialog";
import { regionSplitErrorMessage, weightPercent } from "./labels";

type ActionState = SetRegionSplitActionState | { ok: false; reason: "action-failed" };

type FundSecurity = { id: string; name: string };

/** Field values per split region (German input text), prefilled from `weights`. */
function initialValues(weights: RegionWeights | null): string[] {
  return SPLIT_REGIONS.map((region) => {
    const weight = weights?.find((entry) => entry.region === region)?.weight;
    return weight === undefined ? "" : formatQuantity(weight);
  });
}

/** "Summe: 100 %" over the readable fields; "Summe: –" while a field is not a number. */
function sumText(values: readonly string[]): string {
  let sum = new Decimal(0);
  for (const value of values) {
    const parsed = parseDecimalInput(value);
    if (!parsed.ok) return "Summe: –";
    if (parsed.value !== "") sum = sum.plus(parsed.value);
  }
  return `Summe: ${weightPercent(sum.toFixed())}`;
}

function RegionSplitForm({ security, weights, onClose }: { security: FundSecurity; weights: RegionWeights | null; onClose: () => void }) {
  const [values, setValues] = useState(() => initialValues(weights));
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    try {
      const result = await setRegionSplitAction(previous as SetRegionSplitActionState, formData);
      if (result?.ok) onClose();
      return result;
    } catch {
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const error = state && !state.ok ? regionSplitErrorMessage(state.reason) : undefined;

  // "Automatisch": submits every field empty, which removes the manual split (the rule split applies again).
  const automatic = () => {
    const data = new FormData();
    data.set("securityId", security.id);
    SPLIT_REGIONS.forEach((_, index) => data.set(`split-${index}`, ""));
    startTransition(() => formAction(data));
  };

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
          <Typography variant="body2">
            Anteile je Region in Prozent, zusammen 100 %. Leere Felder zählen als 0. „Automatisch“ verwendet die Regel-Aufteilung des Index, falls es eine gibt; sonst behält der Fonds seine einzelne Region.
          </Typography>
          {SPLIT_REGIONS.map((region, index) => (
            <TextField
              key={region}
              name={`split-${index}`}
              label={region}
              value={values[index]}
              onChange={(event) => setValues((current) => current.map((value, i) => (i === index ? event.target.value : value)))}
              fullWidth
              slotProps={{
                htmlInput: { autoComplete: "off", inputMode: "decimal" },
                input: { endAdornment: <InputAdornment position="end">%</InputAdornment> },
              }}
            />
          ))}
          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }} aria-live="polite">
            {sumText(values)}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: "wrap", gap: 1 }}>
        <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button onClick={automatic} disabled={pending} sx={TOUCH_TARGET}>
          Automatisch
        </Button>
        <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
          Speichern
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * Button "Regionen" of a fund (ETF/FUND): edits its region split as six percent fields (prefilled with the
 * effective split) with a live sum; "Speichern" stores a manual split, "Automatisch" removes it.
 */
export function RegionSplitButton({ security, weights }: { security: FundSecurity; weights: RegionWeights | null }) {
  const dialog = useDialog();
  return (
    <>
      <Button variant="outlined" size="small" onClick={dialog.show} aria-label={`Regionen bearbeiten – ${security.name}`} sx={TOUCH_TARGET}>
        Regionen
      </Button>
      <SecurityDialog open={dialog.open} onClose={dialog.hide} title="Regionen bearbeiten">
        <RegionSplitForm key={dialog.session} security={security} weights={weights} onClose={dialog.hide} />
      </SecurityDialog>
    </>
  );
}
