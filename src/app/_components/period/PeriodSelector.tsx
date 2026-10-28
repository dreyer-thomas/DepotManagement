"use client";

import EditCalendarOutlined from "@mui/icons-material/EditCalendarOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState, useTransition } from "react";
import { setPeriodAction } from "@/app/_actions/period";
import { isBusinessDate } from "@/core/dates";
import { SELECTABLE_PRESETS, type PeriodPreset, type PeriodSelection, periodLabel } from "@/core/period";

const UNAUTHORIZED_MESSAGE = "Sitzung abgelaufen. Bitte erneut anmelden.";
const ACTION_FAILED_MESSAGE = "Verbindung fehlgeschlagen. Bitte erneut versuchen.";
const INVALID_MESSAGE = "Zeitraum ungültig.";

type Choice = PeriodPreset | "custom";

/** Why a custom range from the dialog is invalid; `null` when it may be saved. */
export function customRangeError(from: string, to: string, today: string): string | null {
  if (!isBusinessDate(from) || !isBusinessDate(to)) return "Bitte gültige Daten für Von und Bis eingeben.";
  if (from > to) return "Von darf nicht nach Bis liegen.";
  if (to > today) return "Bis darf nicht nach heute liegen.";
  return null;
}

const PILL = {
  minHeight: 44,
  minWidth: 44,
  px: { xs: 1, sm: 1.5 },
  border: 0,
  borderRadius: "999px !important",
  textTransform: "none",
  fontWeight: 500,
  color: "text.primary",
  "&.Mui-selected, &.Mui-selected:hover": { bgcolor: "primary.main", color: "primary.contrastText", fontWeight: 600 },
} as const;

/**
 * Global Period selector (1T · 1W · 1M · YTD · 1J · 3J · Benutzerdefiniert). A pill stores the choice via
 * the server action (cookie) and refreshes the page; "Benutzerdefiniert" opens a Von/Bis dialog whose
 * range must satisfy `from ≤ to ≤ today` before anything is saved. Below `sm` that pill shows a
 * calendar icon instead of the word, so the row fits a phone.
 */
export function PeriodSelector({ period, today }: { period: PeriodSelection; today: string }) {
  const router = useRouter();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down("sm"));
  const titleId = useId();
  const current: Choice = period.kind === "custom" ? "custom" : period.preset;
  const [pending, setPending] = useState<Choice | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [from, setFrom] = useState(period.kind === "custom" ? period.from : today);
  const [to, setTo] = useState(period.kind === "custom" ? period.to : today);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  // Locked from the click until the refreshed page has rendered (or the save failed).
  const busy = pending !== null || refreshing;

  /**
   * Saves `text`; returns an error message or `null` on success. On success the choice stays selected
   * and the selector locked until the refreshed page lands (`pending` is cleared in the same transition).
   */
  const save = async (text: string, choice: Choice): Promise<string | null> => {
    setPending(choice);
    let error: string | null;
    try {
      const result = await setPeriodAction(text);
      error = result.ok ? null : result.reason === "unauthorized" ? UNAUTHORIZED_MESSAGE : INVALID_MESSAGE;
    } catch {
      error = ACTION_FAILED_MESSAGE;
    }
    if (error) {
      setPending(null);
      return error;
    }
    startRefresh(() => {
      router.refresh();
      setPending(null);
    });
    return null;
  };

  const choosePreset = async (preset: PeriodPreset) => {
    if (preset === current || busy) return;
    setMessage(await save(preset, preset));
  };

  const openDialog = () => {
    setFrom(period.kind === "custom" ? period.from : today);
    setTo(period.kind === "custom" ? period.to : today);
    setDialogError(null);
    setDialogOpen(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const invalid = customRangeError(from, to, today);
    if (invalid) {
      setDialogError(invalid);
      return;
    }
    const error = await save(`custom:${from}:${to}`, "custom");
    if (error) setDialogError(error);
    else setDialogOpen(false);
  };

  return (
    <>
      <ToggleButtonGroup
        value={pending ?? current}
        exclusive
        aria-label="Zeitraum"
        disabled={busy}
        sx={{
          flexWrap: "wrap",
          maxWidth: "100%",
          gap: 0.5,
          p: 0.5,
          bgcolor: "background.paper",
          borderRadius: 999,
          boxShadow: 1,
        }}
      >
        {SELECTABLE_PRESETS.map((preset) => (
          <ToggleButton key={preset} value={preset} onClick={() => void choosePreset(preset)} sx={PILL}>
            {periodLabel({ kind: "preset", preset })}
          </ToggleButton>
        ))}
        <ToggleButton
          value="custom"
          onClick={openDialog}
          sx={PILL}
          aria-label="Benutzerdefiniert"
          title={period.kind === "custom" ? periodLabel(period) : "Benutzerdefiniert"}
        >
          <EditCalendarOutlined aria-hidden fontSize="small" sx={{ display: { xs: "block", sm: "none" } }} />
          <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
            Benutzerdefiniert
          </Box>
        </ToggleButton>
      </ToggleButtonGroup>
      <Dialog
        open={dialogOpen}
        onClose={() => {
          if (!busy) setDialogOpen(false);
        }}
        fullScreen={fullScreen}
        fullWidth
        maxWidth="xs"
        aria-labelledby={titleId}
      >
        <DialogTitle id={titleId}>Zeitraum wählen</DialogTitle>
        <form onSubmit={submit} noValidate>
          <DialogContent sx={{ pt: 1 }}>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {dialogError ? (
                <Alert severity="error" role="alert">
                  {dialogError}
                </Alert>
              ) : null}
              <TextField
                label="Von"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
                required
              />
              <TextField
                label="Bis"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
                required
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)} disabled={busy} sx={{ minHeight: 44 }}>
              Abbrechen
            </Button>
            <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 44 }}>
              Übernehmen
            </Button>
          </DialogActions>
        </form>
      </Dialog>
      <Snackbar
        open={message !== null}
        onClose={(_event, reason) => {
          if (reason !== "clickaway") setMessage(null);
        }}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {message ? (
          <Alert severity="error" variant="filled" role="alert" onClose={() => setMessage(null)} sx={{ width: "100%" }}>
            {message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
