import { describe, expect, it } from "vitest";
import { PORTFOLIO_READ_SCOPE as MCP_PORTFOLIO_READ_SCOPE } from "@/modules/mcp";
import {
  claudeCodeCommand,
  connectedAppsErrorMessage,
  connectedSinceLine,
  disconnectAllTitle,
  disconnectedToast,
  disconnectTitle,
  hasPortfolioAccess,
  PORTFOLIO_READ_SCOPE,
  lastUsedLine,
  mcpEndpointUrl,
  portfolioAccessRemovedToast,
  removePortfolioAccessAriaLabel,
  removePortfolioAccessText,
  removePortfolioAccessTitle,
  scopesText,
} from "./labels";

describe("connected-apps labels", () => {
  it("names scopes in plain German and unknown scopes verbatim", () => {
    expect(scopesText(["watchlist"])).toBe("Watchlists lesen und ändern");
    expect(scopesText(["watchlist", "portfolio:read", "foo"])).toBe(
      "Watchlists lesen und ändern, Depotdaten lesen (nur lesen), foo",
    );
    expect(scopesText([])).toBe("");
  });

  it("formats connected-since and last-used in Europe/Berlin", () => {
    expect(connectedSinceLine("2026-10-28T10:00:00.000Z")).toBe("Verbunden seit 28.10.2026, 11:00");
    expect(lastUsedLine("2026-07-01T10:05:00.000Z")).toBe("Zuletzt verwendet 01.07.2026, 12:05");
    expect(lastUsedLine(null)).toBe("Zuletzt verwendet: noch nie");
  });

  it("words dialogs, toasts and errors", () => {
    expect(disconnectTitle("Claude")).toBe("„Claude“ trennen?");
    expect(disconnectAllTitle(3)).toBe("Alle 3 verbundenen Apps trennen?");
    expect(disconnectedToast("Claude")).toBe("„Claude“ getrennt.");
    expect(connectedAppsErrorMessage("not-found")).toBe("Diese Verbindung besteht nicht mehr.");
    expect(connectedAppsErrorMessage("unauthorized")).toBe("Sitzung abgelaufen. Bitte erneut anmelden.");
  });

  it("mirrors the mcp module's portfolio scope", () => {
    expect(PORTFOLIO_READ_SCOPE).toBe(MCP_PORTFOLIO_READ_SCOPE);
  });

  it("words Depotzugriff entfernen and detects portfolio:read", () => {
    expect(hasPortfolioAccess(["watchlist", "portfolio:read"])).toBe(true);
    expect(hasPortfolioAccess(["watchlist"])).toBe(false);
    expect(removePortfolioAccessAriaLabel("Claude")).toBe("Depotzugriff für „Claude“ entfernen");
    expect(removePortfolioAccessTitle("Claude")).toBe("Depotzugriff für „Claude“ entfernen?");
    expect(removePortfolioAccessText("Claude")).toBe(
      "„Claude“ kann danach keine Depots, Bestände, Umsätze und Kennzahlen mehr lesen. Die Verbindung und die Watchlists bleiben bestehen; zum erneuten Freigeben die App neu verbinden.",
    );
    expect(portfolioAccessRemovedToast("Claude")).toBe("Depotzugriff für „Claude“ entfernt.");
  });

  it("builds the connector URL and the Claude Code command, with a placeholder without APP_URL", () => {
    expect(mcpEndpointUrl("https://depot.example.com")).toBe("https://depot.example.com/api/mcp");
    expect(claudeCodeCommand("https://depot.example.com")).toBe(
      "claude mcp add --transport http depotmanagement https://depot.example.com/api/mcp",
    );
    expect(mcpEndpointUrl(null)).toBe("<APP_URL>/api/mcp");
  });
});
