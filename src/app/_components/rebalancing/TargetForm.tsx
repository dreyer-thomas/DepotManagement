"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useActionState, useState } from "react";
import { type SetTargetAllocationActionState, setTargetAllocationAction } from "@/app/_actions/rebalancing";
import type { Segment, Targets } from "@/core/rebalancing";
import { enteredTargetSum, percentInputText, SEGMENT_KEYS, SEGMENT_LABELS, sumText, TARGET_ERRORS, TARGET_SAVED, THRESHOLD_LABEL, thresholdInputText } from "./labels";

type ActionState = SetTargetAllocationActionState | { ok: false; reason: "action-failed" };

const CONTROL = { minHeight: 44 } as const;

/**
 * Analysen › Zielallokation: one `%` field per segment (prefilled with the scope's stored targets; empty = 0),
 * a live "Summe", the threshold in percentage points and "Speichern". The parent remounts it per scope.
 */
export function TargetForm({ scope, targets, threshold }: { scope: string; targets: Targets | null; threshold: string }) {
  const [values, setValues] = useState<Record<Segment, string>>(
    () => Object.fromEntries(SEGMENT_KEYS.map((segment) => [segment, percentInputText(targets?.[segment])])) as Record<Segment, string>,
  );
  const [thresholdText, setThresholdText] = useState(thresholdInputText(threshold));
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    try {
      return await setTargetAllocationAction(previous as SetTargetAllocationActionState, formData);
    } catch {
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const failure = state && !state.ok ? state : null;
  const fieldError = (segment: Segment) =>
    failure?.reason === "target-invalid" && "segment" in failure && failure.segment === segment ? TARGET_ERRORS["target-invalid"] : undefined;
  const thresholdError = failure?.reason === "threshold-invalid" ? TARGET_ERRORS["threshold-invalid"] : undefined;
  const alert = failure === null || failure.reason === "target-invalid" || failure.reason === "threshold-invalid" ? undefined : TARGET_ERRORS[failure.reason];

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="scope" value={scope} />
      <Stack spacing={2}>
        {alert ? (
          <Alert severity="error" role="alert">
            {alert}
          </Alert>
        ) : null}
        <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" } }}>
          {SEGMENT_KEYS.map((segment) => {
            const error = fieldError(segment);
            return (
              <TextField
                key={segment}
                name={`target-${segment}`}
                label={`${SEGMENT_LABELS[segment]} (%)`}
                value={values[segment]}
                onChange={(event) => setValues((current) => ({ ...current, [segment]: event.target.value }))}
                error={Boolean(error)}
                helperText={error}
                placeholder="0"
                fullWidth
                slotProps={{ htmlInput: { inputMode: "decimal" }, inputLabel: { shrink: true } }}
                sx={{ "& .MuiInputBase-root": CONTROL }}
              />
            );
          })}
        </Box>
        <Typography variant="body2" role="status" aria-live="polite" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
          {sumText(enteredTargetSum(Object.values(values)))}
        </Typography>
        <TextField
          name="threshold"
          label={THRESHOLD_LABEL}
          value={thresholdText}
          onChange={(event) => setThresholdText(event.target.value)}
          error={Boolean(thresholdError)}
          helperText={thresholdError}
          placeholder="2"
          slotProps={{ htmlInput: { inputMode: "decimal" }, inputLabel: { shrink: true } }}
          sx={{ maxWidth: { sm: 320 }, "& .MuiInputBase-root": CONTROL }}
        />
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Button type="submit" variant="contained" disabled={pending} sx={CONTROL}>
            Speichern
          </Button>
          {state?.ok ? (
            <Typography variant="body2" role="status">
              {TARGET_SAVED}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </form>
  );
}
