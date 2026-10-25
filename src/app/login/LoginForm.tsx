"use client";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useActionState } from "react";
import { login, type LoginState } from "./actions";

const initialState: LoginState = { failed: false, username: "", attempt: 0 };

/** Login form: Enter submits; on failure the username stays and the password is cleared. */
export function LoginForm({ next, expired }: { next: string; expired: boolean }) {
  const [state, formAction, pending] = useActionState(login, initialState);

  return (
    <form action={formAction} noValidate>
      <Stack spacing={2}>
        {state.failed ? (
          <Alert severity="error" role="alert">
            Anmeldung fehlgeschlagen.
          </Alert>
        ) : expired ? (
          <Alert severity="info">Sitzung abgelaufen. Bitte erneut anmelden.</Alert>
        ) : null}
        <input type="hidden" name="next" value={next} />
        <TextField
          name="username"
          label="Benutzername"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          fullWidth
          // Remount after each failed attempt: keeps the submitted username, works without JS too.
          key={`username-${state.attempt}`}
          defaultValue={state.username}
        />
        <TextField
          // Remount after each failed attempt so the password field is empty.
          key={`password-${state.attempt}`}
          name="password"
          type="password"
          label="Passwort"
          autoComplete="current-password"
          required
          fullWidth
        />
        <Button type="submit" variant="contained" size="large" disabled={pending} sx={{ minHeight: 44 }}>
          Anmelden
        </Button>
      </Stack>
    </form>
  );
}
