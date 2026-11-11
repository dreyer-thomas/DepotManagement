"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { parseDecimalInput } from "@/core/decimal-input";
import {
  PRICE_MARK_SOURCE_MAX_LENGTH,
  type PriceMarkField,
  type PriceMarkProblem,
  type PriceMarks,
  type PriceMarksForm,
  priceMarkWarnings,
  type StopType,
} from "@/core/price-marks";
import { PRICE_MARK_FIELDS, PRICE_MARKS_MARKER } from "./form-fields";
import {
  type AnalystTargetSuggestion,
  analystTargetButtonLabel,
  analystTargetHint,
  decimalInputText,
  latestPriceNote,
  priceMarkErrorMessage,
  priceMarkWarningText,
  STOP_TYPE_OPTIONS,
} from "./labels";

export type { AnalystTargetSuggestion } from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

/** What an editing surface needs of a Security's marks: the stored marks, the latest Price, the analyst target. */
export type PriceMarksEditInfo = {
  marks: PriceMarks | null;
  /** Latest resolved Price in today's units (`PriceMarkState.price`); `null` without one. */
  latestPrice: string | null;
  /** Mean analyst price target with its currency; `null` without one. */
  analystTarget: AnalystTargetSuggestion | null;
};

/** A refused marks field as the action reports it. */
export type PriceMarksFieldError = { field: PriceMarkField; problem: PriceMarkProblem };

/** The form values of `marks` (German decimals); set dates default to `today`. */
export function initialPriceMarksForm(marks: PriceMarks | null, today: string): PriceMarksForm {
  return {
    stopType: marks?.stop?.type ?? "",
    stopValue: marks?.stop ? decimalInputText(marks.stop.value) : "",
    stopSource: marks?.stop?.source ?? "",
    stopSetDate: marks?.stop?.setDate ?? today,
    targetPrice: marks?.target ? decimalInputText(marks.target.price) : "",
    targetSource: marks?.target?.source ?? "",
    targetSetDate: marks?.target?.setDate ?? today,
  };
}

/**
 * Controlled state of the marks fields. Changing a stop's kind or value, or the target price, moves that
 * mark's set date to today unless the date was edited by hand (a new level is set today).
 */
export function usePriceMarksForm(marks: PriceMarks | null, today: string) {
  const [form, setForm] = useState<PriceMarksForm>(() => initialPriceMarksForm(marks, today));
  const [dateEdited, setDateEdited] = useState({ stop: false, target: false });
  const update = (field: keyof PriceMarksForm, value: string) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if ((field === "stopType" || field === "stopValue") && !dateEdited.stop) next.stopSetDate = today;
      if (field === "targetPrice" && !dateEdited.target) next.targetSetDate = today;
      return next;
    });
    if (field === "stopSetDate") setDateEdited((current) => ({ ...current, stop: true }));
    if (field === "targetSetDate") setDateEdited((current) => ({ ...current, target: true }));
  };
  return { form, update };
}

/** A German decimal field's value, or `null` while it is empty or unparsable. */
function typedDecimal(text: string): string | null {
  const parsed = parseDecimalInput(text);
  return parsed.ok && parsed.value !== "" ? parsed.value : null;
}

/**
 * The stop and target fields (story 12.2): stop kind ("Kein Stopp", "Fester Kurs", "Nachlaufend") with its
 * price or percent, source and set date; target price, source and set date; non-blocking warnings against
 * the latest Price; the analyst mean target as a one-click fill when it is in EUR, else a hint. Carries the
 * `PRICE_MARK_FIELDS` names for the enclosing form.
 */
export function PriceMarkFields({
  form,
  onChange,
  today,
  latestPrice,
  analystTarget,
  error,
}: {
  form: PriceMarksForm;
  onChange: (field: keyof PriceMarksForm, value: string) => void;
  today: string;
  latestPrice: string | null;
  analystTarget: AnalystTargetSuggestion | null;
  error?: PriceMarksFieldError;
}) {
  const errorFor = (field: PriceMarkField) => (error?.field === field ? priceMarkErrorMessage(field, error.problem) : undefined);
  const stopType = form.stopType as StopType | "";
  const stopValue = typedDecimal(form.stopValue);
  const targetPrice = typedDecimal(form.targetPrice);
  const warnings = priceMarkWarnings(
    {
      stop: stopType !== "" && stopValue !== null ? { type: stopType, value: stopValue } : null,
      target: targetPrice !== null ? { price: targetPrice } : null,
    },
    latestPrice,
  );
  const textField = (field: keyof PriceMarksForm, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField
      name={PRICE_MARK_FIELDS[field]}
      label={label}
      value={form[field]}
      onChange={(event) => onChange(field, event.target.value)}
      error={Boolean(errorFor(field))}
      helperText={errorFor(field)}
      fullWidth
      {...extra}
    />
  );
  const dateField = (field: "stopSetDate" | "targetSetDate", label: string) =>
    textField(field, label, { type: "date", slotProps: { inputLabel: { shrink: true }, htmlInput: { max: today } } });
  const sourceField = (field: "stopSource" | "targetSource", label: string) =>
    textField(field, label, {
      helperText: errorFor(field) ?? `${form[field].length} / ${PRICE_MARK_SOURCE_MAX_LENGTH}`,
      slotProps: { htmlInput: { autoComplete: "off", maxLength: PRICE_MARK_SOURCE_MAX_LENGTH } },
    });
  return (
    <Stack spacing={2}>
      <input type="hidden" name={PRICE_MARK_FIELDS.priceMarks} value={PRICE_MARKS_MARKER} />
      <Typography variant="subtitle2" component="h3">
        Kursmarken
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {latestPriceNote(latestPrice)}
      </Typography>
      <TextField
        select
        name={PRICE_MARK_FIELDS.stopType}
        label="Stopp"
        value={form.stopType}
        onChange={(event) => onChange("stopType", event.target.value)}
        error={Boolean(errorFor("stopType"))}
        helperText={errorFor("stopType")}
        fullWidth
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
      >
        {STOP_TYPE_OPTIONS.map((option) => (
          <MenuItem key={option.value} value={option.value} sx={TOUCH_TARGET}>
            {option.label}
          </MenuItem>
        ))}
      </TextField>
      {stopType !== "" ? (
        <>
          {textField("stopValue", stopType === "FIXED" ? "Stoppkurs (€)" : "Abstand zum Hoch (%)", {
            required: true,
            slotProps: { htmlInput: { inputMode: "decimal", autoComplete: "off" } },
          })}
          {sourceField("stopSource", "Quelle des Stopps")}
          {dateField("stopSetDate", "Stopp gesetzt am")}
        </>
      ) : null}
      {textField("targetPrice", "Kursziel (€)", { slotProps: { htmlInput: { inputMode: "decimal", autoComplete: "off" } } })}
      {analystTarget === null ? null : analystTarget.currency === "EUR" ? (
        <Button
          variant="outlined"
          onClick={() => onChange("targetPrice", decimalInputText(analystTarget.mean))}
          sx={{ ...TOUCH_TARGET, alignSelf: "flex-start" }}
        >
          {analystTargetButtonLabel(analystTarget.mean)}
        </Button>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {analystTargetHint(analystTarget)}
        </Typography>
      )}
      {sourceField("targetSource", "Quelle des Ziels")}
      {dateField("targetSetDate", "Ziel gesetzt am")}
      {latestPrice !== null
        ? warnings.map((warning) => (
            <Alert key={warning} severity="warning">
              {priceMarkWarningText(warning, latestPrice)}
            </Alert>
          ))
        : null}
    </Stack>
  );
}
