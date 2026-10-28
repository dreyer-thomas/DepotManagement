// Portfolio read tools (Epic 10, scope `portfolio:read`). Registered for every grant so a client without the
// scope gets the specific refusal instead of "unknown tool"; each tool checks the scope at call time through
// `requirePortfolioRead` and then calls an exported module service. Read-only; amounts are decimal strings;
// payload values are never logged. Story 10.1 adds `list_depots`; story 10.2 adds the other read tools.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { type DepotSummary, listDepots } from "@/modules/ledger";
import { PORTFOLIO_READ_SCOPE } from "./authorize";
import { guarded, type Handler, type McpToolContext, result } from "./tools";

export const PORTFOLIO_TOOL_NAMES = ["list_depots"] as const;

export const PORTFOLIO_READ_DENIED_MESSAGE = "Keine Berechtigung für Depotdaten";

function denied(): CallToolResult {
  return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: "portfolio-read-required", message: PORTFOLIO_READ_DENIED_MESSAGE }) }] };
}

/** Call-time scope gate: without `portfolio:read` the body (and every service) is never reached. */
export function requirePortfolioRead<A>(ctx: McpToolContext, body: Handler<A>): Handler<A> {
  return async (args) => (ctx.scopes.includes(PORTFOLIO_READ_SCOPE) ? body(args) : denied());
}

function depotPayload(depot: DepotSummary) {
  return { id: depot.id, name: depot.name, broker: depot.broker, archived: depot.archived, cash_balance: depot.cashBalance };
}

/** Registers the portfolio read tools on `server`, each gated by `portfolio:read` at call time. */
export function registerPortfolioTools(server: McpServer, ctx: McpToolContext): void {
  server.registerTool(
    "list_depots",
    {
      description:
        "Lists all Depots (archived ones included, sorted by name) with broker and Cash Account balance (EUR decimal string). Needs the Depotdaten permission.",
      annotations: { readOnlyHint: true },
    },
    guarded(
      "list_depots",
      requirePortfolioRead(ctx, async () => result({ depots: (await listDepots(ctx.db)).map(depotPayload) })),
    ),
  );
}
