"use client";

import ArchiveOutlined from "@mui/icons-material/ArchiveOutlined";
import DeleteOutlineOutlined from "@mui/icons-material/DeleteOutlineOutlined";
import EditOutlined from "@mui/icons-material/EditOutlined";
import Alert from "@mui/material/Alert";
import Button, { type ButtonProps } from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { type ReactNode, type RefObject, useActionState, useRef, useState } from "react";
import {
  type ArchiveActionState,
  archiveDepotAction,
  createDepotAction,
  type DeleteDepotActionState,
  deleteDepotAction,
  type DepotActionState,
  renameDepotAction,
  unarchiveDepotAction,
} from "@/app/_actions/depots";
import {
  BROKER_OPTIONS,
  deleteConfirmationMatches,
  deleteDepotQuestion,
  depotErrorField,
  depotErrorMessage,
} from "./labels";

type DepotAction = (previous: DepotActionState, formData: FormData) => Promise<DepotActionState>;

const TOUCH_TARGET = { minHeight: 44 };

/**
 * Dialog shell: full-screen below `sm`. Esc and a backdrop click always close it; only the
 * "Abbrechen" button is disabled while a write is pending.
 */
function DepotDialog({
  open,
  onClose,
  title,
  children,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /**
   * Element to focus once the dialog has opened. MUI's focus trap moves focus to the dialog itself
   * on open, which overrides a child's `autoFocus`.
   */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = `depot-dialog-title-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={fullScreen}
      fullWidth
      maxWidth="xs"
      aria-labelledby={titleId}
      slotProps={initialFocus ? { transition: { onEntered: () => initialFocus.current?.focus() } } : undefined}
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>
      {children}
    </Dialog>
  );
}

/**
 * Form inside a Depot dialog. Inputs are controlled so they keep their text after an error
 * (React resets uncontrolled form fields after an action); success closes the dialog.
 */
function DepotForm({
  action,
  onSuccess,
  onCancel,
  submitLabel,
  initialName,
  depotId,
  withBroker,
}: {
  action: DepotAction;
  onSuccess: () => void;
  onCancel: () => void;
  submitLabel: string;
  initialName: string;
  depotId?: string;
  withBroker: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [broker, setBroker] = useState("");
  const [state, formAction, pending] = useActionState<DepotActionState, FormData>(async (previous, formData) => {
    const result = await action(previous, formData);
    if (result?.ok) onSuccess();
    return result;
  }, null);

  const failure = state && !state.ok ? state.reason : undefined;
  const field = failure ? depotErrorField(failure) : undefined;
  const nameError = field === "name" ? depotErrorMessage(failure!) : undefined;
  const brokerError = field === "broker" ? depotErrorMessage(failure!) : undefined;
  const alert = failure && !field ? depotErrorMessage(failure) : undefined;

  return (
    <form action={formAction} noValidate>
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {alert ? (
            <Alert severity="error" role="alert">
              {alert}
            </Alert>
          ) : null}
          {depotId ? <input type="hidden" name="id" value={depotId} /> : null}
          <TextField
            name="name"
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={Boolean(nameError)}
            helperText={nameError}
            autoFocus
            required
            fullWidth
            autoComplete="off"
          />
          {withBroker ? (
            <TextField
              select
              name="broker"
              label="Broker"
              value={broker}
              onChange={(event) => setBroker(event.target.value)}
              error={Boolean(brokerError)}
              helperText={brokerError}
              required
              fullWidth
            >
              {BROKER_OPTIONS.map(({ value, label }) => (
                <MenuItem key={value} value={value} sx={TOUCH_TARGET}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={pending} sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
          {submitLabel}
        </Button>
      </DialogActions>
    </form>
  );
}

/** Opens and closes a dialog; each opening remounts the form so old errors and input are gone. */
function useDialog() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  return {
    open,
    session,
    show: () => {
      setSession((value) => value + 1);
      setOpen(true);
    },
    hide: () => setOpen(false),
  };
}

/** Button that opens the "Depot anlegen" dialog (Name + Broker). */
export function CreateDepotButton({
  label = "Depot anlegen",
  variant = "contained",
}: {
  label?: string;
  variant?: ButtonProps["variant"];
}) {
  const dialog = useDialog();
  return (
    <>
      <Button variant={variant} onClick={dialog.show} sx={TOUCH_TARGET}>
        {label}
      </Button>
      <DepotDialog open={dialog.open} onClose={dialog.hide} title="Depot anlegen">
        <DepotForm
          key={dialog.session}
          action={createDepotAction}
          onSuccess={dialog.hide}
          onCancel={dialog.hide}
          submitLabel="Anlegen"
          initialName=""
          withBroker
        />
      </DepotDialog>
    </>
  );
}

/** Icon button that opens the "Depot umbenennen" dialog prefilled with the current name. */
export function RenameDepotButton({ depot }: { depot: { id: string; name: string } }) {
  const dialog = useDialog();
  const label = `"${depot.name}" umbenennen`;
  return (
    <>
      <IconButton size="large" onClick={dialog.show} aria-label={label} title={label}>
        <EditOutlined />
      </IconButton>
      <DepotDialog open={dialog.open} onClose={dialog.hide} title="Depot umbenennen">
        <DepotForm
          key={dialog.session}
          action={renameDepotAction}
          onSuccess={dialog.hide}
          onCancel={dialog.hide}
          submitLabel="Speichern"
          initialName={depot.name}
          depotId={depot.id}
          withBroker={false}
        />
      </DepotDialog>
    </>
  );
}

/** Confirmation form of the "Depot archivieren" dialog; success closes it, a failure shows an Alert. */
function ArchiveForm({
  depot,
  onClose,
  cancelRef,
}: {
  depot: { id: string; name: string };
  onClose: () => void;
  cancelRef: RefObject<HTMLButtonElement | null>;
}) {
  const [state, formAction, pending] = useActionState<ArchiveActionState, FormData>(async (previous, formData) => {
    const result = await archiveDepotAction(previous, formData);
    if (result?.ok) onClose();
    return result;
  }, null);
  const failure = state && !state.ok ? depotErrorMessage(state.reason) : undefined;
  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="id" value={depot.id} />
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2}>
          {failure ? (
            <Alert severity="error" role="alert">
              {failure}
            </Alert>
          ) : null}
          <DialogContentText>
            Depot „{depot.name}“ archivieren? Es zählt dann nicht mehr zur Übersicht und kann nicht mehr bebucht werden.
          </DialogContentText>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button ref={cancelRef} onClick={onClose} disabled={pending} autoFocus sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
          Archivieren
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * Icon button that opens the "Depot archivieren" confirmation. Disabled while the Depot is not
 * archivable; `describedBy` points at the visible reason.
 */
export function ArchiveDepotButton({
  depot,
  describedBy,
}: {
  depot: { id: string; name: string; archivable: boolean };
  describedBy?: string;
}) {
  const dialog = useDialog();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const label = `„${depot.name}“ archivieren`;
  return (
    <>
      <IconButton
        size="large"
        onClick={dialog.show}
        disabled={!depot.archivable}
        aria-label={label}
        aria-describedby={depot.archivable ? undefined : describedBy}
        title={label}
        sx={{ minWidth: 44, minHeight: 44 }}
      >
        <ArchiveOutlined />
      </IconButton>
      <DepotDialog open={dialog.open} onClose={dialog.hide} title="Depot archivieren" initialFocus={cancelRef}>
        <ArchiveForm key={dialog.session} depot={depot} onClose={dialog.hide} cancelRef={cancelRef} />
      </DepotDialog>
    </>
  );
}

/** "Reaktivieren" button of an archived Depot; submits directly, a failure shows an inline Alert. */
export function UnarchiveDepotButton({ depot }: { depot: { id: string; name: string } }) {
  const [state, formAction, pending] = useActionState<ArchiveActionState, FormData>(unarchiveDepotAction, null);
  const failure = state && !state.ok ? depotErrorMessage(state.reason) : undefined;
  return (
    <Stack component="form" action={formAction} noValidate spacing={1} sx={{ alignItems: "flex-end" }}>
      <input type="hidden" name="id" value={depot.id} />
      <Button type="submit" variant="outlined" disabled={pending} aria-label={`„${depot.name}“ reaktivieren`} sx={TOUCH_TARGET}>
        Reaktivieren
      </Button>
      {failure ? (
        <Alert severity="error" role="alert">
          {failure}
        </Alert>
      ) : null}
    </Stack>
  );
}

type DeletableDepot = { id: string; name: string; transactionCount: number };

/**
 * Confirmation form of the "Depot löschen" dialog: "Löschen" stays disabled until the Depot's name is
 * typed exactly. Success closes it (the Depot leaves the list after revalidation); a failure shows an Alert.
 */
export function DeleteDepotForm({
  depot,
  onClose,
  cancelRef,
}: {
  depot: DeletableDepot;
  onClose: () => void;
  cancelRef: RefObject<HTMLButtonElement | null>;
}) {
  const [typed, setTyped] = useState("");
  const [state, formAction, pending] = useActionState<DeleteDepotActionState, FormData>(async (previous, formData) => {
    const result = await deleteDepotAction(previous, formData);
    if (result?.ok) onClose();
    return result;
  }, null);
  const failure = state && !state.ok ? depotErrorMessage(state.reason) : undefined;
  const matches = deleteConfirmationMatches(typed, depot.name);
  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="id" value={depot.id} />
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2}>
          {failure ? (
            <Alert severity="error" role="alert">
              {failure}
            </Alert>
          ) : null}
          <DialogContentText>{deleteDepotQuestion(depot.name, depot.transactionCount)}</DialogContentText>
          <TextField
            name="confirmName"
            label={`Zum Bestätigen „${depot.name}“ eingeben`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            fullWidth
            autoComplete="off"
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button ref={cancelRef} onClick={onClose} disabled={pending} autoFocus sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" color="error" disabled={pending || !matches} sx={TOUCH_TARGET}>
          Löschen
        </Button>
      </DialogActions>
    </form>
  );
}

/** Icon button that opens the "Depot löschen" confirmation (active and archived Depots). */
export function DeleteDepotButton({ depot }: { depot: DeletableDepot }) {
  const dialog = useDialog();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const label = `„${depot.name}“ löschen`;
  return (
    <>
      <IconButton size="large" onClick={dialog.show} aria-label={label} title={label} sx={{ minWidth: 44, minHeight: 44 }}>
        <DeleteOutlineOutlined />
      </IconButton>
      <DepotDialog open={dialog.open} onClose={dialog.hide} title="Depot löschen" initialFocus={cancelRef}>
        <DeleteDepotForm key={dialog.session} depot={depot} onClose={dialog.hide} cancelRef={cancelRef} />
      </DepotDialog>
    </>
  );
}
