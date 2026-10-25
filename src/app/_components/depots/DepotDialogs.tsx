"use client";

import EditOutlined from "@mui/icons-material/EditOutlined";
import Alert from "@mui/material/Alert";
import Button, { type ButtonProps } from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { type ReactNode, useActionState, useState } from "react";
import { createDepotAction, type DepotActionState, renameDepotAction } from "@/app/_actions/depots";
import { BROKER_OPTIONS, depotErrorField, depotErrorMessage } from "./labels";

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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = `depot-dialog-title-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Dialog open={open} onClose={onClose} fullScreen={fullScreen} fullWidth maxWidth="xs" aria-labelledby={titleId}>
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
