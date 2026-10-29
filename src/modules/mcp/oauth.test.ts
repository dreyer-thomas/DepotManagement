import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { approveAuthorization, denyAuthorization, grantedScope, validateAuthorizeRequest } from "./authorize";
import { isAllowedRedirectUri, registerClient, validateClientMetadata } from "./clients";
import { readMcpConfig } from "./config";
import { hashSecret, s256Challenge } from "./crypto";
import { exchangeToken, revokeGrant, verifyAccessToken } from "./tokens";

let testDb: TestDatabase;
const db = () => testDb.client;
const config = readMcpConfig({ APP_URL: "https://depot.example.com" })!;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = s256Challenge(VERIFIER);
const T0 = new Date("2026-10-28T10:00:00.000Z");
const at = (ms: number) => () => new Date(T0.getTime() + ms);
const MINUTE = 60_000;

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

async function register(metadata: Record<string, unknown> = {}) {
  const result = await registerClient({ client_name: "Claude", redirect_uris: [REDIRECT], ...metadata }, db(), () => T0);
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result.body as { client_id: string; client_secret?: string };
}

function authorizeParams(clientId: string, extra: Record<string, string | string[] | undefined> = {}) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    state: "xyz",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    scope: "watchlist",
    resource: config.resource,
    ...extra,
  };
}

async function code(clientId: string, now = () => T0, scope = "watchlist", portfolioRead = false) {
  const validation = await validateAuthorizeRequest(authorizeParams(clientId, { scope }), config, db());
  if (validation.kind !== "ok") throw new Error("setup failed");
  const url = new URL(await approveAuthorization(validation.request, config, db(), now, portfolioRead));
  return url.searchParams.get("code")!;
}

function form(fields: Record<string, string>) {
  return { form: new URLSearchParams(fields), authorization: null };
}

async function exchange(clientId: string, value: string, now = () => T0, extra: Record<string, string> = {}) {
  return exchangeToken(
    form({ grant_type: "authorization_code", client_id: clientId, code: value, redirect_uri: REDIRECT, code_verifier: VERIFIER, ...extra }),
    config,
    db(),
    now,
  );
}

async function tokens(clientId: string) {
  const result = await exchange(clientId, await code(clientId));
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result.body;
}

describe("redirect URIs", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "https://example.com",
    "https://example.com/cb?x=1",
    "http://localhost/callback",
    "http://localhost:33418/callback",
    "http://127.0.0.1:8080/cb",
  ])("allows %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    "http://evil.com/cb",
    "http://localhost.evil.com/cb",
    "http://localhost:3000",
    "http://127.0.0.2/cb",
    "https://claude.ai/cb#frag",
    "https://user@claude.ai/cb",
    "HTTPS://claude.ai/cb",
    "javascript:alert(1)",
    "custom-scheme://cb",
    "https://claude.ai/c b",
    "",
    42,
  ])("refuses %j", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });
});

describe("registerClient", () => {
  it("registers a public client with defaults and stores it", async () => {
    const result = await registerClient({ redirect_uris: [REDIRECT] }, db(), () => T0);
    expect(result).toEqual({
      ok: true,
      body: {
        client_id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
        client_id_issued_at: T0.getTime() / 1000,
        client_name: "Unbenannte App",
        redirect_uris: [REDIRECT],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    });
    const row = await db().oAuthClient.findFirstOrThrow();
    expect(row).toMatchObject({ clientName: "Unbenannte App", clientSecretHash: null, createdAt: T0.toISOString() });
  });

  it("gives a secret method a client_secret once and stores only its hash", async () => {
    const body = await register({ token_endpoint_auth_method: "client_secret_post", client_name: "  Café App " });
    expect(body.client_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await db().oAuthClient.findFirstOrThrow();
    expect(row.clientSecretHash).toBe(hashSecret(body.client_secret!));
    expect(row.clientName).toBe("Café App");
  });

  it.each([
    [{ redirect_uris: [] }, "invalid_redirect_uri"],
    [{}, "invalid_redirect_uri"],
    [{ redirect_uris: ["http://evil.com/cb"] }, "invalid_redirect_uri"],
    [{ redirect_uris: Array.from({ length: 11 }, (_, i) => `https://x.example/${i}`) }, "invalid_redirect_uri"],
    [{ redirect_uris: [REDIRECT], client_name: "x".repeat(101) }, "invalid_client_metadata"],
    [{ redirect_uris: [REDIRECT], client_name: 5 }, "invalid_client_metadata"],
    [{ redirect_uris: [REDIRECT], grant_types: ["client_credentials"] }, "invalid_client_metadata"],
    [{ redirect_uris: [REDIRECT], response_types: ["token"] }, "invalid_client_metadata"],
    [{ redirect_uris: [REDIRECT], token_endpoint_auth_method: "private_key_jwt" }, "invalid_client_metadata"],
  ])("refuses %j with %s", async (metadata, error) => {
    expect(validateClientMetadata(metadata)).toMatchObject({ ok: false, error });
  });

  it("deletes a 24 h-old client whose only grant is revoked", async () => {
    const revoked = await register();
    await tokens(revoked.client_id);
    await revokeGrant((await db().oAuthGrant.findFirstOrThrow()).id, db(), () => T0);
    await registerClient({ redirect_uris: [REDIRECT] }, db(), at(24 * 60 * MINUTE + 1));
    expect(await db().oAuthClient.count({ where: { clientId: revoked.client_id } })).toBe(0);
    expect(await db().oAuthGrant.count()).toBe(0);
  });

  it("deletes clients older than 24 h without a grant before inserting, then refuses at 200 clients", async () => {
    const old = await register();
    const connected = await register();
    await tokens(connected.client_id);
    const day = 24 * 60 * MINUTE;
    await registerClient({ redirect_uris: [REDIRECT] }, db(), at(day + 1));
    const ids = (await db().oAuthClient.findMany({ select: { clientId: true } })).map((row) => row.clientId);
    expect(ids).not.toContain(old.client_id);
    expect(ids).toContain(connected.client_id);

    await db().oAuthClient.createMany({
      data: Array.from({ length: 198 }, (_, i) => ({
        clientId: `bulk-${i}`,
        clientName: "x",
        redirectUris: "[]",
        grantTypes: "[]",
        tokenEndpointAuthMethod: "none",
        createdAt: new Date(T0.getTime() + day).toISOString(),
      })),
    });
    expect(await db().oAuthClient.count()).toBe(200);
    expect(await registerClient({ redirect_uris: [REDIRECT] }, db(), at(day + 2))).toMatchObject({ ok: false, error: "invalid_client_metadata" });
  });
});

describe("grantedScope", () => {
  it("grants watchlist for watchlist, portfolio:read or no scope, and refuses others", () => {
    expect(grantedScope(undefined)).toBe("watchlist");
    expect(grantedScope("")).toBe("watchlist");
    expect(grantedScope("watchlist portfolio:read")).toBe("watchlist");
    expect(grantedScope("portfolio:read")).toBe("watchlist");
    expect(grantedScope("watchlist admin")).toBeNull();
    expect(grantedScope("openid")).toBeNull();
  });
});

describe("validateAuthorizeRequest", () => {
  it("accepts a valid request with client name and redirect host", async () => {
    const { client_id } = await register();
    expect(await validateAuthorizeRequest(authorizeParams(client_id), config, db())).toEqual({
      kind: "ok",
      request: {
        clientId: client_id,
        clientName: "Claude",
        redirectUri: REDIRECT,
        redirectHost: "claude.ai",
        state: "xyz",
        codeChallenge: CHALLENGE,
        scope: "watchlist",
        portfolioReadRequested: false,
      },
    });
  });

  it("shows an error page (no redirect) for an unknown client or an unregistered redirect URI", async () => {
    const { client_id } = await register();
    expect(await validateAuthorizeRequest(authorizeParams("nope"), config, db())).toEqual({ kind: "error-page", reason: "client-unknown" });
    for (const redirect_uri of ["https://evil.example/cb", `${REDIRECT}/x`, "https://claude.ai/api/mcp", undefined]) {
      expect(await validateAuthorizeRequest(authorizeParams(client_id, { redirect_uri }), config, db())).toEqual({
        kind: "error-page",
        reason: "redirect-uri-invalid",
      });
    }
  });

  it.each([
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ code_challenge: undefined }, "invalid_request"],
    [{ code_challenge_method: undefined }, "invalid_request"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ resource: "https://other.example/api/mcp" }, "invalid_target"],
    [{ scope: "watchlist admin" }, "invalid_scope"],
    [{ state: ["a", "b"] }, "invalid_request"],
  ])("redirects %j with error=%s, state and iss", async (extra, error) => {
    const { client_id } = await register();
    const validation = await validateAuthorizeRequest(authorizeParams(client_id, extra), config, db());
    expect(validation.kind).toBe("redirect");
    const url = new URL((validation as { url: string }).url);
    expect(`${url.origin}${url.pathname}`).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe(error);
    expect(url.searchParams.get("iss")).toBe("https://depot.example.com");
    if (!("state" in extra)) expect(url.searchParams.get("state")).toBe("xyz");
  });

  it("accepts a request without resource and grants watchlist for portfolio:read", async () => {
    const { client_id } = await register();
    const validation = await validateAuthorizeRequest(authorizeParams(client_id, { resource: undefined, scope: "portfolio:read" }), config, db());
    expect(validation).toMatchObject({ kind: "ok", request: { scope: "watchlist", portfolioReadRequested: true } });
  });

  it.each([
    ["watchlist portfolio:read", true],
    ["portfolio:read watchlist", true],
    ["portfolio:read", true],
    ["watchlist", false],
    ["", false],
    [undefined, false],
  ])("marks scope %j as portfolioReadRequested=%s", async (scope, requested) => {
    const { client_id } = await register();
    const validation = await validateAuthorizeRequest(authorizeParams(client_id, { scope }), config, db());
    expect(validation).toMatchObject({ kind: "ok", request: { scope: "watchlist", portfolioReadRequested: requested } });
  });
});

describe("consent decision", () => {
  it("Erlauben stores a hashed 10-minute code and redirects with code, state and iss; no grant yet", async () => {
    const { client_id } = await register();
    const validation = await validateAuthorizeRequest(authorizeParams(client_id), config, db());
    if (validation.kind !== "ok") throw new Error("setup failed");
    const url = new URL(await approveAuthorization(validation.request, config, db(), () => T0));
    const value = url.searchParams.get("code")!;
    expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBe("xyz");
    expect(url.searchParams.get("iss")).toBe("https://depot.example.com");
    const row = await db().oAuthToken.findFirstOrThrow();
    expect(row).toMatchObject({
      kind: "CODE",
      hash: hashSecret(value),
      grantId: null,
      codeChallenge: CHALLENGE,
      redirectUri: REDIRECT,
      resource: config.resource,
      expiresAt: "2026-10-28T10:10:00.000Z",
    });
    expect(await db().oAuthGrant.count()).toBe(0);
  });

  it("Ablehnen redirects with error=access_denied", async () => {
    const { client_id } = await register();
    const validation = await validateAuthorizeRequest(authorizeParams(client_id), config, db());
    if (validation.kind !== "ok") throw new Error("setup failed");
    const url = new URL(denyAuthorization(validation.request, config));
    expect(Object.fromEntries(url.searchParams)).toEqual({ error: "access_denied", state: "xyz", iss: "https://depot.example.com" });
  });
});

describe("consent with portfolio:read", () => {
  async function codeScope(scope: string | undefined, portfolioRead: boolean) {
    const { client_id } = await register();
    const validation = await validateAuthorizeRequest(authorizeParams(client_id, { scope }), config, db());
    if (validation.kind !== "ok") throw new Error("setup failed");
    await approveAuthorization(validation.request, config, db(), () => T0, portfolioRead);
    return (await db().oAuthToken.findFirstOrThrow({ where: { kind: "CODE" } })).scope;
  }

  it.each([
    ["watchlist portfolio:read", true, "watchlist portfolio:read"],
    ["watchlist portfolio:read", false, "watchlist"],
    ["portfolio:read", true, "watchlist portfolio:read"],
    ["portfolio:read", false, "watchlist"],
    // A forged checkbox without the requested scope grants nothing extra.
    ["watchlist", true, "watchlist"],
    [undefined, true, "watchlist"],
  ])("scope %j with checkbox=%s stores code scope %j", async (scope, portfolioRead, expected) => {
    expect(await codeScope(scope, portfolioRead)).toBe(expected);
  });

  it("carries the granted scope to the grant, the tokens and the token response", async () => {
    const { client_id } = await register();
    const result = await exchange(client_id, await code(client_id, () => T0, "watchlist portfolio:read", true));
    expect(result).toMatchObject({ ok: true, body: { scope: "watchlist portfolio:read" } });
    expect(await db().oAuthGrant.findFirstOrThrow()).toMatchObject({ scope: "watchlist portfolio:read" });
    for (const row of await db().oAuthToken.findMany({ where: { kind: { in: ["ACCESS", "REFRESH"] } } })) {
      expect(row.scope).toBe("watchlist portfolio:read");
    }
  });
});

describe("token endpoint", () => {
  it("exchanges a code with the right verifier for an access and a refresh token and creates the grant", async () => {
    const { client_id } = await register();
    const result = await exchange(client_id, await code(client_id));
    expect(result).toEqual({
      ok: true,
      body: { access_token: expect.any(String), token_type: "Bearer", expires_in: 3600, refresh_token: expect.any(String), scope: "watchlist" },
    });
    const grant = await db().oAuthGrant.findFirstOrThrow();
    expect(grant).toMatchObject({ scope: "watchlist", revokedAt: null, createdAt: T0.toISOString() });
    const kinds = (await db().oAuthToken.findMany({ where: { grantId: grant.id } })).map((row) => row.kind).sort();
    expect(kinds).toEqual(["ACCESS", "CODE", "REFRESH"]);
    if (result.ok) {
      const stored = await db().oAuthToken.findMany({ select: { hash: true } });
      expect(stored.map((row) => row.hash)).toContain(hashSecret(result.body.access_token));
      expect(JSON.stringify(stored)).not.toContain(result.body.access_token);
    }
  });

  it("refuses a wrong verifier, client, redirect URI or resource with invalid_grant / invalid_target", async () => {
    const { client_id } = await register();
    const other = await register();
    const value = await code(client_id);
    expect(await exchange(client_id, value, () => T0, { code_verifier: `${VERIFIER.slice(0, -1)}A` })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await exchange(other.client_id, value)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await exchange(client_id, value, () => T0, { redirect_uri: `${REDIRECT}/x` })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await exchange(client_id, value, () => T0, { resource: "https://other.example/api/mcp" })).toMatchObject({
      ok: false,
      status: 400,
      error: "invalid_target",
    });
    // None of the failures consumed the code.
    expect((await exchange(client_id, value)).ok).toBe(true);
  });

  it("refuses an expired code (10 min)", async () => {
    const { client_id } = await register();
    const value = await code(client_id);
    expect(await exchange(client_id, value, at(10 * MINUTE))).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("refuses a reused code and revokes the grant created from it", async () => {
    const { client_id } = await register();
    const value = await code(client_id);
    const first = await exchange(client_id, value);
    expect(first.ok).toBe(true);
    expect(await exchange(client_id, value)).toMatchObject({ ok: false, status: 400, error: "invalid_grant" });
    const grant = await db().oAuthGrant.findFirstOrThrow();
    expect(grant.revokedAt).toBe(T0.toISOString());
    expect(await db().oAuthToken.count({ where: { grantId: grant.id } })).toBe(0);
    if (first.ok) expect(await verifyAccessToken(first.body.access_token, config, db(), () => T0)).toBeNull();
  });

  it("rotates the refresh token; reusing the old one revokes the whole grant", async () => {
    const { client_id } = await register();
    const first = await tokens(client_id);
    const refresh = (token: string, now = at(MINUTE)) =>
      exchangeToken(form({ grant_type: "refresh_token", client_id, refresh_token: token }), config, db(), now);
    const second = await refresh(first.refresh_token);
    expect(second).toMatchObject({ ok: true, body: { token_type: "Bearer", expires_in: 3600, scope: "watchlist" } });
    if (!second.ok) throw new Error("refresh failed");
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    expect(await verifyAccessToken(second.body.access_token, config, db(), at(MINUTE))).not.toBeNull();

    expect(await refresh(first.refresh_token, at(2 * MINUTE))).toMatchObject({ ok: false, error: "invalid_grant" });
    expect((await db().oAuthGrant.findFirstOrThrow()).revokedAt).not.toBeNull();
    expect(await verifyAccessToken(first.access_token, config, db(), at(2 * MINUTE))).toBeNull();
    expect(await verifyAccessToken(second.body.access_token, config, db(), at(2 * MINUTE))).toBeNull();
    expect(await refresh(second.body.refresh_token, at(3 * MINUTE))).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("re-authorizing a client revokes its older grants but not those of other clients", async () => {
    const { client_id } = await register();
    const other = await register();
    const first = await tokens(client_id);
    const otherPair = await tokens(other.client_id);
    const oldGrant = await db().oAuthGrant.findFirstOrThrow({ where: { client: { clientId: client_id } } });
    const refresh = (id: string, token: string, now: () => Date) =>
      exchangeToken(form({ grant_type: "refresh_token", client_id: id, refresh_token: token }), config, db(), now);

    // A failed exchange leaves the active grant untouched.
    const failing = await code(client_id, at(MINUTE));
    expect(await exchange(client_id, failing, at(MINUTE), { code_verifier: `${VERIFIER.slice(0, -1)}A` })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect((await db().oAuthGrant.findUniqueOrThrow({ where: { id: oldGrant.id } })).revokedAt).toBeNull();

    const second = await exchange(client_id, await code(client_id, at(2 * MINUTE)), at(2 * MINUTE));
    if (!second.ok) throw new Error("re-authorization failed");
    const grants = await db().oAuthGrant.findMany({ where: { client: { clientId: client_id } }, orderBy: { createdAt: "asc" } });
    expect(grants).toHaveLength(2);
    expect(grants[0]).toMatchObject({ id: oldGrant.id, revokedAt: at(2 * MINUTE)().toISOString() });
    expect(grants[1]).toMatchObject({ revokedAt: null, createdAt: at(2 * MINUTE)().toISOString() });
    expect(await db().oAuthToken.count({ where: { grantId: oldGrant.id } })).toBe(0);

    expect(await verifyAccessToken(first.access_token, config, db(), at(3 * MINUTE))).toBeNull();
    expect(await refresh(client_id, first.refresh_token, at(3 * MINUTE))).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await verifyAccessToken(second.body.access_token, config, db(), at(3 * MINUTE))).toMatchObject({ grantId: grants[1].id });
    const rotated = await refresh(client_id, second.body.refresh_token, at(4 * MINUTE));
    expect(rotated).toMatchObject({ ok: true });
    if (rotated.ok) expect(rotated.body.refresh_token).not.toBe(second.body.refresh_token);

    // The other client's grant stays active and its tokens work.
    expect((await db().oAuthGrant.findFirstOrThrow({ where: { client: { clientId: other.client_id } } })).revokedAt).toBeNull();
    expect(await verifyAccessToken(otherPair.access_token, config, db(), at(4 * MINUTE))).not.toBeNull();
    expect(await refresh(other.client_id, otherPair.refresh_token, at(4 * MINUTE))).toMatchObject({ ok: true });
  });

  it("refuses a refresh token of another client, an unknown one and an expired one (90 days)", async () => {
    const { client_id } = await register();
    const other = await register();
    const first = await tokens(client_id);
    expect(
      await exchangeToken(form({ grant_type: "refresh_token", client_id: other.client_id, refresh_token: first.refresh_token }), config, db(), () => T0),
    ).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await exchangeToken(form({ grant_type: "refresh_token", client_id, refresh_token: "unknown" }), config, db(), () => T0)).toMatchObject({
      ok: false,
      error: "invalid_grant",
    });
    expect(
      await exchangeToken(form({ grant_type: "refresh_token", client_id, refresh_token: first.refresh_token }), config, db(), at(90 * 24 * 60 * MINUTE)),
    ).toMatchObject({ ok: false, error: "invalid_grant" });
    // The other client's attempt did not revoke the grant.
    expect((await db().oAuthGrant.findFirstOrThrow()).revokedAt).toBeNull();
  });

  it("answers RFC 6749 errors for bad grant types and missing parameters", async () => {
    const { client_id } = await register();
    const call = (fields: Record<string, string>) => exchangeToken(form({ client_id, ...fields }), config, db(), () => T0);
    expect(await call({})).toMatchObject({ ok: false, status: 400, error: "invalid_request" });
    expect(await call({ grant_type: "client_credentials" })).toMatchObject({ ok: false, status: 400, error: "unsupported_grant_type" });
    expect(await call({ grant_type: "authorization_code" })).toMatchObject({ ok: false, status: 400, error: "invalid_request" });
    expect(await call({ grant_type: "refresh_token" })).toMatchObject({ ok: false, status: 400, error: "invalid_request" });
    const onlyCode = await register({ grant_types: ["authorization_code"] });
    expect(
      await exchangeToken(form({ client_id: onlyCode.client_id, grant_type: "refresh_token", refresh_token: "x" }), config, db(), () => T0),
    ).toMatchObject({ ok: false, error: "unauthorized_client" });
  });

  it("authenticates clients exactly by their registered method (invalid_client 401 otherwise)", async () => {
    const pub = await register();
    const post = await register({ token_endpoint_auth_method: "client_secret_post" });
    const basic = await register({ token_endpoint_auth_method: "client_secret_basic" });
    const basicHeader = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
    const call = (fields: Record<string, string>, authorization: string | null = null) =>
      exchangeToken({ form: new URLSearchParams({ grant_type: "client_credentials", ...fields }), authorization }, config, db(), () => T0);
    const invalidClient = { ok: false, status: 401, error: "invalid_client" };

    expect(await call({ client_id: "unknown" })).toMatchObject(invalidClient);
    expect(await call({})).toMatchObject(invalidClient);
    expect(await call({ client_id: pub.client_id, client_secret: "x" })).toMatchObject(invalidClient);
    // Authenticated: the unsupported grant type comes next.
    expect(await call({ client_id: pub.client_id })).toMatchObject({ error: "unsupported_grant_type" });

    expect(await call({ client_id: post.client_id })).toMatchObject(invalidClient);
    expect(await call({ client_id: post.client_id, client_secret: "wrong" })).toMatchObject(invalidClient);
    expect(await call({}, basicHeader(post.client_id, post.client_secret!))).toMatchObject(invalidClient);
    expect(await call({ client_id: post.client_id, client_secret: post.client_secret! })).toMatchObject({ error: "unsupported_grant_type" });

    expect(await call({ client_id: basic.client_id, client_secret: basic.client_secret! })).toMatchObject(invalidClient);
    expect(await call({}, basicHeader(basic.client_id, "wrong"))).toMatchObject({ ...invalidClient, basicChallenge: true });
    expect(await call({}, "Basic !!!")).toMatchObject(invalidClient);
    expect(await call({}, basicHeader(basic.client_id, basic.client_secret!))).toMatchObject({ error: "unsupported_grant_type" });
    expect(await call({ client_id: pub.client_id }, basicHeader(basic.client_id, basic.client_secret!))).toMatchObject(invalidClient);
    // A non-Basic Authorization header carries no client credentials and is ignored.
    expect(await call({ client_id: pub.client_id }, "Bearer something")).toMatchObject({ error: "unsupported_grant_type" });
  });

  it("deletes expired codes and tokens opportunistically at issuance", async () => {
    const { client_id } = await register();
    await code(client_id);
    expect(await db().oAuthToken.count()).toBe(1);
    await code(client_id, at(11 * MINUTE));
    expect(await db().oAuthToken.count()).toBe(1);
  });
});

describe("verifyAccessToken", () => {
  it("accepts a fresh token, refuses it after 1 h, for another resource or after revocation", async () => {
    const { client_id } = await register();
    const { access_token } = await tokens(client_id);
    expect(await verifyAccessToken(access_token, config, db(), () => T0)).toEqual({
      grantId: expect.any(String),
      clientName: "Claude",
      scopes: ["watchlist"],
    });
    expect(await verifyAccessToken(access_token, config, db(), at(60 * MINUTE))).toBeNull();
    const other = readMcpConfig({ APP_URL: "https://other.example" })!;
    expect(await verifyAccessToken(access_token, other, db(), () => T0)).toBeNull();
    expect(await verifyAccessToken("garbage", config, db(), () => T0)).toBeNull();

    const grant = await db().oAuthGrant.findFirstOrThrow();
    await revokeGrant(grant.id, db(), () => T0);
    expect(await verifyAccessToken(access_token, config, db(), () => T0)).toBeNull();
  });

  it("returns the token scopes still held by the grant", async () => {
    const { client_id } = await register();
    const result = await exchange(client_id, await code(client_id, () => T0, "watchlist portfolio:read", true));
    if (!result.ok) throw new Error("setup failed");
    const { access_token } = result.body as { access_token: string };
    expect(await verifyAccessToken(access_token, config, db(), () => T0)).toMatchObject({ scopes: ["watchlist", "portfolio:read"] });
    // Removing the scope from the grant alone (token rows unchanged) already takes effect.
    await db().oAuthGrant.updateMany({ data: { scope: "watchlist" } });
    expect(await verifyAccessToken(access_token, config, db(), () => T0)).toMatchObject({ scopes: ["watchlist"] });
  });

  it("refuses a refresh token or a code used as a bearer token", async () => {
    const { client_id } = await register();
    const { refresh_token } = await tokens(client_id);
    expect(await verifyAccessToken(refresh_token, config, db(), () => T0)).toBeNull();
    expect(await verifyAccessToken(await code(client_id), config, db(), () => T0)).toBeNull();
  });

  it("updates lastUsedAt at most once per minute", async () => {
    const { client_id } = await register();
    const { access_token } = await tokens(client_id);
    const lastUsed = async () => (await db().oAuthGrant.findFirstOrThrow()).lastUsedAt;
    await verifyAccessToken(access_token, config, db(), () => T0);
    expect(await lastUsed()).toBe(T0.toISOString());
    await verifyAccessToken(access_token, config, db(), at(59_000));
    expect(await lastUsed()).toBe(T0.toISOString());
    await verifyAccessToken(access_token, config, db(), at(MINUTE));
    expect(await lastUsed()).toBe(at(MINUTE)().toISOString());
  });
});
