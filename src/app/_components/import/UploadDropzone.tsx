"use client";

import FileUploadOutlined from "@mui/icons-material/FileUploadOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { unstable_rethrow } from "next/navigation";
import { type DragEvent, type FormEvent, startTransition, useActionState, useState } from "react";
import { type UploadDocumentsActionState, uploadDocumentsAction } from "@/app/_actions/import";
import { IMPORT_MAX_BATCH_BYTES, IMPORT_MAX_FILES } from "@/modules/import/limits";
import { fileCountLabel, formatMegabytes, uploadErrorMessage, type UploadErrorReason } from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

export type UploadDepot = { id: string; name: string };

/** A client-side check of the selection; the server re-checks everything. */
function selectionError(files: readonly File[]): UploadErrorReason | null {
  if (files.length === 0) return "files-missing";
  if (files.length > IMPORT_MAX_FILES) return "too-many-files";
  if (files.reduce((sum, file) => sum + file.size, 0) > IMPORT_MAX_BATCH_BYTES) return "upload-too-large";
  return null;
}

/**
 * Upload card body: a drop zone plus "Dateien auswählen" (several PDFs), the target Depot and
 * "Hochladen". A successful upload opens the new batch (the action redirects); nothing is booked.
 */
export function UploadDropzone({ depots, defaultDepotId }: { depots: readonly UploadDepot[]; defaultDepotId?: string }) {
  const initialDepot = depots.some((depot) => depot.id === defaultDepotId) ? (defaultDepotId as string) : (depots[0]?.id ?? "");
  const [depotId, setDepotId] = useState(initialDepot);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [localError, setLocalError] = useState<UploadErrorReason | null>(null);
  const [state, formAction, pending] = useActionState<UploadDocumentsActionState | { ok: false; reason: "action-failed" }, FormData>(
    async (previous, formData) => {
      try {
        return await uploadDocumentsAction(previous as UploadDocumentsActionState, formData);
      } catch (error) {
        // A redirect (success) is Next's control flow, not a failure.
        unstable_rethrow(error);
        return { ok: false, reason: "action-failed" };
      }
    },
    null,
  );

  const add = (added: FileList | null | undefined) => {
    if (!added || added.length === 0) return;
    setFiles((current) => [...current, ...Array.from(added)]);
    setLocalError(null);
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    if (!pending) add(event.dataTransfer?.files);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const problem = selectionError(files);
    setLocalError(problem);
    if (problem) return;
    const data = new FormData();
    data.set("depotId", depotId);
    for (const file of files) data.append("files", file);
    startTransition(() => formAction(data));
  };

  if (depots.length === 0) {
    return <Alert severity="info">Kein aktives Depot vorhanden. Lege zuerst ein Depot an.</Alert>;
  }

  const reason = localError ?? (state && !state.ok ? state.reason : null);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <form onSubmit={submit} noValidate aria-label="Dokumente hochladen">
      <Stack spacing={2}>
        {reason ? (
          <Alert severity="error" role="alert">
            {uploadErrorMessage(reason)}
          </Alert>
        ) : null}
        <TextField
          select
          label="Depot"
          value={depotId}
          onChange={(event) => setDepotId(event.target.value)}
          disabled={pending}
          fullWidth
          slotProps={{ select: { native: true }, htmlInput: { name: "depotId" } }}
        >
          {depots.map((depot) => (
            <option key={depot.id} value={depot.id}>
              {depot.name}
            </option>
          ))}
        </TextField>
        <Box
          data-testid="import-dropzone"
          onDragOver={(event) => {
            event.preventDefault();
            if (!pending) setDragging(true);
          }}
          onDragLeave={(event) => {
            // Leaving onto a child (icon, text, button) is still inside the drop zone.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={drop}
          sx={{
            border: 2,
            borderStyle: "dashed",
            borderColor: dragging ? "primary.main" : "divider",
            bgcolor: dragging ? "action.hover" : "transparent",
            borderRadius: 2,
            p: 3,
            textAlign: "center",
          }}
        >
          <FileUploadOutlined color="action" aria-hidden />
          <Typography sx={{ mt: 1, mb: 2 }}>PDF-Dokumente hierher ziehen oder</Typography>
          <Button component="label" variant="outlined" disabled={pending} sx={TOUCH_TARGET}>
            Dateien auswählen
            <input
              type="file"
              accept=".pdf,application/pdf"
              multiple
              hidden
              disabled={pending}
              onChange={(event) => {
                add(event.target.files);
                // Lets the same file be chosen again after removing the selection.
                event.target.value = "";
              }}
            />
          </Button>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Bis zu {IMPORT_MAX_FILES} PDFs, je höchstens 5 MB, zusammen höchstens 20 MB.
          </Typography>
        </Box>
        {files.length > 0 ? (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {fileCountLabel(files.length)} ausgewählt ({formatMegabytes(totalBytes)})
            </Typography>
            <Box component="ul" aria-label="Ausgewählte Dateien" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
              {files.map((file, index) => (
                <Typography key={`${index}-${file.name}`} component="li" variant="body2" sx={{ wordBreak: "break-all" }}>
                  {file.name}
                </Typography>
              ))}
            </Box>
          </Box>
        ) : null}
        <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", rowGap: 1 }}>
          <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
            {pending ? "Wird hochgeladen …" : "Hochladen"}
          </Button>
          {files.length > 0 ? (
            <Button
              onClick={() => {
                setFiles([]);
                setLocalError(null);
              }}
              disabled={pending}
              sx={TOUCH_TARGET}
            >
              Auswahl leeren
            </Button>
          ) : null}
        </Stack>
      </Stack>
    </form>
  );
}
