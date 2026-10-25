"use client";

import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useActionState, useState } from "react";
import {
  deleteIsinChangeAction,
  type DeleteIsinChangeActionState,
  type IsinChangeActionState,
  saveIsinChangeAction,
} from "@/app/_actions/corporate-actions";
import {
  filterSecurityOptions,
  NEW_OPTION,
  optionLabel,
  type SecurityOption,
} from "@/app/_components/securities/security-options";
import { ASSET_TYPE_LABELS, NEW_SECURITY_ASSET_TYPES } from "@/app/_components/transactions/labels";
import { formatDate } from "@/core/format";
import type { IsinChangeRecord, SecuritySummary } from "@/modules/ledger";
import { ISIN_CHANGE_FIELDS, NEW_SECURITY_MARKER } from "./form-fields";
import { formatIsinChangeRatio, isinChangeErrorField, isinChangeErrorMessage, isinChangesOf } from "./labels";

const TOUCH_TARGET = { minHeight: 44 };
const decimalInput = { htmlInput: { inputMode: "decimal" as const, autoComplete: "off" } };

/** The detail of a failure that carries one (the SELL's date). */
function failureDate(state: { ok: false; reason: string; date?: string }): string | undefined {
  return "date" in state ? state.date : undefined;
}

/**
 * ISIN-change form: new Security (existing or "Neue Security anlegen"), effective date, old and new
 * quantity. Records a new change of `security`, or edits `isinChange` (date and quantities; both
 * Securities stay). Inputs are controlled so they keep their text after an error; success calls `onSaved`.
 */
function IsinChangeForm({
  security,
  securities,
  isinChange,
  onSaved,
  onCancel,
}: {
  security: SecuritySummary;
  securities: SecuritySummary[];
  isinChange: IsinChangeRecord | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState<SecurityOption | null>(null);
  const [targetInput, setTargetInput] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("");
  const [date, setDate] = useState(isinChange?.date ?? "");
  const [oldQuantity, setOldQuantity] = useState(isinChange ? isinChange.oldQuantity.replace(".", ",") : "");
  const [newQuantity, setNewQuantity] = useState(isinChange ? isinChange.newQuantity.replace(".", ",") : "");
  const [state, formAction, pending] = useActionState<IsinChangeActionState, FormData>(async (previous, formData) => {
    const result = await saveIsinChangeAction(previous, formData);
    if (result?.ok) onSaved();
    return result;
  }, null);

  const failure = state && !state.ok ? state : undefined;
  const field = failure ? isinChangeErrorField(failure.reason) : undefined;
  const message = failure ? isinChangeErrorMessage(failure.reason, failureDate(failure)) : undefined;
  const errorFor = (name: typeof field) => (field === name ? message : undefined);
  const isNew = target?.kind === "new";
  const options: SecurityOption[] = [
    ...securities.filter((s) => s.id !== security.id).map((s) => ({ kind: "security" as const, security: s })),
    NEW_OPTION,
  ];

  return (
    <form action={formAction} noValidate aria-label={isinChange ? "ISIN-Wechsel bearbeiten" : "ISIN-Wechsel erfassen"}>
      <input type="hidden" name={ISIN_CHANGE_FIELDS.oldSecurityId} value={security.id} />
      {isinChange ? <input type="hidden" name={ISIN_CHANGE_FIELDS.isinChangeId} value={isinChange.id} /> : null}
      {!isinChange && target?.kind === "security" ? (
        <input type="hidden" name={ISIN_CHANGE_FIELDS.newSecurityId} value={target.security.id} />
      ) : null}
      {!isinChange && isNew ? <input type="hidden" name={ISIN_CHANGE_FIELDS.newSecurity} value={NEW_SECURITY_MARKER} /> : null}
      <Stack spacing={2} sx={{ pt: 1 }}>
        {message && !field ? (
          <Alert severity="error" role="alert">
            {message}
          </Alert>
        ) : null}
        {isinChange ? (
          <Typography variant="body2">
            {isinChange.oldSecurity.name} → {isinChange.newSecurity.name}
          </Typography>
        ) : (
          <>
            <Autocomplete
              options={options}
              value={target}
              onChange={(_event, value) => setTarget(value)}
              inputValue={targetInput}
              onInputChange={(_event, value) => setTargetInput(value)}
              getOptionLabel={optionLabel}
              filterOptions={filterSecurityOptions}
              isOptionEqualToValue={(option, value) =>
                option.kind === value.kind &&
                (option.kind === "new" || option.security.id === (value as typeof option).security.id)
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
                  label="Neue Security"
                  placeholder="ISIN, Krypto-Symbol oder Name"
                  required
                  autoFocus
                  error={Boolean(errorFor("newSecurity"))}
                  helperText={errorFor("newSecurity")}
                />
              )}
            />
            {isNew ? (
              <>
                <TextField
                  name={ISIN_CHANGE_FIELDS.securityIdentifier}
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
                  name={ISIN_CHANGE_FIELDS.securityName}
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
                  name={ISIN_CHANGE_FIELDS.assetType}
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
          </>
        )}
        <TextField
          name={ISIN_CHANGE_FIELDS.date}
          label="Gültig ab"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          error={Boolean(errorFor("date"))}
          helperText={errorFor("date")}
          autoFocus={Boolean(isinChange)}
          required
          fullWidth
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <Stack direction="row" spacing={2}>
          <TextField
            name={ISIN_CHANGE_FIELDS.oldQuantity}
            label="Alte Stückzahl"
            placeholder="1"
            value={oldQuantity}
            onChange={(event) => setOldQuantity(event.target.value)}
            error={Boolean(errorFor("oldQuantity"))}
            helperText={errorFor("oldQuantity")}
            required
            fullWidth
            slotProps={decimalInput}
          />
          <TextField
            name={ISIN_CHANGE_FIELDS.newQuantity}
            label="Neue Stückzahl"
            placeholder="1"
            value={newQuantity}
            onChange={(event) => setNewQuantity(event.target.value)}
            error={Boolean(errorFor("newQuantity"))}
            helperText={errorFor("newQuantity")}
            required
            fullWidth
            slotProps={decimalInput}
          />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          <Button onClick={onCancel} disabled={pending} sx={TOUCH_TARGET}>
            {isinChange ? "Bearbeitung abbrechen" : "Abbrechen"}
          </Button>
          <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
            {isinChange ? "Speichern" : "ISIN-Wechsel erfassen"}
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}

/** One recorded ISIN change with Bearbeiten / Löschen; Löschen asks for confirmation inline. */
function IsinChangeRow({
  isinChange,
  onEdit,
  disabled,
}: {
  isinChange: IsinChangeRecord;
  onEdit: () => void;
  disabled: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, deleteAction, deleting] = useActionState<DeleteIsinChangeActionState, FormData>(
    () => deleteIsinChangeAction(isinChange.id),
    null,
  );
  const failure = state && !state.ok ? isinChangeErrorMessage(state.reason, failureDate(state)) : undefined;
  const label = `ISIN-Wechsel vom ${formatDate(isinChange.date)} (${isinChange.oldSecurity.name} → ${isinChange.newSecurity.name})`;
  return (
    <Box component="li" sx={{ py: 1, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 160 }}>
          <Typography sx={{ fontVariantNumeric: "tabular-nums" }}>
            {formatDate(isinChange.date)} · {formatIsinChangeRatio(isinChange)}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {isinChange.oldSecurity.name} → {isinChange.newSecurity.name}
          </Typography>
        </Box>
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
 * "ISIN-Wechsel – {Security}" dialog: records an ISIN change of the Security, and lists the changes in
 * which it is the old or new Security with edit and delete. Full-screen below `sm`; Esc and a backdrop
 * click close it.
 */
export function IsinChangeDialog({
  open,
  onClose,
  security,
  isinChanges,
  securities,
}: {
  open: boolean;
  onClose: () => void;
  security: SecuritySummary;
  /** Recorded ISIN changes (any Security); only those involving `security` are listed. */
  isinChanges: IsinChangeRecord[];
  /** Every Security; all but `security` are offered as the new one. */
  securities: SecuritySummary[];
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const [editing, setEditing] = useState<IsinChangeRecord | null>(null);
  const [formKey, setFormKey] = useState(0);
  const own = isinChangesOf(isinChanges, security.id);
  const titleId = `isin-change-dialog-title-${security.id}`;
  const resetForm = () => {
    setEditing(null);
    setFormKey((value) => value + 1);
  };
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="xs" aria-labelledby={titleId}>
      <DialogTitle id={titleId}>ISIN-Wechsel – {security.name}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <IsinChangeForm
          key={`${formKey}-${editing?.id ?? "new"}`}
          security={editing ? editing.oldSecurity : security}
          securities={securities}
          isinChange={editing}
          onSaved={editing ? resetForm : onClose}
          onCancel={editing ? resetForm : onClose}
        />
        <Divider sx={{ my: 2 }} />
        <Typography id={`${titleId}-list`} component="h3" variant="subtitle2" sx={{ fontWeight: 600 }}>
          Erfasste ISIN-Wechsel
        </Typography>
        {own.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Noch keine ISIN-Wechsel erfasst.
          </Typography>
        ) : (
          <Box component="ul" aria-labelledby={`${titleId}-list`} sx={{ listStyle: "none", m: 0, p: 0 }}>
            {own.map((change) => (
              <IsinChangeRow
                key={`${change.id}-${change.date}-${change.oldQuantity}-${change.newQuantity}`}
                isinChange={change}
                disabled={editing?.id === change.id}
                onEdit={() => {
                  setEditing(change);
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
