// `APP_URL` (AD-18): the public origin of the app, OAuth issuer and base of the MCP resource (AD-22).

export type McpConfig = {
  /** Issuer identifier = `APP_URL` without a trailing `/`, e.g. `https://depot.example.com`. */
  issuer: string;
  /** The protected resource (RFC 8707/9728): `<issuer>/api/mcp`. */
  resource: string;
  /** Where the protected-resource metadata of `/api/mcp` is served (RFC 9728 path-suffixed form). */
  resourceMetadataUrl: string;
};

export const MCP_PATH = "/api/mcp";

/**
 * Reads `APP_URL`: an absolute `http(s)` origin without path, query, fragment or credentials (one
 * trailing `/` is allowed and stripped). Null when unset or invalid; every OAuth/MCP route then answers 503.
 */
export function readMcpConfig(env: Readonly<Record<string, string | undefined>>): McpConfig | null {
  const raw = env.APP_URL?.trim();
  if (!raw) return null;
  const value = raw.endsWith("/") ? raw.slice(0, -1) : raw;
  if (value.includes("?") || value.includes("#")) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "" || url.pathname !== "/" || url.hostname === "") return null;
  // `new URL` normalises the path to "/"; a value with any path (even "/x" or "//") is refused here.
  if (!/^https?:\/\/[^/]+$/i.test(value)) return null;
  const issuer = url.origin;
  return {
    issuer,
    resource: `${issuer}${MCP_PATH}`,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource${MCP_PATH}`,
  };
}
