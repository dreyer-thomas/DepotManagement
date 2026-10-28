// The mcp module (story 9.4, AD-22) owns OAuthClient, OAuthGrant and OAuthToken. It serves the OAuth 2.1
// authorization server (metadata, dynamic registration, consent, token endpoint) and the stateless MCP endpoint
// `/api/mcp`, whose tools are thin adapters over the `watchlist`, `ledger` and `prices` services. Route files
// in `src/app` only call the handlers exported here.
export { readMcpConfig, MCP_PATH } from "./config";
export type { McpConfig } from "./config";
export {
  approveAuthorization,
  AUTHORIZE_PARAM_NAMES,
  denyAuthorization,
  grantedScope,
  validateAuthorizeRequest,
  WATCHLIST_SCOPE,
} from "./authorize";
export type { AuthorizeParams, AuthorizeRequest, AuthorizeValidation } from "./authorize";
export { findClient, isAllowedRedirectUri, registerClient } from "./clients";
export type { McpDb, RegisteredClient, RegistrationResult } from "./clients";
export { exchangeToken, revokeGrant, verifyAccessToken } from "./tokens";
export type { AuthorizedGrant, TokenResult } from "./tokens";
export { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
export {
  handleAuthorizationServerMetadata,
  handleMcp,
  handleProtectedResourceMetadata,
  handleRegister,
  handleToken,
  mcpConfigOr503,
  methodNotAllowed,
} from "./http";
export type { McpHttpDeps } from "./http";
export { WATCHLIST_TOOL_NAMES } from "./tools";
export type { McpToolContext } from "./tools";
export { clearOAuth } from "./backup";
