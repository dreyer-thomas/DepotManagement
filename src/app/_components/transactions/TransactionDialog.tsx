"use client";

import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import FormLabel from "@mui/material/FormLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useActionState, useId, useState } from "react";
import {
  deleteTransactionAction,
  type DeleteTransactionActionState,
  saveTransactionAction,
  type TransactionActionState,
} from "@/app/_actions/transactions";
import {
  filterSecurityOptions,
  NEW_OPTION,
  optionLabel,
  type SecurityOption,
} from "@/app/_components/securities/security-options";
import type { SecuritySummary, TransactionRecord, TransactionType } from "@/modules/ledger";
import { cashPreview } from "./cash-preview";
import { ALLOW_DUPLICATE_MARKER, NEW_SECURITY_MARKER, TRADE_FIELDS } from "./form-fields";
import {
  deleteConfirmText,
  duplicateWarning,
  emptyValues,
  errorPlacement,
  formDataKey,
  FORM_SECTIONS,
  type FormSection,
  initialValues,
  securityKey,
  securityMode,
  submitDecision,
  valuesKey,
} from "./transaction-form";
import {
  ASSET_TYPE_LABELS,
  failureDetail,
  NEW_SECURITY_ASSET_TYPES,
  TRANSACTION_TYPE_ORDER,
  transactionErrorField,
  transactionErrorMessage,
  type TransactionField,
  transactionTypeLabel,
} from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

const decimalInput = { htmlInput: { inputMode: "decimal" as const, autoComplete: "off" } };

/** Seven types wrap onto several rows, so each button gets its own border instead of the joined group look. */
const TYPE_GROUP = {
  flexWrap: "wrap",
  gap: 1,
  "&& .MuiToggleButtonGroup-grouped": {
    flex: "1 0 auto",
    m: 0,
    px: 1.5,
    border: 1,
    borderColor: "divider",
    borderRadius: 1,
  },
  "&& .MuiToggleButtonGroup-grouped.Mui-selected": { borderColor: "primary.main" },
} as const;


/** The Depot a Transaction belongs to; its name appears in the delete confirmation. */
export type DialogDepot = { id: string; name: string };

/**
 * Transaction form for all types, new (`transaction` absent) or edit (prefilled from `transaction`):
 * the type comes first and the fields adapt to it. Inputs are controlled so they keep their values
 * after an error; success closes the dialog. The server action parses German decimals and calls only
 * the ledger. The cash effect updates live. A possible duplicate shows an inline warning and turns the
 * submit button into "Trotzdem buchen". In edit mode, "Löschen" switches the same dialog to a confirm
 * view. Renders the dialog's title and content.
 */
function TransactionForm({
  depot,
  securities,
  today,
  transaction,
  titleId,
  onSuccess,
  onCancel,
}: {
  depot: DialogDepot;
  securities: SecuritySummary[];
  today: string;
  transaction?: TransactionRecord;
  titleId: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const typeLabelId = useId();
  const typeErrorId = useId();
  const previewId = useId();
  const [initial] = useState(() => (transaction ? initialValues(transaction) : emptyValues(today)));
  const [type, setType] = useState<TransactionType>(initial.type);
  const [security, setSecurity] = useState<SecurityOption | null>(
    initial.security ? { kind: "security", security: initial.security } : null,
  );
  const [securityInput, setSecurityInput] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("");
  const [date, setDate] = useState(initial.date);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [price, setPrice] = useState(initial.price);
  const [fee, setFee] = useState(initial.fee);
  const [tax, setTax] = useState(initial.tax);
  const [amount, setAmount] = useState(initial.amount);
  const [submittedType, setSubmittedType] = useState<TransactionType>(initial.type);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [state, formAction, pending] = useActionState<TransactionActionState, FormData>(async (previous, formData) => {
    setSubmittedType(formData.get(TRADE_FIELDS.type) as TransactionType);
    setSubmittedKey(formDataKey(formData));
    const result = await saveTransactionAction(previous, formData);
    if (result?.ok) onSuccess();
    return result;
  }, null);

  const [deleteState, deleteAction, deleting] = useActionState<DeleteTransactionActionState, FormData>(async () => {
    if (!transaction) return null;
    const result = await deleteTransactionAction(transaction.id);
    if (result?.ok) onSuccess();
    return result;
  }, null);

  if (transaction && confirmingDelete) {
    const deleteFailure = deleteState && !deleteState.ok ? deleteState : undefined;
    return (
      <>
        <DialogTitle id={titleId}>Buchung löschen</DialogTitle>
        <Box
          component="form"
          action={deleteAction}
          sx={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}
        >
          <DialogContent sx={{ pt: 1 }}>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {deleteFailure ? (
                <Alert severity="error" role="alert">
                  {transactionErrorMessage(deleteFailure.reason, failureDetail(deleteFailure))}
                </Alert>
              ) : null}
              <Typography>{deleteConfirmText(transaction, depot.name)}</Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2, mt: "auto" }}>
            <Button onClick={() => setConfirmingDelete(false)} disabled={deleting} sx={TOUCH_TARGET} autoFocus>
              Abbrechen
            </Button>
            <Button type="submit" variant="contained" color="error" disabled={deleting} sx={TOUCH_TARGET}>
              Löschen
            </Button>
          </DialogActions>
        </Box>
      </>
    );
  }

  const sections = FORM_SECTIONS[type];
  const rawFailure = state && !state.ok ? state : undefined;
  // A possible duplicate is a warning, not an error; it stays active only for the values it was found for.
  const currentKey = valuesKey({
    type,
    date,
    quantity,
    price,
    fee,
    tax,
    amount,
    security: securityKey(
      security?.kind === "security"
        ? { id: security.security.id }
        : security?.kind === "new"
          ? { identifier, name, assetType }
          : null,
    ),
  });
  const decision = submitDecision({
    editing: Boolean(transaction),
    warnedKey: rawFailure?.reason === "possible-duplicate" ? submittedKey : null,
    currentKey,
  });
  const duplicate = decision.duplicateActive && rawFailure?.reason === "possible-duplicate" ? rawFailure : undefined;
  const failure = rawFailure?.reason === "possible-duplicate" ? undefined : rawFailure;
  const message = failure ? transactionErrorMessage(failure.reason, failureDetail(failure), submittedType) : undefined;
  const placement = failure
    ? errorPlacement(type, submittedType, transactionErrorField(failure.reason, submittedType))
    : ({ kind: "none" } as const);
  const errorFor = (field: TransactionField) =>
    placement.kind === "field" && placement.field === field ? message : undefined;
  const alert = placement.kind === "alert" ? message : undefined;

  const options: SecurityOption[] = [...securities.map((s) => ({ kind: "security" as const, security: s })), NEW_OPTION];
  const hasSecurity = securityMode(type) !== "none";
  const isNew = hasSecurity && security?.kind === "new";
  const securityRequired = securityMode(type) === "required";
  const preview = cashPreview(type, { quantity, price, fee, tax, amount });

  const decimalField = (
    field: "quantity" | "price" | "fee" | "tax" | "amount",
    label: string,
    value: string,
    set: (v: string) => void,
    { required = false, helper }: { required?: boolean; helper?: string } = {},
  ) => (
    <TextField
      name={TRADE_FIELDS[field]}
      label={label}
      value={value}
      onChange={(event) => set(event.target.value)}
      error={Boolean(errorFor(field))}
      helperText={errorFor(field) ?? helper}
      required={required}
      fullWidth
      slotProps={decimalInput}
    />
  );

  const securityFields = (
    <Stack key="security" spacing={2}>
      <Autocomplete
        options={options}
        value={security}
        onChange={(_event, value) => setSecurity(value)}
        inputValue={securityInput}
        onInputChange={(_event, value) => setSecurityInput(value)}
        getOptionLabel={optionLabel}
        filterOptions={filterSecurityOptions}
        isOptionEqualToValue={(option, value) =>
          option.kind === value.kind && (option.kind === "new" || option.security.id === (value as typeof option).security.id)
        }
        getOptionKey={(option) => (option.kind === "new" ? "__new__" : option.security.id)}
        renderOption={({ key, ...props }, option) => (
          <li key={key} {...props} style={{ minHeight: 44, fontWeight: option.kind === "new" ? 600 : undefined }}>
            {optionLabel(option)}
          </li>
        )}
        openText="Öffnen"
        closeText="Schließen"
        clearText="Leeren"
        renderInput={(params) => (
          <TextField
            {...params}
            label={securityRequired ? "Security" : "Security (optional)"}
            placeholder="ISIN, Krypto-Symbol oder Name"
            required={securityRequired}
            error={Boolean(errorFor("security"))}
            helperText={errorFor("security")}
          />
        )}
      />

      {isNew ? (
        <>
          <TextField
            name={TRADE_FIELDS.securityIdentifier}
            label="ISIN oder Krypto-Symbol"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            error={Boolean(errorFor("securityIdentifier"))}
            helperText={errorFor("securityIdentifier")}
            required
            fullWidth
            slotProps={{ htmlInput: { autoComplete: "off", autoCapitalize: "characters" } }}
          />
          <TextField
            name={TRADE_FIELDS.securityName}
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={Boolean(errorFor("securityName"))}
            helperText={errorFor("securityName")}
            required
            fullWidth
            slotProps={{ htmlInput: { autoComplete: "off" } }}
          />
          <TextField
            select
            name={TRADE_FIELDS.assetType}
            label="Art"
            value={assetType}
            onChange={(event) => setAssetType(event.target.value)}
            error={Boolean(errorFor("assetType"))}
            helperText={errorFor("assetType")}
            required
            fullWidth
          >
            {NEW_SECURITY_ASSET_TYPES.map((value) => (
              <MenuItem key={value} value={value} sx={TOUCH_TARGET}>
                {ASSET_TYPE_LABELS[value]}
              </MenuItem>
            ))}
          </TextField>
        </>
      ) : null}
    </Stack>
  );

  const renderSection = (section: FormSection) => {
    switch (section) {
      case "security":
        return securityFields;
      case "date":
        return (
          <TextField
            key="date"
            name={TRADE_FIELDS.date}
            type="date"
            label="Datum"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            error={Boolean(errorFor("date"))}
            helperText={errorFor("date")}
            required
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        );
      case "quantityPrice":
        return (
          <Stack key="quantityPrice" direction={{ xs: "column", sm: "row" }} spacing={2}>
            {decimalField("quantity", "Stück", quantity, setQuantity, { required: true })}
            {decimalField("price", "Kurs", price, setPrice, { required: true })}
          </Stack>
        );
      case "feeTax":
        return (
          <Stack key="feeTax" direction={{ xs: "column", sm: "row" }} spacing={2}>
            {decimalField("fee", "Gebühren", fee, setFee)}
            {decimalField("tax", "Steuern", tax, setTax)}
          </Stack>
        );
      case "amount":
        return (
          <Box key="amount">
            {decimalField("amount", type === "DIVIDEND" ? "Bruttobetrag" : "Betrag", amount, setAmount, {
              required: true,
              helper: type === "TAX" ? "Negativ = Erstattung" : undefined,
            })}
          </Box>
        );
      case "tax":
        return <Box key="tax">{decimalField("tax", "Steuern", tax, setTax)}</Box>;
    }
  };

  return (
    <>
      <DialogTitle id={titleId}>{transaction ? "Buchung bearbeiten" : "Neue Buchung"}</DialogTitle>
      <Box
        component="form"
        action={formAction}
        noValidate
        sx={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}
      >
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {alert ? (
              <Alert severity="error" role="alert">
                {alert}
              </Alert>
            ) : null}
            {duplicate ? (
              <Alert severity="warning" role="alert">
                {duplicateWarning(duplicate)}
              </Alert>
            ) : null}
            <input type="hidden" name={TRADE_FIELDS.depotId} value={depot.id} />
            {transaction && decision.sendTransactionId ? (
              <input type="hidden" name={TRADE_FIELDS.transactionId} value={transaction.id} />
            ) : null}
            {decision.allowDuplicate ? <input type="hidden" name={TRADE_FIELDS.allowDuplicate} value={ALLOW_DUPLICATE_MARKER} /> : null}
            <input type="hidden" name={TRADE_FIELDS.type} value={type} />
            {hasSecurity && security?.kind === "security" ? <input type="hidden" name={TRADE_FIELDS.securityId} value={security.security.id} /> : null}
            {isNew ? <input type="hidden" name={TRADE_FIELDS.newSecurity} value={NEW_SECURITY_MARKER} /> : null}

            <FormControl error={Boolean(errorFor("type"))}>
              <FormLabel id={typeLabelId} sx={{ mb: 0.5 }}>
                Art der Buchung
              </FormLabel>
              <ToggleButtonGroup
                exclusive
                color="primary"
                value={type}
                onChange={(_event, value: TransactionType | null) => {
                  if (value) setType(value);
                }}
                aria-labelledby={typeLabelId}
                aria-describedby={errorFor("type") ? typeErrorId : undefined}
                sx={TYPE_GROUP}
              >
                {TRANSACTION_TYPE_ORDER.map((value) => (
                  <ToggleButton key={value} value={value} sx={TOUCH_TARGET}>
                    {transactionTypeLabel(value)}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              {errorFor("type") ? <FormHelperText id={typeErrorId}>{errorFor("type")}</FormHelperText> : null}
            </FormControl>

            {sections.map(renderSection)}
            <Typography
              id={previewId}
              aria-live="polite"
              sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
            >
              Cash-Effekt: {preview}
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, mt: "auto", flexWrap: "wrap", rowGap: 1 }}>
          {transaction ? (
            <Button
              color="error"
              onClick={() => setConfirmingDelete(true)}
              disabled={pending}
              sx={{ ...TOUCH_TARGET, mr: "auto" }}
            >
              Löschen
            </Button>
          ) : null}
          <Button onClick={onCancel} disabled={pending} sx={TOUCH_TARGET}>
            Abbrechen
          </Button>
          <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
            {decision.label}
          </Button>
        </DialogActions>
      </Box>
    </>
  );
}

/**
 * The Transaction dialog (full-screen below `sm`): "Neue Buchung" without `transaction`, else
 * "Buchung bearbeiten". Change `formKey` to start a fresh form.
 */
export function TransactionDialog({
  open,
  onClose,
  formKey,
  depot,
  securities,
  today,
  transaction,
}: {
  open: boolean;
  onClose: () => void;
  formKey: number;
  depot: DialogDepot;
  securities: SecuritySummary[];
  today: string;
  transaction?: TransactionRecord;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      <TransactionForm
        key={formKey}
        depot={depot}
        securities={securities}
        today={today}
        transaction={transaction}
        titleId={titleId}
        onSuccess={onClose}
        onCancel={onClose}
      />
    </Dialog>
  );
}

/** Button that opens the "Neue Buchung" dialog. Each opening starts fresh. */
export function NewTransactionButton({
  depot,
  securities,
  today,
}: {
  depot: DialogDepot;
  securities: SecuritySummary[];
  /** Default "Datum": today's Europe/Berlin business date, computed on the server. */
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return (
    <>
      <Button
        variant="contained"
        onClick={() => {
          setSession((value) => value + 1);
          setOpen(true);
        }}
        sx={TOUCH_TARGET}
      >
        Neue Buchung
      </Button>
      <TransactionDialog
        open={open}
        onClose={() => setOpen(false)}
        formKey={session}
        depot={depot}
        securities={securities}
        today={today}
      />
    </>
  );
}
