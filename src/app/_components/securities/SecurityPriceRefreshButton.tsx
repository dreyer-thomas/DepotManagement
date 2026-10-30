"use client";

import Refresh from "@mui/icons-material/Refresh";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Snackbar from "@mui/material/Snackbar";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { refreshSecurityPricesAction } from "@/app/_actions/prices";
import { fetchErrorText } from "../prices/price-labels";
import { ACTION_FAILED_MESSAGE, securityErrorMessage } from "./labels";
import { TOUCH_TARGET } from "./SecurityDialog";

type Result = { severity: "success" | "info" | "error"; text: string };

export const SKIPPED_TEXT = "Kein Abruf: keine Kursquelle, oder das Wertpapier ist weder im Bestand noch auf einer Watchlist.";

/**
 * "Kurs abrufen": fetches the Prices of one Security now, e.g. to check a corrected mapping. Disabled with
 * a progress indicator until the action returns; a snackbar then confirms, names the failure reason, or
 * says nothing was fetched, and the page refreshes after a fetch.
 */
export function SecurityPriceRefreshButton({ security, provider }: { security: { id: string; name: string }; provider: string | null }) {
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
      const outcome = await refreshSecurityPricesAction(security.id);
      if (!outcome.ok) show({ severity: "error", text: securityErrorMessage(outcome.reason) });
      else if (outcome.status === "skipped") show({ severity: "info", text: SKIPPED_TEXT });
      else {
        show(
          outcome.status === "updated"
            ? { severity: "success", text: `Kurs von ${security.name} abgerufen.` }
            : { severity: "error", text: fetchErrorText(provider, outcome.reason) },
        );
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
        variant="outlined"
        size="small"
        onClick={refresh}
        disabled={running}
        aria-busy={running}
        aria-label={`Kurs abrufen – ${security.name}`}
        startIcon={running ? <CircularProgress size={16} color="inherit" aria-hidden /> : <Refresh aria-hidden />}
        sx={TOUCH_TARGET}
      >
        Kurs abrufen
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
