import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { approveAuthorization, validateAuthorizeRequest } from "./authorize";
import { registerClient } from "./clients";
import { readMcpConfig } from "./config";
import { s256Challenge } from "./crypto";
import { disconnectAllApps, disconnectApp, listConnectedApps, redirectHosts } from "./grants";
import { exchangeToken, revokeGrant, verifyAccessToken } from "./tokens";

let testDb: TestDatabase;
const db = () => testDb.client;
const config = readMcpConfig({ APP_URL: "https://depot.example.com" })!;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const T0 = new Date("2026-10-28T10:00:00.000Z");
const at = (minutes: number) => () => new Date(T0.getTime() + minutes * 60_000);

beforeEach(() => {
  testDb = createTestDatabase();
});

afterEach(async () => {
  await testDb.cleanup();
});

async function register(name: string, redirectUris: string[] = [REDIRECT]) {
  const result = await registerClient({ client_name: name, redirect_uris: redirectUris }, db(), () => T0);
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result.body.client_id as string;
}

/** Consent "Erlauben" and code exchange for a registered client; returns the token pair. */
async function connect(clientId: string, now = () => T0, redirectUri = REDIRECT) {
  const validation = await validateAuthorizeRequest(
    {
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      state: "s",
      code_challenge: s256Challenge(VERIFIER),
      code_challenge_method: "S256",
      scope: "watchlist",
      resource: config.resource,
    },
    config,
    db(),
  );
  if (validation.kind !== "ok") throw new Error("setup failed");
  const code = new URL(await approveAuthorization(validation.request, config, db(), now)).searchParams.get("code")!;
  const result = await exchangeToken(
    {
      form: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirectUri, code_verifier: VERIFIER }),
      authorization: null,
    },
    config,
    db(),
    now,
  );
  if (!result.ok) throw new Error(`setup failed: ${result.error}`);
  return result.body;
}

async function refresh(clientId: string, token: string) {
  return exchangeToken(
    { form: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token }), authorization: null },
    config,
    db(),
    at(5),
  );
}

describe("redirectHosts", () => {
  it("keeps distinct hosts with their port, in order, and skips unparsable URIs", () => {
    expect(
      redirectHosts([
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.ai/other",
        "http://localhost:33418/callback",
        "not a url",
        "https://claude.com:443/cb",
      ]),
    ).toEqual(["claude.ai", "localhost:33418", "claude.com"]);
  });
});

describe("listConnectedApps", () => {
  it("lists only active grants, newest first, with hosts, scopes and times", async () => {
    const desktop = await register("Claude Desktop", ["https://claude.ai/cb", "http://127.0.0.1:8080/cb", "https://claude.ai/cb2"]);
    const code = await register("Claude Code", ["http://localhost:33418/callback"]);
    const old = await register("Alt");
    await connect(desktop, at(1), "https://claude.ai/cb");
    const { access_token } = await connect(code, at(2), "http://localhost:33418/callback");
    await connect(old, at(3));
    const oldGrant = await db().oAuthGrant.findFirstOrThrow({ where: { client: { clientName: "Alt" } } });
    await revokeGrant(oldGrant.id, db(), at(4));
    expect(await verifyAccessToken(access_token, config, db(), at(5))).not.toBeNull();

    const apps = await listConnectedApps(db());
    expect(apps).toEqual([
      {
        grantId: expect.any(String),
        clientName: "Claude Code",
        redirectHosts: ["localhost:33418"],
        scopes: ["watchlist"],
        createdAt: at(2)().toISOString(),
        lastUsedAt: at(5)().toISOString(),
      },
      {
        grantId: expect.any(String),
        clientName: "Claude Desktop",
        redirectHosts: ["claude.ai", "127.0.0.1:8080"],
        scopes: ["watchlist"],
        createdAt: at(1)().toISOString(),
        lastUsedAt: null,
      },
    ]);
    expect(JSON.stringify(apps)).not.toContain(access_token);
  });

  it("is empty without grants", async () => {
    await register("Claude");
    expect(await listConnectedApps(db())).toEqual([]);
  });
});

describe("disconnectApp", () => {
  it("revokes the grant and deletes its tokens: access token refused, refresh token invalid_grant", async () => {
    const clientId = await register("Claude");
    const { access_token, refresh_token } = await connect(clientId);
    const [app] = await listConnectedApps(db());

    expect(await disconnectApp(app.grantId, db(), at(1))).toEqual({ ok: true, clientName: "Claude" });
    const grant = await db().oAuthGrant.findUniqueOrThrow({ where: { id: app.grantId } });
    expect(grant.revokedAt).toBe(at(1)().toISOString());
    expect(await db().oAuthToken.count({ where: { grantId: app.grantId } })).toBe(0);
    expect(await verifyAccessToken(access_token, config, db(), at(2))).toBeNull();
    expect(await refresh(clientId, refresh_token)).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await listConnectedApps(db())).toEqual([]);
  });

  it("answers not-found for an already revoked, unknown or malformed id without writing", async () => {
    const clientId = await register("Claude");
    await connect(clientId);
    const [app] = await listConnectedApps(db());
    await disconnectApp(app.grantId, db(), at(1));

    for (const id of [app.grantId, "unknown", "", 42, null, "x".repeat(201)]) {
      expect(await disconnectApp(id, db(), at(2))).toEqual({ ok: false, reason: "not-found" });
    }
    const grant = await db().oAuthGrant.findUniqueOrThrow({ where: { id: app.grantId } });
    expect(grant.revokedAt).toBe(at(1)().toISOString());
  });

  it("lets a disconnected client reconnect with a new, working grant", async () => {
    const clientId = await register("Claude");
    const first = await connect(clientId);
    const [app] = await listConnectedApps(db());
    await disconnectApp(app.grantId, db(), at(1));

    const second = await connect(clientId, at(2));
    const apps = await listConnectedApps(db());
    expect(apps).toHaveLength(1);
    expect(apps[0].grantId).not.toBe(app.grantId);
    expect(apps[0].clientName).toBe("Claude");
    expect(await verifyAccessToken(second.access_token, config, db(), at(3))).toMatchObject({ grantId: apps[0].grantId });
    expect(await verifyAccessToken(first.access_token, config, db(), at(3))).toBeNull();
  });
});

describe("disconnectAllApps", () => {
  it("revokes every active grant and deletes all their tokens", async () => {
    const tokens = [];
    for (const name of ["A", "B", "C"]) tokens.push(await connect(await register(name)));
    expect(await disconnectAllApps(db(), at(1))).toEqual({ ok: true, count: 3 });
    expect(await db().oAuthGrant.count({ where: { revokedAt: null } })).toBe(0);
    expect(await db().oAuthToken.count({ where: { kind: { in: ["ACCESS", "REFRESH"] } } })).toBe(0);
    for (const { access_token } of tokens) expect(await verifyAccessToken(access_token, config, db(), at(2))).toBeNull();
    expect(await listConnectedApps(db())).toEqual([]);
    expect(await disconnectAllApps(db(), at(2))).toEqual({ ok: true, count: 0 });
  });
});
