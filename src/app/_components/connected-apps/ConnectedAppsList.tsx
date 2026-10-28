"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { type ReactNode, useId, useRef, useState } from "react";
import { disconnectAllAppsAction, disconnectAppAction, removePortfolioAccessAction } from "@/app/_actions/connected-apps";
import type { ConnectedApp } from "@/modules/mcp";
import {
  ACTION_FAILED_MESSAGE,
  ALL_DISCONNECTED_TOAST,
  type ConnectedAppsErrorReason,
  connectedAppsErrorMessage,
  connectedSinceLine,
  DISCONNECT_ALL_TEXT,
  disconnectAllTitle,
  disconnectedToast,
  disconnectText,
  disconnectTitle,
  hasPortfolioAccess,
  lastUsedLine,
  portfolioAccessRemovedToast,
  REMOVE_PORTFOLIO_ACCESS_CONFIRM,
  REMOVE_PORTFOLIO_ACCESS_LABEL,
  removePortfolioAccessAriaLabel,
  removePortfolioAccessText,
  removePortfolioAccessTitle,
  scopesText,
} from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

type Target = { kind: "one"; app: ConnectedApp } | { kind: "all"; count: number } | { kind: "portfolio"; app: ConnectedApp };

async function run(target: Target): Promise<{ ok: true; toast: string } | { ok: false; reason: ConnectedAppsErrorReason }> {
  if (target.kind === "all") {
    const result = await disconnectAllAppsAction();
    return result.ok ? { ok: true, toast: ALL_DISCONNECTED_TOAST } : result;
  }
  if (target.kind === "portfolio") {
    const result = await removePortfolioAccessAction(target.app.grantId);
    return result.ok ? { ok: true, toast: portfolioAccessRemovedToast(result.clientName) } : result;
  }
  const result = await disconnectAppAction(target.app.grantId);
  return result.ok ? { ok: true, toast: disconnectedToast(result.clientName) } : result;
}

function dialogTitle(target: Target | null): string {
  if (!target) return "";
  if (target.kind === "one") return disconnectTitle(target.app.clientName);
  if (target.kind === "portfolio") return removePortfolioAccessTitle(target.app.clientName);
  return disconnectAllTitle(target.count);
}

function dialogText(target: Target | null): string {
  if (target?.kind === "one") return disconnectText(target.app.clientName);
  if (target?.kind === "portfolio") return removePortfolioAccessText(target.app.clientName);
  return DISCONNECT_ALL_TEXT;
}

/**
 * Settings › Verbundene Apps: one card per active grant with "Trennen" (and "Depotzugriff entfernen" when it
 * holds `portfolio:read`), plus "Alle trennen"; `empty` is shown without any connection. Every button
 * confirms in a dialog; success shows a toast, and the action's
 * `revalidatePath` refreshes the list.
 * The component stays mounted when the list empties, so the toast survives the refresh.
 */
export function ConnectedAppsList({ apps, empty }: { apps: ConnectedApp[]; empty: ReactNode }) {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastOpen, setToastOpen] = useState(false);

  const show = (next: Target) => {
    setTarget(next);
    setError(null);
    setOpen(true);
  };
  const hide = () => {
    if (!pending) setOpen(false);
  };

  const confirm = async () => {
    if (!target) return;
    setPending(true);
    setError(null);
    try {
      const result = await run(target);
      if (result.ok) {
        setOpen(false);
        setToast(result.toast);
        setToastOpen(true);
      } else {
        setError(connectedAppsErrorMessage(result.reason));
      }
    } catch {
      setError(ACTION_FAILED_MESSAGE);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {apps.length === 0 ? (
        empty
      ) : (
        <Stack spacing={2} sx={{ alignItems: "stretch" }}>
          {apps.map((app) => (
            <Card key={app.grantId}>
              <CardContent
                sx={{
                  display: "flex",
                  flexDirection: { xs: "column", sm: "row" },
                  alignItems: { xs: "stretch", sm: "center" },
                  justifyContent: "space-between",
                  gap: 2,
                  "&:last-child": { pb: 2 },
                }}
              >
                <div>
                  <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>
                    {app.clientName}
                  </Typography>
                  {app.redirectHosts.length > 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
                      {app.redirectHosts.join(", ")}
                    </Typography>
                  ) : null}
                  <Typography variant="body2">{scopesText(app.scopes)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {connectedSinceLine(app.createdAt)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {lastUsedLine(app.lastUsedAt)}
                  </Typography>
                </div>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ flexShrink: 0 }}>
                  {hasPortfolioAccess(app.scopes) ? (
                    <Button
                      variant="outlined"
                      onClick={() => show({ kind: "portfolio", app })}
                      aria-label={removePortfolioAccessAriaLabel(app.clientName)}
                      sx={TOUCH_TARGET}
                    >
                      {REMOVE_PORTFOLIO_ACCESS_LABEL}
                    </Button>
                  ) : null}
                  <Button
                    variant="outlined"
                    color="error"
                    onClick={() => show({ kind: "one", app })}
                    aria-label={`„${app.clientName}“ trennen`}
                    sx={TOUCH_TARGET}
                  >
                    Trennen
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}
          <div>
            <Button variant="outlined" color="error" onClick={() => show({ kind: "all", count: apps.length })} sx={TOUCH_TARGET}>
              Alle trennen
            </Button>
          </div>
        </Stack>
      )}
      <Dialog
        open={open}
        onClose={hide}
        fullScreen={fullScreen}
        fullWidth
        maxWidth="xs"
        aria-labelledby={titleId}
        slotProps={{ transition: { onEntered: () => cancelRef.current?.focus() } }}
      >
        <DialogTitle id={titleId}>
          {dialogTitle(target)}
        </DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Stack spacing={2}>
            {error ? (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            ) : null}
            <DialogContentText>{dialogText(target)}</DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button ref={cancelRef} onClick={hide} disabled={pending} autoFocus sx={TOUCH_TARGET}>
            Abbrechen
          </Button>
          <Button variant="contained" color="error" onClick={confirm} disabled={pending} sx={TOUCH_TARGET}>
            {target?.kind === "portfolio" ? REMOVE_PORTFOLIO_ACCESS_CONFIRM : "Trennen"}
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar
        open={toastOpen}
        autoHideDuration={6000}
        onClose={(_event, reason) => {
          if (reason !== "clickaway") setToastOpen(false);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {toast !== null ? (
          <Alert severity="success" variant="filled" onClose={() => setToastOpen(false)} role="status" sx={{ width: "100%" }}>
            {toast}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
