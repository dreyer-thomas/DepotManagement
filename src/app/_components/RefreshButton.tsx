"use client";

import Refresh from "@mui/icons-material/Refresh";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Tooltip from "@mui/material/Tooltip";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { refreshAllAction, type RefreshAllActionResult } from "../_actions/refresh";
import { ACTION_FAILED_MESSAGE } from "./securities/labels";

const LABEL = "Kurse und Nachrichten aktualisieren";

type Result = { severity: "success" | "warning" | "error"; text: string };

/** Snackbar text of a finished refresh. */
export function refreshAllText(result: RefreshAllActionResult): Result {
  if (!result.ok) return { severity: "error", text: "Sitzung abgelaufen. Bitte erneut anmelden." };
  const parts: string[] = [];
  if (result.failedPrices.length > 0) parts.push(`Kurse fehlgeschlagen: ${result.failedPrices.join(", ")}.`);
  if (result.failedNews === null) parts.push("Nachrichten konnten nicht geladen werden.");
  else if (result.failedNews.length > 0) parts.push(`Nachrichten fehlgeschlagen: ${result.failedNews.join(", ")}.`);
  if (parts.length === 0) return { severity: "success", text: "Kurse und Nachrichten aktualisiert." };
  return { severity: "warning", text: `Aktualisiert. ${parts.join(" ")}` };
}

/**
 * AppBar icon button (next to "Darstellung"): fetches all Prices, then all news, now. The icon turns into a
 * spinner while running; a snackbar reports the outcome and the page refreshes. Label only as tooltip.
 */
export function RefreshButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = async () => {
    setRunning(true);
    setOpen(false);
    try {
      const outcome = await refreshAllAction();
      setResult(refreshAllText(outcome));
      if (outcome.ok) router.refresh();
    } catch {
      setResult({ severity: "error", text: ACTION_FAILED_MESSAGE });
    } finally {
      setRunning(false);
      setOpen(true);
    }
  };

  return (
    <>
      <Tooltip title={LABEL}>
        {/* The span keeps the tooltip working while the button is disabled. */}
        <span>
          <IconButton color="inherit" size="large" aria-label={LABEL} aria-busy={running} disabled={running} onClick={refresh}>
            {running ? <CircularProgress size={24} color="inherit" aria-hidden /> : <Refresh />}
          </IconButton>
        </span>
      </Tooltip>
      <Snackbar
        open={open}
        autoHideDuration={result?.severity === "success" ? 6000 : null}
        onClose={(_event, reason) => {
          if (reason !== "clickaway") setOpen(false);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {result ? (
          <Alert
            severity={result.severity}
            variant="filled"
            onClose={() => setOpen(false)}
            role={result.severity === "success" ? "status" : "alert"}
            sx={{ width: "100%" }}
          >
            {result.text}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
