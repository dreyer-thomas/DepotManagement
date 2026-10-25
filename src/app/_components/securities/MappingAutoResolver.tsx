"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveMissingMappingsAction } from "@/app/_actions/securities";
import { ACTION_FAILED_MESSAGE, resolveFailedMessage, securityErrorMessage } from "./labels";
import { TOUCH_TARGET } from "./SecurityDialog";

type Status = { kind: "idle" } | { kind: "running" } | { kind: "failed"; message: string; retryable: boolean };

/**
 * Resolves missing provider mappings once after the page has rendered (never during render), then
 * refreshes the page. Failures name the Securities and offer "Erneut versuchen".
 */
export function MappingAutoResolver({ pending }: { pending: number }) {
  const router = useRouter();
  // Running from the first render when anything is pending, so the progress shows immediately.
  const [status, setStatus] = useState<Status>(pending > 0 ? { kind: "running" } : { kind: "idle" });
  const started = useRef(false);

  /** Shows the outcome of a run and refreshes the page so new mappings appear. */
  const finish = useCallback(
    (result: Awaited<ReturnType<typeof resolveMissingMappingsAction>>) => {
      if (!result.ok) {
        // An expired session cannot be fixed by retrying.
        setStatus({ kind: "failed", message: securityErrorMessage(result.reason), retryable: false });
        return;
      }
      setStatus(
        result.failed.length > 0
          ? { kind: "failed", message: resolveFailedMessage(result.failed.map((failure) => failure.name)), retryable: true }
          : { kind: "idle" },
      );
      router.refresh();
    },
    [router],
  );
  const fail = useCallback(() => setStatus({ kind: "failed", message: ACTION_FAILED_MESSAGE, retryable: true }), []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (pending > 0) resolveMissingMappingsAction().then(finish, fail);
    // Mount only: a later `pending` (after the refresh) must not start another run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    setStatus({ kind: "running" });
    resolveMissingMappingsAction().then(finish, fail);
  };

  if (status.kind === "running") {
    return (
      <Stack spacing={1} sx={{ mb: 2 }} role="status">
        <Typography variant="body2" color="text.secondary">
          Kursquellen werden ermittelt …
        </Typography>
        <LinearProgress aria-label="Kursquellen werden ermittelt" />
      </Stack>
    );
  }
  if (status.kind === "failed") {
    return (
      <Alert
        severity="warning"
        role="alert"
        sx={{ mb: 2 }}
        action={
          status.retryable ? (
            <Button color="inherit" size="small" onClick={retry} sx={TOUCH_TARGET}>
              Erneut versuchen
            </Button>
          ) : undefined
        }
      >
        {status.message}
      </Alert>
    );
  }
  return null;
}
