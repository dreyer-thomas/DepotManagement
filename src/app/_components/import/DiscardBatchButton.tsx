"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { unstable_rethrow } from "next/navigation";
import { useActionState, useState } from "react";
import { type DiscardImportBatchActionState, discardImportBatchAction } from "@/app/_actions/import";
import { discardErrorMessage, fileCountLabel } from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

/** "Verwerfen" with a confirmation dialog; success deletes the batch and its PDFs and opens `/import`. */
export function DiscardBatchButton({ batchId, fileCount }: { batchId: string; fileCount: number }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    DiscardImportBatchActionState | { ok: false; reason: "action-failed" },
    FormData
  >(async (previous, formData) => {
    try {
      return await discardImportBatchAction(previous as DiscardImportBatchActionState, formData);
    } catch (error) {
      // A redirect (success) is Next's control flow, not a failure.
      unstable_rethrow(error);
      return { ok: false, reason: "action-failed" };
    }
  }, null);
  const reason = state && !state.ok ? state.reason : null;
  return (
    <>
      <Button variant="outlined" color="inherit" onClick={() => setOpen(true)} sx={TOUCH_TARGET}>
        Verwerfen
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} aria-labelledby="discard-import-title">
        <form action={formAction}>
          <input type="hidden" name="batchId" value={batchId} />
          <DialogTitle id="discard-import-title">Import verwerfen?</DialogTitle>
          <DialogContent>
            {reason ? (
              <Alert severity="error" role="alert" sx={{ mb: 2 }}>
                {discardErrorMessage(reason)}
              </Alert>
            ) : null}
            <DialogContentText>
              {fileCountLabel(fileCount)} und alle Vorschläge werden gelöscht. Gebucht wurde nichts.
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)} disabled={pending} sx={TOUCH_TARGET}>
              Abbrechen
            </Button>
            <Button type="submit" variant="contained" color="error" disabled={pending} sx={TOUCH_TARGET}>
              Verwerfen
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
