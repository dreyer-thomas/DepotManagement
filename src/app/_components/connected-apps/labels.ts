// German texts of Settings › Verbundene Apps (story 9.5).
import { formatDateTime } from "@/core/format";

const SCOPE_LABELS: Readonly<Record<string, string>> = {
  watchlist: "Watchlists lesen und ändern",
  "portfolio:read": "Depotdaten lesen (nur lesen)",
};

/** Scopes in plain German, joined with ", "; an unknown scope is shown verbatim. */
export function scopesText(scopes: readonly string[]): string {
  return scopes.map((scope) => SCOPE_LABELS[scope] ?? scope).join(", ");
}

/** "Verbunden seit 28.10.2026, 11:00" (Europe/Berlin). */
export function connectedSinceLine(createdAt: string): string {
  return `Verbunden seit ${formatDateTime(createdAt)}`;
}

/** "Zuletzt verwendet 28.10.2026, 11:00", or "Zuletzt verwendet: noch nie". */
export function lastUsedLine(lastUsedAt: string | null): string {
  return lastUsedAt === null ? "Zuletzt verwendet: noch nie" : `Zuletzt verwendet ${formatDateTime(lastUsedAt)}`;
}

export function disconnectTitle(clientName: string): string {
  return `„${clientName}“ trennen?`;
}

export function disconnectText(clientName: string): string {
  return `„${clientName}“ verliert sofort den Zugriff auf die App und muss sich zum erneuten Verbinden wieder anmelden.`;
}

export function disconnectAllTitle(count: number): string {
  return `Alle ${count} verbundenen Apps trennen?`;
}

export const DISCONNECT_ALL_TEXT =
  "Alle Apps verlieren sofort den Zugriff auf die App und müssen sich zum erneuten Verbinden wieder anmelden.";

export function disconnectedToast(clientName: string): string {
  return `„${clientName}“ getrennt.`;
}

export const ALL_DISCONNECTED_TOAST = "Alle Apps getrennt.";

export type ConnectedAppsErrorReason = "not-found" | "unauthorized";

const ERROR_MESSAGES: Record<ConnectedAppsErrorReason, string> = {
  "not-found": "Diese Verbindung besteht nicht mehr.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** A thrown action (e.g. the server is unreachable). */
export const ACTION_FAILED_MESSAGE = "Verbindung fehlgeschlagen. Bitte erneut versuchen.";

export function connectedAppsErrorMessage(reason: ConnectedAppsErrorReason): string {
  return ERROR_MESSAGES[reason];
}

/** The MCP endpoint a client connects to; a placeholder while `APP_URL` is unset. */
export function mcpEndpointUrl(issuer: string | null): string {
  return `${issuer ?? "<APP_URL>"}/api/mcp`;
}

/** The Claude Code command adding the connector. */
export function claudeCodeCommand(issuer: string | null): string {
  return `claude mcp add --transport http depotmanagement ${mcpEndpointUrl(issuer)}`;
}
