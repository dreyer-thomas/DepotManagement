"use client";

import AddOutlined from "@mui/icons-material/AddOutlined";
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
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useActionState, useId, useRef, useState } from "react";
import {
  createWatchlistAction,
  type DeleteWatchlistActionState,
  deleteWatchlistAction,
  renameWatchlistAction,
  type WatchlistActionState,
} from "@/app/_actions/watchlists";
import { WATCHLIST_FIELDS } from "./form-fields";
import { deleteWatchlistQuestion, watchlistErrorField, watchlistErrorMessage } from "./labels";
import { watchlistHref } from "./watchlist-cookie";

const TOUCH_TARGET = { minHeight: 44 };

type WatchlistAction = (previous: WatchlistActionState, formData: FormData) => Promise<WatchlistActionState>;

/** Opens and closes a dialog; each opening remounts the form so old errors and input are gone. */
export function useDialog() {
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

/** Dialog shell: full-screen below `sm`; Esc and a backdrop click close it. */
function WatchlistDialog({
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
  /** Element to focus once the dialog has opened (MUI's focus trap overrides a child's `autoFocus`). */
  initialFocus?: RefObject<HTMLElement | null>;
}) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();
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

/** Name form of "Watchlist anlegen" / "umbenennen"; the input keeps its text after an error. */
function NameForm({
  action,
  onSuccess,
  onCancel,
  submitLabel,
  initialName,
  watchlistId,
}: {
  action: WatchlistAction;
  onSuccess: (state: Extract<WatchlistActionState, { ok: true }>) => void;
  onCancel: () => void;
  submitLabel: string;
  initialName: string;
  watchlistId?: string;
}) {
  const [name, setName] = useState(initialName);
  const [state, formAction, pending] = useActionState<WatchlistActionState, FormData>(async (previous, formData) => {
    const result = await action(previous, formData);
    if (result?.ok) onSuccess(result);
    return result;
  }, null);
  const failure = state && !state.ok ? state.reason : undefined;
  const nameError = failure && watchlistErrorField(failure) === "name" ? watchlistErrorMessage(failure) : undefined;
  const alert = failure && !nameError ? watchlistErrorMessage(failure) : undefined;
  return (
    <form action={formAction} noValidate>
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {alert ? (
            <Alert severity="error" role="alert">
              {alert}
            </Alert>
          ) : null}
          {watchlistId ? <input type="hidden" name={WATCHLIST_FIELDS.watchlistId} value={watchlistId} /> : null}
          <TextField
            name={WATCHLIST_FIELDS.name}
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

/** "Watchlist anlegen": the new list is created at the end and opened. */
export function CreateWatchlistButton({
  label = "Watchlist anlegen",
  variant = "contained",
}: {
  label?: string;
  variant?: ButtonProps["variant"];
}) {
  const dialog = useDialog();
  const router = useRouter();
  return (
    <>
      <Button variant={variant} startIcon={<AddOutlined />} onClick={dialog.show} sx={TOUCH_TARGET}>
        {label}
      </Button>
      <WatchlistDialog open={dialog.open} onClose={dialog.hide} title="Watchlist anlegen">
        <NameForm
          key={dialog.session}
          action={createWatchlistAction}
          onSuccess={(result) => {
            dialog.hide();
            router.push(watchlistHref(result.watchlist.id), { scroll: false });
          }}
          onCancel={dialog.hide}
          submitLabel="Anlegen"
          initialName=""
        />
      </WatchlistDialog>
    </>
  );
}

/** Icon button opening "Watchlist umbenennen", prefilled with the current name. */
export function RenameWatchlistButton({ watchlist }: { watchlist: { id: string; name: string } }) {
  const dialog = useDialog();
  const label = `„${watchlist.name}“ umbenennen`;
  return (
    <>
      <IconButton onClick={dialog.show} aria-label={label} title={label} sx={{ width: 44, height: 44 }}>
        <EditOutlined />
      </IconButton>
      <WatchlistDialog open={dialog.open} onClose={dialog.hide} title="Watchlist umbenennen">
        <NameForm
          key={dialog.session}
          action={renameWatchlistAction}
          onSuccess={dialog.hide}
          onCancel={dialog.hide}
          submitLabel="Speichern"
          initialName={watchlist.name}
          watchlistId={watchlist.id}
        />
      </WatchlistDialog>
    </>
  );
}

type DeletableWatchlist = { id: string; name: string; entryCount: number };

function DeleteForm({
  watchlist,
  onDeleted,
  onCancel,
  cancelRef,
}: {
  watchlist: DeletableWatchlist;
  onDeleted: () => void;
  onCancel: () => void;
  cancelRef: RefObject<HTMLButtonElement | null>;
}) {
  const [state, formAction, pending] = useActionState<DeleteWatchlistActionState, FormData>(async (previous, formData) => {
    const result = await deleteWatchlistAction(previous, formData);
    if (result?.ok) onDeleted();
    return result;
  }, null);
  const failure = state && !state.ok ? watchlistErrorMessage(state.reason) : undefined;
  return (
    <form action={formAction} noValidate>
      <input type="hidden" name={WATCHLIST_FIELDS.watchlistId} value={watchlist.id} />
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2}>
          {failure ? (
            <Alert severity="error" role="alert">
              {failure}
            </Alert>
          ) : null}
          <DialogContentText>{deleteWatchlistQuestion(watchlist.name, watchlist.entryCount)}</DialogContentText>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button ref={cancelRef} onClick={onCancel} disabled={pending} autoFocus sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" color="error" disabled={pending} sx={TOUCH_TARGET}>
          Löschen
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * Icon button opening the "Watchlist löschen" confirmation, naming the list and its entry count. After
 * the delete the page opens the first remaining list.
 */
export function DeleteWatchlistButton({ watchlist }: { watchlist: DeletableWatchlist }) {
  const dialog = useDialog();
  const router = useRouter();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const label = `„${watchlist.name}“ löschen`;
  return (
    <>
      <IconButton onClick={dialog.show} aria-label={label} title={label} sx={{ width: 44, height: 44 }}>
        <DeleteOutlineOutlined />
      </IconButton>
      <WatchlistDialog open={dialog.open} onClose={dialog.hide} title="Watchlist löschen" initialFocus={cancelRef}>
        <DeleteForm
          key={dialog.session}
          watchlist={watchlist}
          onDeleted={() => {
            dialog.hide();
            router.push("/watchlists", { scroll: false });
          }}
          onCancel={dialog.hide}
          cancelRef={cancelRef}
        />
      </WatchlistDialog>
    </>
  );
}
