"use client";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type FormEvent, useState, useTransition } from "react";
import { openingBalanceAction, type OpeningBalanceActionResult } from "@/app/_actions/migration";
import { formatDate, formatMoney } from "@/core/format";
import { ACTION_FAILED_MESSAGE, openingBalanceFailureMessage, openingBalanceSuccess } from "./labels";

const TOUCH_TARGET = { minHeight: 44 };

export type OpeningBalanceOffer = { date: string; asOf: string; ledgerBalance: string };

/**
 * "Eröffnungsbuchung" for a file without Cash rows: the broker's balance at export date is entered; the
 * difference to the Depot's ledger balance is booked as a DEPOSIT or WITHDRAWAL on the chosen date.
 */
export function OpeningBalanceForm({ depotId, offer }: { depotId: string; offer: OpeningBalanceOffer }) {
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(offer.date);
  const [result, setResult] = useState<OpeningBalanceActionResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData();
    data.set("depotId", depotId);
    data.set("date", date);
    data.set("asOf", offer.asOf);
    data.set("balance", balance);
    startTransition(async () => {
      try {
        setResult(await openingBalanceAction(data));
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  };

  const done = result?.ok === true;
  return (
    <Box component="section" aria-labelledby="parqet-opening-title" sx={{ mt: 2 }}>
      <Typography id="parqet-opening-title" component="h4" variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
        Eröffnungsbuchung
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Saldo im Depot am {formatDate(offer.asOf)}: {formatMoney(offer.ledgerBalance)}. Gib den Saldo des
        Verrechnungskontos laut Broker an diesem Tag ein; die Differenz wird als Ein- oder Auszahlung gebucht.
      </Typography>
      <form onSubmit={submit} noValidate aria-label="Eröffnungsbuchung">
        <Stack spacing={2}>
          {failed ? (
            <Alert severity="error" role="alert">
              {ACTION_FAILED_MESSAGE}
            </Alert>
          ) : null}
          {!failed && result && !result.ok ? (
            <Alert severity="error" role="alert">
              {openingBalanceFailureMessage(result, offer.asOf)}
            </Alert>
          ) : null}
          {!failed && result?.ok ? (
            <Alert severity="success" role="status">
              {openingBalanceSuccess(result, offer.asOf)}
            </Alert>
          ) : null}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <TextField
              name="balance"
              label={`Saldo laut Broker am ${formatDate(offer.asOf)}`}
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              disabled={pending || done}
              slotProps={{ htmlInput: { inputMode: "decimal" } }}
              fullWidth
            />
            <TextField
              name="date"
              type="date"
              label="Buchungsdatum"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={pending || done}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: offer.asOf } }}
              fullWidth
            />
          </Stack>
          <Box>
            <Button type="submit" variant="contained" disabled={pending || done} sx={TOUCH_TARGET}>
              {pending ? "Wird gebucht …" : "Eröffnungsbuchung buchen"}
            </Button>
          </Box>
        </Stack>
      </form>
    </Box>
  );
}
