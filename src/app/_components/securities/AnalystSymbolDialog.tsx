"use client";

import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, useState, useTransition } from "react";
import { setAnalystSymbolAction } from "@/app/_actions/classification";
import { SecurityDialog, TOUCH_TARGET, useDialog } from "./SecurityDialog";
import { analystSymbolErrorMessage } from "./labels";

type StockSecurity = { id: string; name: string };

function AnalystSymbolForm({ security, symbol, onClose }: { security: StockSecurity; symbol: string | null; onClose: () => void }) {
  const [value, setValue] = useState(symbol ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      try {
        const result = await setAnalystSymbolAction(security.id, value);
        if (result.ok) onClose();
        else setError(analystSymbolErrorMessage(result.reason));
      } catch {
        setError(analystSymbolErrorMessage("action-failed"));
      }
    });
  };

  return (
    <form onSubmit={submit} noValidate>
      <DialogContent sx={{ pt: 1 }}>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            {security.name}
          </Typography>
          <Typography variant="body2">
            Yahoo-Symbol der Heimatbörse, von dem die Analystenbewertungen stammen (z. B. AAPL für Apple).
          </Typography>
          <TextField
            name="analystSymbol"
            label="Analysten-Symbol"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            error={error !== null}
            helperText={error ?? "Leer lassen = automatisch per ISIN ermitteln"}
            fullWidth
            slotProps={{ htmlInput: { autoComplete: "off", autoCapitalize: "characters", spellCheck: false, maxLength: 40 } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: "wrap", gap: 1 }}>
        <Button onClick={onClose} disabled={pending} sx={TOUCH_TARGET}>
          Abbrechen
        </Button>
        <Button type="submit" variant="contained" disabled={pending} sx={TOUCH_TARGET}>
          Speichern
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * Button "Analysten-Symbol" of a stock (story 9.7): edits the Yahoo symbol its analyst ratings come from
 * (prefilled with the current one); an empty field returns it to automatic (resolved by ISIN).
 */
export function AnalystSymbolButton({ security, symbol }: { security: StockSecurity; symbol: string | null }) {
  const dialog = useDialog();
  return (
    <>
      <Button
        variant="outlined"
        size="small"
        onClick={dialog.show}
        aria-label={`Analysten-Symbol bearbeiten – ${security.name}`}
        sx={TOUCH_TARGET}
      >
        Analysten-Symbol
      </Button>
      <SecurityDialog open={dialog.open} onClose={dialog.hide} title="Analysten-Symbol">
        <AnalystSymbolForm key={dialog.session} security={security} symbol={symbol} onClose={dialog.hide} />
      </SecurityDialog>
    </>
  );
}
