"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useActionState, useState } from "react";
import { type SetTaxAllowancesActionState, setTaxAllowancesAction } from "@/app/_actions/tax";
import type { Broker } from "@/modules/ledger";
import { BROKER_LABELS } from "../depots/labels";
import {
  ALLOWANCE_AMOUNT_ERROR,
  ALLOWANCE_LIMIT_HINT,
  ALLOWANCE_YEAR_ERROR,
  allowanceExceedsLimit,
  amountInputText,
  enteredAllowanceSum,
  TAX_ACTION_FAILED,
  TAX_BROKERS,
  TAX_SAVED,
  TAX_UNAUTHORIZED,
} from "./labels";

type ActionState = SetTaxAllowancesActionState | { ok: false; reason: "action-failed" };

export type AllowanceEntry = { broker: Broker; year: number; amount: string };

const CONTROL = { minHeight: 44 } as const;

function AllowanceFields({ year, allowances }: { year: number; allowances: readonly AllowanceEntry[] }) {
  const [values, setValues] = useState<Record<Broker, string>>(
    () =>
      Object.fromEntries(
        TAX_BROKERS.map((broker) => [broker, amountInputText(allowances.find((entry) => entry.broker === broker && entry.year === year)?.amount)]),
      ) as Record<Broker, string>,
  );
  const [state, formAction, pending] = useActionState<ActionState, FormData>(async (previous, formData) => {
    try {
      return await setTaxAllowancesAction(previous as SetTaxAllowancesActionState, formData);
    } catch {
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const failure = state && !state.ok ? state : null;
  const fieldError = (broker: Broker) =>
    failure && failure.reason === "amount-invalid" && "broker" in failure && failure.broker === broker ? ALLOWANCE_AMOUNT_ERROR : undefined;
  const alert =
    failure === null || failure.reason === "amount-invalid"
      ? undefined
      : failure.reason === "year-invalid"
        ? ALLOWANCE_YEAR_ERROR
        : failure.reason === "unauthorized"
          ? TAX_UNAUTHORIZED
          : TAX_ACTION_FAILED;
  const exceeds = allowanceExceedsLimit(enteredAllowanceSum(Object.values(values)));

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="year" value={String(year)} />
      <Stack spacing={2}>
        {alert ? (
          <Alert severity="error" role="alert">
            {alert}
          </Alert>
        ) : null}
        {TAX_BROKERS.map((broker) => {
          const error = fieldError(broker);
          return (
            <TextField
              key={broker}
              name={`amount-${broker}`}
              label={`${BROKER_LABELS[broker]} (€)`}
              value={values[broker]}
              onChange={(event) => setValues((current) => ({ ...current, [broker]: event.target.value }))}
              error={Boolean(error)}
              helperText={error}
              placeholder="0"
              fullWidth
              slotProps={{ htmlInput: { inputMode: "decimal" }, inputLabel: { shrink: true } }}
              sx={{ maxWidth: { sm: 320 }, "& .MuiInputBase-root": CONTROL }}
            />
          );
        })}
        {exceeds ? (
          <Alert severity="warning" role="status">
            {ALLOWANCE_LIMIT_HINT}
          </Alert>
        ) : null}
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <Button type="submit" variant="contained" disabled={pending} sx={CONTROL}>
            Speichern
          </Button>
          {state?.ok ? (
            <Typography variant="body2" role="status">
              {TAX_SAVED}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </form>
  );
}

/**
 * Settings › Steuern: the Freistellungsauftrag per broker for a chosen year (today's year + 1 down to the
 * first ledger year). Each year change remounts the fields with that year's stored amounts. An empty field
 * or 0 removes the amount; a sum above 1.000 € shows a hint live.
 */
export function AllowanceForm({ allowances, firstYear, todayYear }: { allowances: readonly AllowanceEntry[]; firstYear: number; todayYear: number }) {
  const [year, setYear] = useState(todayYear);
  const years: number[] = [];
  for (let option = todayYear + 1; option >= Math.min(firstYear, todayYear); option -= 1) years.push(option);
  return (
    <Stack spacing={2}>
      <TextField
        select
        label="Jahr"
        value={String(year)}
        onChange={(event) => setYear(Number(event.target.value))}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ width: { xs: "100%", sm: 160 }, "& .MuiInputBase-root": CONTROL }}
      >
        {years.map((option) => (
          <MenuItem key={option} value={String(option)} sx={CONTROL}>
            {option}
          </MenuItem>
        ))}
      </TextField>
      <AllowanceFields key={year} year={year} allowances={allowances} />
    </Stack>
  );
}
