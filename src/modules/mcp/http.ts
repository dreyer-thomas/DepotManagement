// Request handlers behind the thin route files (story 9.4). Every OAuth/MCP route answers 503 while
// `APP_URL` is unset or invalid. Logs never contain tokens, codes, verifiers, secrets, bodies or payload values.
import { businessDate } from "@/core/dates";
import { prisma } from "@/db";
import { lookupIsinDetails } from "@/modules/prices";
import { registerClient, type McpDb } from "./clients";
import { type McpConfig, readMcpConfig } from "./config";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
import { handleMcpMessage } from "./server";
import { exchangeToken, verifyAccessToken } from "./tokens";
import type { McpToolContext } from "./tools";

export type McpHttpDeps = {
  env?: Readonly<Record<string, string | undefined>>;
  db?: McpDb;
  now?: () => Date;
  lookupIsin?: McpToolContext["lookupIsin"];
  /** Passed in by the app layer: revalidation and the price backfill after a successful write. */
  onWatchlistChange?: McpToolContext["onWatchlistChange"];
};

const MAX_FORM_BYTES = 16 * 1024;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_MCP_BYTES = 1024 * 1024;

const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** The config, or the 503 answer every OAuth/MCP route gives without a valid `APP_URL`. */
export function mcpConfigOr503(deps: McpHttpDeps = {}): { config: McpConfig } | { response: Response } {
  const config = readMcpConfig(deps.env ?? process.env);
  if (config) return { config };
  console.error("OAuth/MCP: APP_URL is missing or invalid; answering 503");
  return { response: json({ error: "server_error" }, 503) };
}

export function methodNotAllowed(allow: string): Response {
  return json({ error: "method_not_allowed" }, 405, { Allow: allow });
}

/** Reads a request body as a stream up to `limit` bytes; null as soon as it is larger, or when unreadable. */
async function readBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks).toString("utf8");
}

function mediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

/** `GET /.well-known/oauth-protected-resource[/api/mcp]` (RFC 9728). */
export function handleProtectedResourceMetadata(deps: McpHttpDeps = {}): Response {
  const configured = mcpConfigOr503(deps);
  if ("response" in configured) return configured.response;
  return json(protectedResourceMetadata(configured.config));
}

/** `GET /.well-known/oauth-authorization-server` (RFC 8414). */
export function handleAuthorizationServerMetadata(deps: McpHttpDeps = {}): Response {
  const configured = mcpConfigOr503(deps);
  if ("response" in configured) return configured.response;
  return json(authorizationServerMetadata(configured.config));
}

/** `POST /oauth/register` (RFC 7591): JSON metadata → 201 with the client, or 400. */
export async function handleRegister(request: Request, deps: McpHttpDeps = {}): Promise<Response> {
  const configured = mcpConfigOr503(deps);
  if ("response" in configured) return configured.response;
  if (mediaType(request) !== "application/json") {
    return json({ error: "invalid_client_metadata", error_description: "Content-Type must be application/json." }, 400);
  }
  const text = await readBody(request, MAX_JSON_BYTES);
  let body: unknown;
  try {
    body = text === null ? undefined : JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (body === undefined) return json({ error: "invalid_client_metadata", error_description: "The body must be a JSON object." }, 400);
  const result = await registerClient(body, deps.db ?? prisma, deps.now);
  if (!result.ok) return json({ error: result.error, error_description: result.error_description }, 400);
  return json(result.body, 201);
}

/** `POST /oauth/token` (form-encoded): RFC 6749 JSON answers, always `no-store`. */
export async function handleToken(request: Request, deps: McpHttpDeps = {}): Promise<Response> {
  const configured = mcpConfigOr503(deps);
  if ("response" in configured) return configured.response;
  if (mediaType(request) !== "application/x-www-form-urlencoded") {
    return json({ error: "invalid_request", error_description: "Content-Type must be application/x-www-form-urlencoded." }, 400);
  }
  const text = await readBody(request, MAX_FORM_BYTES);
  if (text === null) return json({ error: "invalid_request", error_description: "The request body is too large." }, 400);
  const result = await exchangeToken(
    { form: new URLSearchParams(text), authorization: request.headers.get("authorization") },
    configured.config,
    deps.db ?? prisma,
    deps.now,
  );
  if (result.ok) return json(result.body);
  return json(
    { error: result.error, error_description: result.description },
    result.status,
    result.basicChallenge ? { "WWW-Authenticate": 'Basic realm="oauth"' } : {},
  );
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

/**
 * `POST /api/mcp`: a valid access token of a non-revoked grant, else 401 with
 * `WWW-Authenticate: Bearer resource_metadata=…` (`error="invalid_token"` when a token was sent).
 */
export async function handleMcp(request: Request, deps: McpHttpDeps = {}): Promise<Response> {
  const configured = mcpConfigOr503(deps);
  if ("response" in configured) return configured.response;
  const { config } = configured;
  const db = deps.db ?? prisma;
  const now = deps.now ?? (() => new Date());
  const token = bearerToken(request);
  const grant = token === null ? null : await verifyAccessToken(token, config, db, now);
  if (!grant) {
    const challenge = `Bearer resource_metadata="${config.resourceMetadataUrl}"${token === null ? "" : ', error="invalid_token"'}`;
    return json({ error: token === null ? "unauthorized" : "invalid_token" }, 401, { "WWW-Authenticate": challenge });
  }
  const body = await readBody(request, MAX_MCP_BYTES);
  if (body === null) return json({ error: "payload_too_large" }, 413);
  try {
    return await handleMcpMessage(new Request(request.url, { method: request.method, headers: request.headers, body }), {
      db,
      today: businessDate(now()),
      scopes: grant.scopes,
      clientName: grant.clientName,
      lookupIsin: deps.lookupIsin ?? ((isin) => lookupIsinDetails(isin)),
      onWatchlistChange: deps.onWatchlistChange ?? (() => {}),
    });
  } catch (error) {
    console.error(`MCP: request failed (${error instanceof Error ? error.name : "unknown"})`);
    return json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }, 500);
  }
}
