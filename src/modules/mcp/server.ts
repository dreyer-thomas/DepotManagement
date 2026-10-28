// One stateless Streamable-HTTP MCP request (AD-22): a fresh server and transport per request, JSON
// responses, no sessions and no SSE stream.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerPortfolioTools } from "./portfolio-tools";
import { type McpToolContext, registerWatchlistTools } from "./tools";

export const MCP_SERVER_INFO = { name: "depotmanagement", version: "1.0.0" } as const;

const INSTRUCTIONS =
  "DepotManagement: manage Tommy's watchlists of investment ideas and, with permission, read his portfolio (read-only). Decimals are strings, dates YYYY-MM-DD (Europe/Berlin). " +
  "Use search_securities to find known Securities; add_watchlist_entry also accepts a new ISIN or crypto symbol. " +
  "Portfolio tools such as list_depots are read-only and need the Depotdaten permission (portfolio:read) granted on the consent page.";

/** Builds the MCP server with the tools the grant allows. */
export function createMcpServer(ctx: McpToolContext): McpServer {
  const server = new McpServer(MCP_SERVER_INFO, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  registerWatchlistTools(server, ctx);
  registerPortfolioTools(server, ctx);
  return server;
}

/** Answers one authenticated MCP POST. */
export async function handleMcpMessage(request: Request, ctx: McpToolContext): Promise<Response> {
  const server = createMcpServer(ctx);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
