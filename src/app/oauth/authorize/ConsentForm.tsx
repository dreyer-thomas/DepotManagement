"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import { useActionState } from "react";
import { type ConsentState, decideAuthorization } from "./actions";

/** "Erlauben" / "Ablehnen": posts the authorization parameters back to the decision action. */
export function ConsentForm({ params }: { params: Record<string, string> }) {
  const [state, formAction, pending] = useActionState<ConsentState, FormData>(decideAuthorization, null);
  return (
    <form action={formAction}>
      <Stack spacing={2}>
        {state?.error ? (
          <Alert severity="error" role="alert">
            {state.error}
          </Alert>
        ) : null}
        {Object.entries(params).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Stack direction="row" spacing={1.5} sx={{ justifyContent: "flex-end" }}>
          <Button type="submit" name="decision" value="deny" variant="outlined" size="large" disabled={pending} sx={{ minHeight: 44 }}>
            Ablehnen
          </Button>
          <Button type="submit" name="decision" value="allow" variant="contained" size="large" disabled={pending} sx={{ minHeight: 44 }}>
            Erlauben
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}
