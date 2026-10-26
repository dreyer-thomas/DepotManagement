"use client";

import RestoreIcon from "@mui/icons-material/Restore";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import { restoreAction } from "@/app/_actions/backup";
import {
  RESTORE_CONFIRM_TEXT,
  RESTORE_WARNING,
  type RestoreErrorReason,
  restoreErrorMessage,
  restoreSuccessMessage,
} from "./labels";

const TOUCH_TARGET = { minHeight: 44 };
const TITLE_ID = "restore-dialog-title";

type RestoreError = { reason: RestoreErrorReason; detail?: string };

/**
 * The form of "Daten wiederherstellen": export file plus the typed confirmation. Submits through
 * `onSubmit` + `startTransition`, so the chosen file and the text stay after an error.
 */
function RestoreForm({
  onClose,
  onRestored,
  onPendingChange,
}: {
  onClose: () => void;
  onRestored: (backupFileName: string) => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [fileName, setFileName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<RestoreError | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = fileName !== "" && confirm === RESTORE_CONFIRM_TEXT;
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
    const formData = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      try {
        const result = await restoreAction(null, formData);
        if (result?.ok) onRestored(result.backupFileName);
        else if (result) setError({ reason: result.reason, detail: "detail" in result ? result.detail : undefined });
      } catch {
        setError({ reason: "action-failed" });
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error" role="alert">
              {restoreErrorMessage(error.reason, error.detail)}
            </Alert>
          ) : null}
          <DialogContentText>{RESTORE_WARNING}</DialogContentText>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ alignItems: { sm: "center" } }}>
            <Button component="label" variant="outlined" disabled={pending} sx={TOUCH_TARGET}>
              Exportdatei wählen
              <input
                type="file"
                name="file"
                accept=".json,application/json"
                hidden
                disabled={pending}
                onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
              />
            </Button>
            <Typography variant="body2" color={fileName ? "text.primary" : "text.secondary"} sx={{ wordBreak: "break-all" }}>
              {fileName || "Keine Datei gewählt"}
            </Typography>
          </Stack>
          <TextField
            label={`Zur Bestätigung ${RESTORE_CONFIRM_TEXT} eingeben`}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            disabled={pending}
            autoComplete="off"
            fullWidth
            slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: "characters" } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" color="error" disabled={!ready || pending} sx={TOUCH_TARGET}>
          Wiederherstellen
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * "Wiederherstellen": opens the destructive confirm dialog; a success closes it and shows the name of
 * the automatic export below the buttons (the action revalidates every page).
 */
export function RestoreButton() {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [restored, setRestored] = useState<string | null>(null);
  // Esc, the backdrop and "Abbrechen" close; nothing closes the dialog while a restore runs.
  const [busy, setBusy] = useState(false);

  return (
    <Box>
      <Button
        variant="outlined"
        startIcon={<RestoreIcon />}
        onClick={() => {
          setRestored(null);
          setSession((value) => value + 1);
          setOpen(true);
        }}
        sx={TOUCH_TARGET}
      >
        Wiederherstellen
      </Button>
      {restored ? (
        <Alert severity="success" role="status" sx={{ mt: 2 }}>
          {restoreSuccessMessage(restored)}
        </Alert>
      ) : null}
      <Dialog
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        fullWidth
        maxWidth="sm"
        aria-labelledby={TITLE_ID}
      >
        <DialogTitle id={TITLE_ID}>Daten wiederherstellen</DialogTitle>
        <RestoreForm
          key={session}
          onPendingChange={setBusy}
          onClose={() => setOpen(false)}
          onRestored={(backupFileName) => {
            setOpen(false);
            setRestored(backupFileName);
          }}
        />
      </Dialog>
    </Box>
  );
}
