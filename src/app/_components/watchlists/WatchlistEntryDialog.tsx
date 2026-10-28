"use client";

import AddOutlined from "@mui/icons-material/AddOutlined";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { type ReactNode, useActionState, useId, useState, useTransition } from "react";
import {
  type AddWatchlistEntryActionState,
  addWatchlistEntryAction,
  type RemoveWatchlistEntryActionResult,
  removeWatchlistEntryAction,
  type UpdateWatchlistEntryActionState,
  updateWatchlistEntryAction,
} from "@/app/_actions/watchlists";
import { filterSecurityOptions, NEW_OPTION, optionLabel, type SecurityOption } from "@/app/_components/securities/security-options";
import { WATCHLIST_NOTE_MAX_LENGTH } from "@/core/watchlist";
import type { SecuritySummary } from "@/modules/ledger";
import { ASSET_TYPE_LABELS, NEW_SECURITY_ASSET_TYPES } from "../transactions/labels";
import { NEW_SECURITY_MARKER, WATCHLIST_FIELDS } from "./form-fields";
import { type WatchlistEntryErrorReason, type WatchlistEntryField, watchlistEntryErrorField, watchlistEntryErrorMessage } from "./labels";
import { useDialog } from "./WatchlistDialogs";

const TOUCH_TARGET = { minHeight: 44 };

/** The entry being edited, as the dialog needs it. */
export type EditableWatchlistEntry = {
  id: string;
  watchlistId: string;
  note: string;
  dateAdded: string;
  security: { name: string; isin: string | null; cryptoSymbol: string | null };
};

type Failure = { reason: WatchlistEntryErrorReason } | undefined;

/** Error placement: a field message or an Alert. */
function placement(failure: Failure) {
  const field = failure ? watchlistEntryErrorField(failure.reason) : undefined;
  const message = failure ? watchlistEntryErrorMessage(failure.reason) : undefined;
  return {
    errorFor: (name: WatchlistEntryField) => (field === name ? message : undefined),
    alert: failure && !field ? message : undefined,
  };
}

function NoteAndDate({
  note,
  setNote,
  dateAdded,
  setDateAdded,
  today,
  errorFor,
}: {
  note: string;
  setNote: (value: string) => void;
  dateAdded: string;
  setDateAdded: (value: string) => void;
  today: string;
  errorFor: (name: WatchlistEntryField) => string | undefined;
}) {
  return (
    <>
      <TextField
        name={WATCHLIST_FIELDS.note}
        label="Notiz"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        error={Boolean(errorFor("note"))}
        helperText={errorFor("note") ?? `${note.length} / ${WATCHLIST_NOTE_MAX_LENGTH}`}
        multiline
        minRows={3}
        fullWidth
      />
      <TextField
        name={WATCHLIST_FIELDS.dateAdded}
        type="date"
        label="Aufgenommen am"
        value={dateAdded}
        onChange={(event) => setDateAdded(event.target.value)}
        error={Boolean(errorFor("dateAdded"))}
        helperText={errorFor("dateAdded")}
        required
        fullWidth
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
      />
    </>
  );
}

/**
 * "Wertpapier hinzufügen": the Security Autocomplete of the Transaction form (with "Neue Security
 * anlegen" and its fields), note and date added (default today). Success closes the dialog.
 */
function AddEntryForm({
  watchlistId,
  securities,
  today,
  titleId,
  onClose,
}: {
  watchlistId: string;
  securities: readonly SecuritySummary[];
  today: string;
  titleId: string;
  onClose: () => void;
}) {
  const [security, setSecurity] = useState<SecurityOption | null>(null);
  const [securityInput, setSecurityInput] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [assetType, setAssetType] = useState("");
  const [note, setNote] = useState("");
  const [dateAdded, setDateAdded] = useState(today);
  const [state, formAction, pending] = useActionState<AddWatchlistEntryActionState, FormData>(async (previous, formData) => {
    const result = await addWatchlistEntryAction(previous, formData);
    if (result?.ok) onClose();
    return result;
  }, null);
  const { errorFor, alert } = placement(state && !state.ok ? state : undefined);
  const options: SecurityOption[] = [...securities.map((s) => ({ kind: "security" as const, security: s })), NEW_OPTION];
  const isNew = security?.kind === "new";
  return (
    <>
      <DialogTitle id={titleId}>Wertpapier hinzufügen</DialogTitle>
      <Box component="form" action={formAction} noValidate sx={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {alert ? (
              <Alert severity="error" role="alert">
                {alert}
              </Alert>
            ) : null}
            <input type="hidden" name={WATCHLIST_FIELDS.watchlistId} value={watchlistId} />
            {security?.kind === "security" ? <input type="hidden" name={WATCHLIST_FIELDS.securityId} value={security.security.id} /> : null}
            {isNew ? <input type="hidden" name={WATCHLIST_FIELDS.newSecurity} value={NEW_SECURITY_MARKER} /> : null}
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
                  label="Security"
                  placeholder="ISIN, Krypto-Symbol oder Name"
                  required
                  error={Boolean(errorFor("security"))}
                  helperText={errorFor("security")}
                />
              )}
            />
            {isNew ? (
              <>
                <TextField
                  name={WATCHLIST_FIELDS.securityIdentifier}
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
                  name={WATCHLIST_FIELDS.securityName}
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
                  name={WATCHLIST_FIELDS.assetType}
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
            <NoteAndDate note={note} setNote={setNote} dateAdded={dateAdded} setDateAdded={setDateAdded} today={today} errorFor={errorFor} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, mt: "auto" }}>
          <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET}>
            Abbrechen
          </Button>
          <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
            Hinzufügen
          </Button>
        </DialogActions>
      </Box>
    </>
  );
}

/**
 * "Eintrag bearbeiten": note, date added and the list (moving the entry); "Entfernen" removes it. The
 * Security and its Prices always stay. Success closes the dialog.
 */
function EditEntryForm({
  entry,
  lists,
  today,
  titleId,
  onClose,
}: {
  entry: EditableWatchlistEntry;
  lists: readonly { id: string; name: string }[];
  today: string;
  titleId: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState(entry.note);
  const [dateAdded, setDateAdded] = useState(entry.dateAdded);
  const [watchlistId, setWatchlistId] = useState(entry.watchlistId);
  const [removeState, setRemoveState] = useState<RemoveWatchlistEntryActionResult | null>(null);
  const [removing, startRemove] = useTransition();
  const [state, formAction, pending] = useActionState<UpdateWatchlistEntryActionState, FormData>(async (previous, formData) => {
    // A failed remove's message must not hide this update's outcome.
    setRemoveState(null);
    const result = await updateWatchlistEntryAction(previous, formData);
    if (result?.ok) onClose();
    return result;
  }, null);
  const removeFailure = removeState && !removeState.ok ? removeState : undefined;
  const { errorFor, alert } = placement(removeFailure ?? (state && !state.ok ? state : undefined));
  const listError = errorFor("security") ?? errorFor("watchlist");
  const busy = pending || removing;
  const remove = () =>
    startRemove(async () => {
      const result = await removeWatchlistEntryAction(entry.id);
      setRemoveState(result);
      if (result.ok) onClose();
    });
  return (
    <>
      <DialogTitle id={titleId}>Eintrag bearbeiten</DialogTitle>
      <Box component="form" action={formAction} noValidate sx={{ display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {alert ? (
              <Alert severity="error" role="alert">
                {alert}
              </Alert>
            ) : null}
            <input type="hidden" name={WATCHLIST_FIELDS.entryId} value={entry.id} />
            <Typography sx={{ fontWeight: 600 }}>
              {entry.security.name}{" "}
              <Typography component="span" variant="body2" color="text.secondary">
                {entry.security.isin ?? entry.security.cryptoSymbol ?? ""}
              </Typography>
            </Typography>
            <TextField
              select
              name={WATCHLIST_FIELDS.watchlistId}
              label="Watchlist"
              value={watchlistId}
              onChange={(event) => setWatchlistId(event.target.value)}
              error={Boolean(listError)}
              helperText={listError}
              fullWidth
            >
              {lists.map((list) => (
                <MenuItem key={list.id} value={list.id} sx={TOUCH_TARGET}>
                  {list.name}
                </MenuItem>
              ))}
            </TextField>
            <NoteAndDate note={note} setNote={setNote} dateAdded={dateAdded} setDateAdded={setDateAdded} today={today} errorFor={errorFor} />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, mt: "auto", flexWrap: "wrap", rowGap: 1 }}>
          <Button color="error" onClick={remove} disabled={busy} sx={{ ...TOUCH_TARGET, mr: "auto" }}>
            Entfernen
          </Button>
          <Button onClick={onClose} disabled={busy} sx={TOUCH_TARGET}>
            Abbrechen
          </Button>
          <Button type="submit" variant="contained" disabled={busy} sx={TOUCH_TARGET}>
            Speichern
          </Button>
        </DialogActions>
      </Box>
    </>
  );
}

function EntryDialog({ open, onClose, children }: { open: boolean; onClose: () => void; children: (titleId: string) => ReactNode }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" aria-labelledby={titleId}>
      {children(titleId)}
    </Dialog>
  );
}

/** Button "Wertpapier hinzufügen" with its dialog, adding to `watchlistId`. */
export function AddWatchlistEntryButton({
  watchlistId,
  securities,
  today,
}: {
  watchlistId: string;
  securities: readonly SecuritySummary[];
  today: string;
}) {
  const dialog = useDialog();
  return (
    <>
      <Button variant="contained" startIcon={<AddOutlined />} onClick={dialog.show} sx={TOUCH_TARGET}>
        Wertpapier hinzufügen
      </Button>
      <EntryDialog open={dialog.open} onClose={dialog.hide}>
        {(titleId) => (
          <AddEntryForm key={dialog.session} watchlistId={watchlistId} securities={securities} today={today} titleId={titleId} onClose={dialog.hide} />
        )}
      </EntryDialog>
    </>
  );
}

/** The "Eintrag bearbeiten" dialog of `entry`; change `formKey` to start a fresh form. */
export function EditWatchlistEntryDialog({
  open,
  onClose,
  formKey,
  entry,
  lists,
  today,
}: {
  open: boolean;
  onClose: () => void;
  formKey: number;
  entry: EditableWatchlistEntry | null;
  lists: readonly { id: string; name: string }[];
  today: string;
}) {
  return (
    <EntryDialog open={open && entry !== null} onClose={onClose}>
      {(titleId) =>
        entry ? <EditEntryForm key={formKey} entry={entry} lists={lists} today={today} titleId={titleId} onClose={onClose} /> : null
      }
    </EntryDialog>
  );
}
