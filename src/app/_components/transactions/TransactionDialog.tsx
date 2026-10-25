"use client";

import Alert from "@mui/material/Alert";
import Autocomplete, { createFilterOptions } from "@mui/material/Autocomplete";
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
import { recordTransactionAction, type TransactionActionState } from "@/app/_actions/transactions";
import type { SecuritySummary, TransactionType } from "@/modules/ledger";
import { cashPreview } from "./cash-preview";
import { NEW_SECURITY_MARKER, TRADE_FIELDS } from "./form-fields";
import { errorPlacement, FORM_SECTIONS, type FormSection, securityMode } from "./transaction-form";
import {
  ASSET_TYPE_LABELS,
  NEW_SECURITY_ASSET_TYPES,
  TRANSACTION_TYPE_ORDER,
  transactionErrorField,
  transactionErrorMessage,
  type TransactionField,
  transactionTypeLabel,
} from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

type SecurityOption = { kind: "security"; security: SecuritySummary } | { kind: "new" };

const NEW_OPTION: SecurityOption = { kind: "new" };
const NEW_LABEL = "Neue Security anlegen";

function optionLabel(option: SecurityOption): string {
  if (option.kind === "new") return NEW_LABEL;
  const { name, isin, cryptoSymbol } = option.security;
  return `${name} (${isin ?? cryptoSymbol ?? ""})`;
}

const baseFilter = createFilterOptions<SecurityOption>({
  // Case-insensitive substring match over ISIN, crypto symbol and name.
  stringify: (option) =>
    option.kind === "new"
      ? ""
      : [option.security.isin, option.security.cryptoSymbol, option.security.name].filter(Boolean).join(" "),
});

/** Matching Securities, then always "Neue Security anlegen" as the last option. */
function filterSecurityOptions(options: SecurityOption[], state: Parameters<typeof baseFilter>[1]): SecurityOption[] {
  const securities = options.filter((option) => option.kind === "security");
  return [...baseFilter(securities, state), NEW_OPTION];
}

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


/**
 * "Neue Buchung" form for all Transaction types: the type comes first and the fields adapt to it.
 * Inputs are controlled so they keep their values after an error; success closes the dialog. The
 * server action parses German decimals and calls only the ledger. The cash effect updates live.
 */
function TransactionForm({
  depotId,
  securities,
  today,
  onSuccess,
  onCancel,
}: {
  depotId: string;
  securities: SecuritySummary[];
  today: string;
  onSuccess: () => void;
  onCancel: () => void;
}) {
  const typeLabelId = useId();
  const typeErrorId = useId();
  const previewId = useId();
  const [type, setType] = useState<TransactionType>("BUY");
  const [security, setSecurity] = useState<SecurityOption | null>(null);
  const [securityInput, setSecurityInput] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("");
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [fee, setFee] = useState("");
  const [tax, setTax] = useState("");
  const [amount, setAmount] = useState("");
  const [submittedType, setSubmittedType] = useState<TransactionType>("BUY");

  const [state, formAction, pending] = useActionState<TransactionActionState, FormData>(async (previous, formData) => {
    setSubmittedType(formData.get(TRADE_FIELDS.type) as TransactionType);
    const result = await recordTransactionAction(previous, formData);
    if (result?.ok) onSuccess();
    return result;
  }, null);

  const sections = FORM_SECTIONS[type];
  const failure = state && !state.ok ? state : undefined;
  const message = failure
    ? transactionErrorMessage(failure.reason, "available" in failure ? failure.available : undefined, submittedType)
    : undefined;
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
          <input type="hidden" name={TRADE_FIELDS.depotId} value={depotId} />
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
      <DialogActions sx={{ px: 3, pb: 2, mt: "auto" }}>
        <Button onClick={onCancel} disabled={pending} sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
          Buchen
        </Button>
      </DialogActions>
    </Box>
  );
}

/** Button that opens the "Neue Buchung" dialog (full-screen below `sm`). Each opening starts fresh. */
export function NewTransactionButton({
  depotId,
  securities,
  today,
}: {
  depotId: string;
  securities: SecuritySummary[];
  /** Default "Datum": today's Europe/Berlin business date, computed on the server. */
  today: string;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const hide = () => setOpen(false);
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
      <Dialog open={open} onClose={hide} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby={titleId}>
        <DialogTitle id={titleId}>Neue Buchung</DialogTitle>
        <TransactionForm
          key={session}
          depotId={depotId}
          securities={securities}
          today={today}
          onSuccess={hide}
          onCancel={hide}
        />
      </Dialog>
    </>
  );
}
