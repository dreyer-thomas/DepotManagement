"use client";

import Refresh from "@mui/icons-material/Refresh";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { refreshPricesAction } from "@/app/_actions/prices";
import { refreshResultText } from "../prices/price-labels";
import { ACTION_FAILED_MESSAGE, securityErrorMessage } from "./labels";
import { TOUCH_TARGET } from "./SecurityDialog";

type Result = { severity: "success" | "warning" | "error"; text: string };

/**
 * "Kurse aktualisieren": fetches the Prices of every held Security now. The button is disabled with a
 * progress indicator until the action returns; a snackbar then names the failed Securities (or confirms
 * success) and the page refreshes. No optimistic UI.
 */
export function PriceRefreshButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [open, setOpen] = useState(false);

  const show = (next: Result) => {
    setResult(next);
    setOpen(true);
  };

  const refresh = async () => {
    setRunning(true);
    setOpen(false);
    try {
      const outcome = await refreshPricesAction();
      if (!outcome.ok) {
        show({ severity: "error", text: securityErrorMessage(outcome.reason) });
      } else {
        const names = outcome.failed.map((failure) => failure.name);
        show({ severity: names.length > 0 ? "warning" : "success", text: refreshResultText(names) });
        router.refresh();
      }
    } catch {
      show({ severity: "error", text: ACTION_FAILED_MESSAGE });
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <Button
        variant="contained"
        onClick={refresh}
        disabled={running}
        aria-busy={running}
        startIcon={running ? <CircularProgress size={18} color="inherit" aria-hidden /> : <Refresh aria-hidden />}
        sx={TOUCH_TARGET}
      >
        {running ? "Kurse werden aktualisiert …" : "Kurse aktualisieren"}
      </Button>
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
