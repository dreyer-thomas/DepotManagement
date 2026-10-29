// OAuth token endpoint, grants and access-token checks (story 9.4, AD-22). Codes and tokens are opaque,
// stored only as SHA-256 hashes; refresh tokens rotate and a reused one revokes its whole grant. A client
// holds at most one active grant: a new authorization-code exchange revokes the client's older grants.
import { prisma } from "@/db";
import { findClient, type McpDb, type RegisteredClient } from "./clients";
import type { McpConfig } from "./config";
import { hashSecret, randomToken, safeEqual, verifyPkce } from "./crypto";

export const ACCESS_TOKEN_TTL_SECONDS = 3600;
export const REFRESH_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
/** `lastUsedAt` of a grant is written at most this often. */
export const LAST_USED_INTERVAL_MS = 60 * 1000;

export type TokenErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "invalid_scope"
  | "invalid_target";

export type TokenResult =
  | { ok: true; body: { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string } }
  | { ok: false; status: 400 | 401; error: TokenErrorCode; description: string; basicChallenge?: boolean };

function failure(error: TokenErrorCode, description: string): Extract<TokenResult, { ok: false }> {
  return { ok: false, status: 400, error, description };
}

/** Deletes every code and token whose expiry has passed (opportunistically, at issuance). */
export async function deleteExpiredTokens(db: McpDb, now: Date): Promise<void> {
  await db.oAuthToken.deleteMany({ where: { expiresAt: { lte: now.toISOString() } } });
}

/** Revokes a grant: sets `revokedAt` (once) and deletes all its codes and tokens. */
export async function revokeGrant(grantId: string, db: McpDb = prisma, now: () => Date = () => new Date()): Promise<void> {
  await db.oAuthGrant.updateMany({ where: { id: grantId, revokedAt: null }, data: { revokedAt: now().toISOString() } });
  await db.oAuthToken.deleteMany({ where: { grantId } });
}

/** Runs `write` in one DB transaction: its own, unless `db` already is one. */
export async function inTransaction<T>(db: McpDb, write: (tx: McpDb) => Promise<T>): Promise<T> {
  const client = db as McpDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") return client.$transaction((tx) => write(tx));
  return write(db);
}

async function issueTokenPair(
  db: McpDb,
  grant: { id: string; clientId: string; scope: string },
  resource: string,
  issuedAt: Date,
): Promise<Extract<TokenResult, { ok: true }>> {
  await deleteExpiredTokens(db, issuedAt);
  const accessToken = randomToken();
  const refreshToken = randomToken();
  const createdAt = issuedAt.toISOString();
  const common = { clientId: grant.clientId, grantId: grant.id, scope: grant.scope, resource, createdAt };
  await db.oAuthToken.create({
    data: {
      ...common,
      kind: "ACCESS",
      hash: hashSecret(accessToken),
      expiresAt: new Date(issuedAt.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    },
  });
  await db.oAuthToken.create({
    data: {
      ...common,
      kind: "REFRESH",
      hash: hashSecret(refreshToken),
      expiresAt: new Date(issuedAt.getTime() + REFRESH_TOKEN_TTL_MS).toISOString(),
    },
  });
  return {
    ok: true,
    body: { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_TOKEN_TTL_SECONDS, refresh_token: refreshToken, scope: grant.scope },
  };
}

/** Credentials of a token request: form fields plus an optional `Authorization: Basic` header. */
export type TokenRequest = { form: URLSearchParams; authorization: string | null };

function formValue(form: URLSearchParams, name: string): string | undefined | null {
  const values = form.getAll(name);
  if (values.length > 1) return null;
  return values[0];
}

function parseBasic(header: string): { clientId: string; secret: string } | null {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return null;
  try {
    // RFC 6749 §2.3.1: both parts are form-urlencoded.
    const decode = (value: string) => decodeURIComponent(value.replace(/\+/g, " "));
    return { clientId: decode(decoded.slice(0, colon)), secret: decode(decoded.slice(colon + 1)) };
  } catch {
    return null;
  }
}

/** Authenticates the client exactly by its registered `token_endpoint_auth_method`. */
async function authenticateClient(
  request: TokenRequest,
  db: McpDb,
): Promise<{ ok: true; client: RegisteredClient } | Extract<TokenResult, { ok: false }>> {
  // Only a Basic header carries client credentials; other schemes (e.g. Bearer) are ignored.
  const basicHeader = request.authorization !== null && /^basic(?:\s|$)/i.test(request.authorization) ? request.authorization : null;
  const basic = basicHeader ? parseBasic(basicHeader) : null;
  const unauthorized = (description: string): Extract<TokenResult, { ok: false }> => ({
    ok: false,
    status: 401,
    error: "invalid_client",
    description,
    basicChallenge: basicHeader !== null,
  });
  if (basicHeader !== null && basic === null) return unauthorized("Malformed Basic credentials.");
  const bodyClientId = formValue(request.form, "client_id");
  const bodySecret = formValue(request.form, "client_secret");
  if (bodyClientId === null || bodySecret === null) return failure("invalid_request", "Repeated client credentials.");
  if (basic && bodyClientId !== undefined && bodyClientId !== basic.clientId) return unauthorized("Conflicting client ids.");
  const client = await findClient(basic?.clientId ?? bodyClientId, db);
  if (!client) return unauthorized("Unknown client.");

  let secret: string | undefined;
  switch (client.tokenEndpointAuthMethod) {
    case "none":
      if (basic || bodySecret !== undefined) return unauthorized("This client does not use a secret.");
      return { ok: true, client };
    case "client_secret_post":
      if (basic) return unauthorized("This client authenticates with client_secret_post.");
      secret = bodySecret;
      break;
    case "client_secret_basic":
      if (!basic || bodySecret !== undefined) return unauthorized("This client authenticates with client_secret_basic.");
      secret = basic.secret;
      break;
  }
  if (!secret || !client.clientSecretHash || !safeEqual(hashSecret(secret), client.clientSecretHash)) {
    return unauthorized("Invalid client secret.");
  }
  return { ok: true, client };
}

/**
 * Token endpoint (RFC 6749 §3.2): `authorization_code` with PKCE S256 and `refresh_token` with rotation.
 * A reused code revokes the grant created from it; a reused refresh token revokes its whole grant.
 * A successful code exchange revokes the client's other active grants (the latest consent replaces them).
 */
export async function exchangeToken(
  request: TokenRequest,
  config: McpConfig,
  db: McpDb = prisma,
  now: () => Date = () => new Date(),
): Promise<TokenResult> {
  const auth = await authenticateClient(request, db);
  if (!auth.ok) return auth;
  const { client } = auth;
  const grantType = formValue(request.form, "grant_type");
  if (!grantType) return failure("invalid_request", "grant_type is required.");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") return failure("unsupported_grant_type", "Unsupported grant_type.");
  if (!client.grantTypes.includes(grantType)) return failure("unauthorized_client", "The client did not register this grant type.");
  const resource = formValue(request.form, "resource");
  if (resource === null) return failure("invalid_request", "Repeated resource.");
  if (resource !== undefined && resource !== config.resource) return failure("invalid_target", "Unknown resource.");
  return grantType === "authorization_code"
    ? exchangeCode(request.form, client, config, db, now())
    : refresh(request.form, client, config, db, now());
}

async function exchangeCode(
  form: URLSearchParams,
  client: RegisteredClient,
  config: McpConfig,
  db: McpDb,
  issuedAt: Date,
): Promise<TokenResult> {
  const code = formValue(form, "code");
  const redirectUri = formValue(form, "redirect_uri");
  const verifier = formValue(form, "code_verifier");
  if (!code || !redirectUri || !verifier) return failure("invalid_request", "code, redirect_uri and code_verifier are required.");
  const invalidGrant = failure("invalid_grant", "The authorization code is invalid, expired or was already used.");
  return inTransaction(db, async (tx): Promise<TokenResult> => {
    const row = await tx.oAuthToken.findUnique({ where: { hash: hashSecret(code) } });
    if (!row || row.kind !== "CODE") return invalidGrant;
    if (row.consumedAt !== null) {
      if (row.grantId) await revokeGrant(row.grantId, tx, () => issuedAt);
      return invalidGrant;
    }
    if (row.expiresAt <= issuedAt.toISOString()) return invalidGrant;
    if (row.clientId !== client.id || row.redirectUri !== redirectUri || row.resource !== config.resource) return invalidGrant;
    if (!row.codeChallenge || !verifyPkce(verifier, row.codeChallenge)) return invalidGrant;
    const consumed = await tx.oAuthToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: issuedAt.toISOString() } });
    if (consumed.count !== 1) return invalidGrant;
    const grant = await tx.oAuthGrant.create({
      data: { clientId: client.id, scope: row.scope, createdAt: issuedAt.toISOString() },
      select: { id: true, clientId: true, scope: true },
    });
    // The consumed code points at its grant until it expires, so a replay revokes the grant.
    await tx.oAuthToken.update({ where: { id: row.id }, data: { grantId: grant.id } });
    // One active grant per client: re-authorizing replaces the earlier consent.
    const older = await tx.oAuthGrant.findMany({
      where: { clientId: client.id, revokedAt: null, id: { not: grant.id } },
      select: { id: true },
    });
    for (const { id } of older) await revokeGrant(id, tx, () => issuedAt);
    return issueTokenPair(tx, grant, config.resource, issuedAt);
  });
}

async function refresh(
  form: URLSearchParams,
  client: RegisteredClient,
  config: McpConfig,
  db: McpDb,
  issuedAt: Date,
): Promise<TokenResult> {
  const token = formValue(form, "refresh_token");
  if (!token) return failure("invalid_request", "refresh_token is required.");
  const scope = formValue(form, "scope");
  if (scope === null) return failure("invalid_request", "Repeated scope.");
  const invalidGrant = failure("invalid_grant", "The refresh token is invalid, expired or was already used.");
  return inTransaction(db, async (tx): Promise<TokenResult> => {
    const row = await tx.oAuthToken.findUnique({
      where: { hash: hashSecret(token) },
      include: { grant: { select: { id: true, clientId: true, scope: true, revokedAt: true } } },
    });
    if (!row || row.kind !== "REFRESH" || !row.grant) return invalidGrant;
    if (row.clientId !== client.id) return invalidGrant;
    if (row.consumedAt !== null) {
      await revokeGrant(row.grant.id, tx, () => issuedAt);
      return invalidGrant;
    }
    if (row.grant.revokedAt !== null || row.expiresAt <= issuedAt.toISOString() || row.resource !== config.resource) return invalidGrant;
    if (scope !== undefined && scope !== "" && !scope.split(" ").filter(Boolean).every((name) => row.grant!.scope.split(" ").includes(name))) {
      return failure("invalid_scope", "The requested scope exceeds the grant.");
    }
    const consumed = await tx.oAuthToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: issuedAt.toISOString() } });
    if (consumed.count !== 1) {
      await revokeGrant(row.grant.id, tx, () => issuedAt);
      return invalidGrant;
    }
    return issueTokenPair(tx, row.grant, config.resource, issuedAt);
  });
}

/** The connection behind a valid access token. */
export type AuthorizedGrant = { grantId: string; clientName: string; scopes: string[] };

/**
 * Checks a bearer token: an unexpired ACCESS token for `config.resource` of a non-revoked grant. Writes the
 * grant's `lastUsedAt` at most once per minute. `scopes` are the token's scopes still held by the grant.
 */
export async function verifyAccessToken(
  token: string,
  config: McpConfig,
  db: McpDb = prisma,
  now: () => Date = () => new Date(),
): Promise<AuthorizedGrant | null> {
  if (token === "" || token.length > 200) return null;
  const row = await db.oAuthToken.findUnique({
    where: { hash: hashSecret(token) },
    include: { grant: { select: { id: true, scope: true, revokedAt: true, lastUsedAt: true } }, client: { select: { clientName: true } } },
  });
  const at = now();
  if (!row || row.kind !== "ACCESS" || !row.grant || row.grant.revokedAt !== null) return null;
  if (row.expiresAt <= at.toISOString() || row.resource !== config.resource) return null;
  const lastUsed = row.grant.lastUsedAt === null ? null : Date.parse(row.grant.lastUsedAt);
  if (lastUsed === null || Number.isNaN(lastUsed) || at.getTime() - lastUsed >= LAST_USED_INTERVAL_MS) {
    await db.oAuthGrant.updateMany({ where: { id: row.grant.id, revokedAt: null }, data: { lastUsedAt: at.toISOString() } });
  }
  // Effective scopes = token scopes ∩ current grant scopes, so removing a scope from the grant takes effect
  // on the next call, not when the access token expires.
  const grantScopes = row.grant.scope.split(" ");
  const scopes = row.scope.split(" ").filter((name) => name !== "" && grantScopes.includes(name));
  return { grantId: row.grant.id, clientName: row.client.clientName, scopes };
}
