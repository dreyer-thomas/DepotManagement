"use client";

import DownloadIcon from "@mui/icons-material/Download";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import { useState } from "react";

const EXPORT_URL = "/api/export";
const LOGIN_URL = "/login?next=%2Fsettings&expired=1";
const FALLBACK_FILE_NAME = "depotmanagement-export.json";
/** Delay before the object URL of a saved export is revoked. */
export const REVOKE_DELAY_MS = 40_000;
export const EXPORT_FAILED_MESSAGE = "Export fehlgeschlagen. Bitte erneut versuchen.";

/** The file name from `Content-Disposition: attachment; filename="…"`, or a fallback. */
function fileNameFrom(disposition: string | null): string {
  const match = disposition ? /filename="([^"]+)"/.exec(disposition) : null;
  return match?.[1] ?? FALLBACK_FILE_NAME;
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke later: Safari and older Firefox may still be reading the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Downloads the full JSON export. Fetches it first so only a 200 body is ever saved as a file:
 * 401 sends Tommy to the login, any other failure shows an Alert below the button.
 */
export function ExportButton() {
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleClick() {
    setFailed(false);
    setRunning(true);
    try {
      const response = await fetch(EXPORT_URL, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) {
        // A full navigation (not the client router) so the proxy sees the expired cookie on the way in.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign(LOGIN_URL);
        return;
      }
      if (response.status !== 200) {
        setFailed(true);
        return;
      }
      const blob = await response.blob();
      saveBlob(blob, fileNameFrom(response.headers.get("Content-Disposition")));
    } catch {
      setFailed(true);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Box>
      <Button
        variant="outlined"
        startIcon={<DownloadIcon />}
        onClick={handleClick}
        disabled={running}
        sx={{ minHeight: 44 }}
      >
        Exportieren
      </Button>
      {failed ? (
        <Alert severity="error" role="alert" sx={{ mt: 2 }}>
          {EXPORT_FAILED_MESSAGE}
        </Alert>
      ) : null}
    </Box>
  );
}
