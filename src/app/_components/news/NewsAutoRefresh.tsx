"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { refreshNewsAction, type RefreshNewsActionResult } from "@/app/_actions/news";
import {
  NEWS_REFRESH_FAILED_TEXT,
  NEWS_REFRESHING_TEXT,
  NEWS_SESSION_EXPIRED_TEXT,
  newsPartialFailureMessage,
} from "./labels";

type Status = { kind: "idle" } | { kind: "running" } | { kind: "failed"; message: string; retryable: boolean };

/**
 * Rendered by the news page when the cache is stale: refreshes the stale Securities' news once after the
 * page has rendered (never during render), then refreshes the page. Failures offer "Erneut versuchen".
 */
export function NewsAutoRefresh() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "running" });
  const started = useRef(false);

  const finish = useCallback(
    (result: RefreshNewsActionResult) => {
      if (!result.ok) {
        // An expired session cannot be fixed by retrying.
        setStatus({ kind: "failed", message: NEWS_SESSION_EXPIRED_TEXT, retryable: false });
        return;
      }
      setStatus(
        result.failed.length > 0
          ? { kind: "failed", message: newsPartialFailureMessage(result.failed.length), retryable: true }
          : { kind: "idle" },
      );
      router.refresh();
    },
    [router],
  );
  const fail = useCallback(() => setStatus({ kind: "failed", message: NEWS_REFRESH_FAILED_TEXT, retryable: true }), []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    refreshNewsAction().then(finish, fail);
    // Mount only: a re-render after the page refresh must not start another run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retry = () => {
    setStatus({ kind: "running" });
    refreshNewsAction().then(finish, fail);
  };

  if (status.kind === "running") {
    return (
      <Stack spacing={1} sx={{ mb: 2 }} role="status">
        <Typography variant="body2" color="text.secondary">
          {NEWS_REFRESHING_TEXT}
        </Typography>
        <LinearProgress aria-label="Nachrichten werden aktualisiert" />
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
            <Button color="inherit" size="small" onClick={retry} sx={{ minHeight: 44 }}>
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
