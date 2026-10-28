// German texts and helpers of the authorize page and its decision action (story 9.4).
import type { AuthorizeParams, AuthorizeValidation } from "@/modules/mcp";

export const NOT_CONFIGURED_MESSAGE = "Verbundene Apps sind nicht eingerichtet: APP_URL fehlt in der Server-Konfiguration.";
export const TOO_LONG_MESSAGE = "Die Anfrage dieser App ist zu lang.";

export const ERROR_PAGE_MESSAGES: Record<Extract<AuthorizeValidation, { kind: "error-page" }>["reason"], string> = {
  "client-unknown": "Diese App ist nicht registriert. Starte die Verbindung in der App erneut.",
  "redirect-uri-invalid": "Die Weiterleitungsadresse dieser App ist nicht registriert. Starte die Verbindung in der App erneut.",
};

/** Longest authorize path + query that still fits the login form's `next` (4096). */
export const MAX_AUTHORIZE_URL_LENGTH = 4000;

/** The authorize path with exactly the authorization parameters, as the login returns to it. */
export function authorizePath(params: AuthorizeParams): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(name, item);
  }
  const search = query.toString();
  return search ? `/oauth/authorize?${search}` : "/oauth/authorize";
}
