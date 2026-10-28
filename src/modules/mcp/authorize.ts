// OAuth 2.1 authorization endpoint logic (story 9.4): request validation, the consent decision and the
// authorization code. The page and its server action in `src/app/oauth/authorize` stay thin.
import { prisma } from "@/db";
import { findClient, type McpDb } from "./clients";
import type { McpConfig } from "./config";
import { hashSecret, isValidCodeChallenge, randomToken } from "./crypto";
import { deleteExpiredTokens } from "./tokens";

/** Always granted on "Erlauben". */
export const WATCHLIST_SCOPE = "watchlist";
/** Opt-in (story 10.1): granted only when requested and the consent checkbox is checked. */
export const PORTFOLIO_READ_SCOPE = "portfolio:read";
export const SUPPORTED_SCOPES: readonly string[] = [WATCHLIST_SCOPE, PORTFOLIO_READ_SCOPE];

export const CODE_TTL_MS = 10 * 60 * 1000;

/**
 * The scope granted for a requested `scope` parameter, or null when it names anything other than
 * `watchlist` / `portfolio:read` (`invalid_scope`). Absent or empty → `watchlist`. Always the base scope
 * `watchlist`: `portfolio:read` is added only by `approveAuthorization` when the consent checkbox was checked.
 * Pure.
 */
export function grantedScope(requested: string | undefined): string | null {
  const names = (requested ?? "").split(" ").filter((name) => name !== "");
  if (!names.every((name) => SUPPORTED_SCOPES.includes(name))) return null;
  return WATCHLIST_SCOPE;
}

/** Raw query parameters of an authorization request (`string[]` = repeated parameter). */
export type AuthorizeParams = Record<string, string | string[] | undefined>;

export type AuthorizeRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  /** Host shown on the consent page ("Weiterleitung an …"). */
  redirectHost: string;
  state: string | undefined;
  codeChallenge: string;
  /** The base scope granted on "Erlauben" (`watchlist`). */
  scope: string;
  /** The request named `portfolio:read`: the consent page offers the checkbox. */
  portfolioReadRequested: boolean;
};

export type AuthorizeValidation =
  /** Unknown client or a redirect URI that is not exactly registered: never redirect, show an error page. */
  | { kind: "error-page"; reason: "client-unknown" | "redirect-uri-invalid" }
  /** A problem reported to the client by redirecting to its redirect URI. */
  | { kind: "redirect"; url: string }
  | { kind: "ok"; request: AuthorizeRequest };

/** The parameters the consent form carries back to the decision action. */
export const AUTHORIZE_PARAM_NAMES = [
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "code_challenge",
  "code_challenge_method",
  "scope",
  "resource",
] as const;

function single(value: string | string[] | undefined): string | undefined | null {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value;
}

/** `redirectUri` with `params` added to its query (existing query parameters are kept). */
export function redirectWith(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.append(name, value);
  }
  return url.toString();
}

/**
 * Validates an authorization request. Client and redirect URI are checked first (failures show an error
 * page); then `response_type`, PKCE (S256 only; absent counts as wrong), `resource` and `scope`, each
 * reported by redirecting with `error`, `state` and `iss`.
 */
export async function validateAuthorizeRequest(
  params: AuthorizeParams,
  config: McpConfig,
  db: McpDb = prisma,
): Promise<AuthorizeValidation> {
  const clientId = single(params.client_id);
  const client = clientId ? await findClient(clientId, db) : null;
  if (!client) return { kind: "error-page", reason: "client-unknown" };
  const redirectUri = single(params.redirect_uri);
  if (!redirectUri || !client.redirectUris.includes(redirectUri)) return { kind: "error-page", reason: "redirect-uri-invalid" };

  const state = single(params.state);
  const fail = (error: string) => ({
    kind: "redirect" as const,
    url: redirectWith(redirectUri, { error, state: state ?? undefined, iss: config.issuer }),
  });
  // A repeated parameter is ambiguous (RFC 6749 §3.1).
  for (const name of AUTHORIZE_PARAM_NAMES) {
    if (single(params[name]) === null) return fail("invalid_request");
  }
  if (single(params.response_type) !== "code") return fail("unsupported_response_type");
  const codeChallenge = single(params.code_challenge);
  if (!isValidCodeChallenge(codeChallenge) || single(params.code_challenge_method) !== "S256") return fail("invalid_request");
  const resource = single(params.resource);
  if (resource !== undefined && resource !== config.resource) return fail("invalid_target");
  const requestedScope = single(params.scope) ?? undefined;
  const scope = grantedScope(requestedScope);
  if (scope === null) return fail("invalid_scope");

  return {
    kind: "ok",
    request: {
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri,
      redirectHost: new URL(redirectUri).host,
      state: state ?? undefined,
      codeChallenge,
      scope,
      portfolioReadRequested: (requestedScope ?? "").split(" ").includes(PORTFOLIO_READ_SCOPE),
    },
  };
}

/**
 * "Erlauben": stores a new single-use code (10 min, hashed) and returns the redirect with code, state, iss.
 * The code carries `watchlist portfolio:read` only when the request named `portfolio:read` and the consent
 * checkbox was checked (`portfolioRead`); a forged checkbox value without the requested scope adds nothing.
 */
export async function approveAuthorization(
  request: AuthorizeRequest,
  config: McpConfig,
  db: McpDb = prisma,
  now: () => Date = () => new Date(),
  portfolioRead = false,
): Promise<string> {
  const client = await findClient(request.clientId, db);
  if (!client) throw new Error("client vanished");
  const issuedAt = now();
  await deleteExpiredTokens(db, issuedAt);
  const code = randomToken();
  await db.oAuthToken.create({
    data: {
      kind: "CODE",
      hash: hashSecret(code),
      clientId: client.id,
      scope: portfolioRead && request.portfolioReadRequested ? `${request.scope} ${PORTFOLIO_READ_SCOPE}` : request.scope,
      resource: config.resource,
      codeChallenge: request.codeChallenge,
      redirectUri: request.redirectUri,
      expiresAt: new Date(issuedAt.getTime() + CODE_TTL_MS).toISOString(),
      createdAt: issuedAt.toISOString(),
    },
  });
  return redirectWith(request.redirectUri, { code, state: request.state, iss: config.issuer });
}

/** "Ablehnen": the redirect with `error=access_denied`. */
export function denyAuthorization(request: AuthorizeRequest, config: McpConfig): string {
  return redirectWith(request.redirectUri, { error: "access_denied", state: request.state, iss: config.issuer });
}
