import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { archiveDepot, createDepot, ensureSecurity, listDepots, recordTransaction } from "@/modules/ledger";
import type { IsinDetails, Lookup } from "@/modules/prices";
import { addWatchlistEntry, createWatchlist, watchlistView } from "@/modules/watchlist";
import { approveAuthorization, validateAuthorizeRequest } from "./authorize";
import { readMcpConfig } from "./config";
import { s256Challenge } from "./crypto";
import { disconnectAllApps, disconnectApp, listConnectedApps, removePortfolioAccess } from "./grants";
import {
  handleAuthorizationServerMetadata,
  handleMcp,
  handleProtectedResourceMetadata,
  handleRegister,
  handleToken,
  type McpHttpDeps,
  methodNotAllowed,
} from "./http";
import { PORTFOLIO_TOOL_NAMES } from "./portfolio-tools";
import { WATCHLIST_TOOL_NAMES } from "./tools";

const APP_URL = "https://depot.example.com";
const ENV = { APP_URL };
const config = readMcpConfig(ENV)!;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const NOW = new Date("2026-10-28T10:00:00.000Z");
const TODAY = "2026-10-28";
const SAP = "DE0007164600";
const MSCI_WORLD = "IE00B4L5Y983";
const APPLE = "US0378331005";

let testDb: TestDatabase;
let clock: Date;
let lookups: string[];
let lookupReply: Lookup<IsinDetails>;
let changes: { backfill: boolean }[];

function deps(extra: Partial<McpHttpDeps> = {}): McpHttpDeps {
  return {
    env: ENV,
    db: testDb.client,
    now: () => clock,
    lookupIsin: async (isin) => {
      lookups.push(isin);
      return lookupReply;
    },
    onWatchlistChange: (change) => changes.push(change),
    ...extra,
  };
}

beforeEach(() => {
  testDb = createTestDatabase();
  clock = NOW;
  lookups = [];
  changes = [];
  lookupReply = { status: "not-found" };
});

afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.cleanup();
});

function post(path: string, body: string, contentType: string, headers: Record<string, string> = {}) {
  return new Request(`${APP_URL}${path}`, { method: "POST", body, headers: { "content-type": contentType, ...headers } });
}

async function registerViaHttp(metadata: Record<string, unknown> = { client_name: "Claude", redirect_uris: [REDIRECT] }) {
  const response = await handleRegister(post("/oauth/register", JSON.stringify(metadata), "application/json"), deps());
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/**
 * Registration → consent "Erlauben" → token exchange, as a real client would do it. `scope` is the requested
 * scope; `portfolioRead` is the consent checkbox.
 */
async function connect(
  existingClientId?: string,
  { scope = "watchlist", portfolioRead = false }: { scope?: string; portfolioRead?: boolean } = {},
): Promise<{ access_token: string; refresh_token: string; client_id: string; scope: string }> {
  const clientId = existingClientId ?? ((await registerViaHttp()).body.client_id as string);
  const validation = await validateAuthorizeRequest(
    {
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      state: "s",
      code_challenge: s256Challenge(VERIFIER),
      code_challenge_method: "S256",
      scope,
      resource: config.resource,
    },
    config,
    testDb.client,
  );
  if (validation.kind !== "ok") throw new Error("setup failed");
  const code = new URL(await approveAuthorization(validation.request, config, testDb.client, () => clock, portfolioRead)).searchParams.get("code")!;
  const response = await handleToken(
    post(
      "/oauth/token",
      new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: clientId, resource: config.resource }).toString(),
      "application/x-www-form-urlencoded",
    ),
    deps(),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return { ...((await response.json()) as { access_token: string; refresh_token: string; scope: string }), client_id: clientId };
}

/** An MCP SDK client talking to `handleMcp` through an in-process fetch (route semantics: POST only). */
async function mcpClient(token: string): Promise<Client> {
  const fetch = async (url: string | URL, init?: RequestInit) => {
    const request = new Request(url, init);
    return request.method === "POST" ? handleMcp(request, deps()) : methodNotAllowed("POST");
  };
  const transport = new StreamableHTTPClientTransport(new URL(config.resource), {
    fetch,
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

type ToolResult = { isError?: boolean; content: { type: string; text: string }[] };

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  return { isError: result.isError === true, payload: JSON.parse(result.content[0].text) };
}

async function mcpRequest(headers: Record<string, string>) {
  return handleMcp(
    post("/api/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), "application/json", {
      accept: "application/json, text/event-stream",
      ...headers,
    }),
    deps(),
  );
}

describe("discovery", () => {
  it("serves the protected-resource and authorization-server metadata with no-store", async () => {
    const resource = handleProtectedResourceMetadata(deps());
    expect(resource.headers.get("cache-control")).toBe("no-store");
    expect(await resource.json()).toEqual({
      resource: `${APP_URL}/api/mcp`,
      authorization_servers: [APP_URL],
      scopes_supported: ["watchlist", "portfolio:read"],
      bearer_methods_supported: ["header"],
    });
    const server = handleAuthorizationServerMetadata(deps());
    expect(server.headers.get("cache-control")).toBe("no-store");
    expect(await server.json()).toEqual({
      issuer: APP_URL,
      authorization_endpoint: `${APP_URL}/oauth/authorize`,
      token_endpoint: `${APP_URL}/oauth/token`,
      registration_endpoint: `${APP_URL}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: ["watchlist", "portfolio:read"],
      authorization_response_iss_parameter_supported: true,
    });
  });

  it("answers 503 server_error on every OAuth/MCP handler while APP_URL is unset or invalid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const env of [{}, { APP_URL: "not a url" }, { APP_URL: "https://x.example/path" }]) {
      const broken = deps({ env });
      const responses = [
        handleProtectedResourceMetadata(broken),
        handleAuthorizationServerMetadata(broken),
        await handleRegister(post("/oauth/register", "{}", "application/json"), broken),
        await handleToken(post("/oauth/token", "grant_type=x", "application/x-www-form-urlencoded"), broken),
        await handleMcp(post("/api/mcp", "{}", "application/json"), broken),
      ];
      for (const response of responses) {
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: "server_error" });
      }
    }
    // Logged without values.
    expect(error.mock.calls.flat().join(" ")).not.toContain("x.example");
  });
});

describe("registration endpoint", () => {
  it("answers 201 for valid metadata and 400 invalid_redirect_uri for http://evil.com", async () => {
    const ok = await registerViaHttp();
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" });
    const evil = await registerViaHttp({ redirect_uris: ["http://evil.com/cb"] });
    expect(evil).toEqual({ status: 400, body: { error: "invalid_redirect_uri", error_description: expect.any(String) } });
  });

  it("refuses a non-JSON body or content type", async () => {
    const notJson = await handleRegister(post("/oauth/register", "{nope", "application/json"), deps());
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: "invalid_client_metadata" });
    const form = await handleRegister(post("/oauth/register", "a=b", "application/x-www-form-urlencoded"), deps());
    expect(form.status).toBe(400);
  });
});

describe("token endpoint", () => {
  it("answers 401 invalid_client for an unknown client and 400 for a non-form body", async () => {
    const unknown = await handleToken(post("/oauth/token", "grant_type=authorization_code&client_id=x", "application/x-www-form-urlencoded"), deps());
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ error: "invalid_client" });
    const json = await handleToken(post("/oauth/token", "{}", "application/json"), deps());
    expect(json.status).toBe(400);
    expect(await json.json()).toMatchObject({ error: "invalid_request" });
  });

  it("asks for Basic credentials after failed Basic authentication", async () => {
    const response = await handleToken(
      post("/oauth/token", "grant_type=refresh_token", "application/x-www-form-urlencoded", { authorization: `Basic ${Buffer.from("x:y").toString("base64")}` }),
      deps(),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe('Basic realm="oauth"');
  });
});

describe("body size limits", () => {
  /** A body streamed in 64 KiB chunks without a content-length header. */
  function streamed(bytes: number): ReadableStream<Uint8Array> {
    let sent = 0;
    return new ReadableStream({
      pull(controller) {
        if (sent >= bytes) return controller.close();
        const size = Math.min(64 * 1024, bytes - sent);
        sent += size;
        controller.enqueue(new TextEncoder().encode(" ".repeat(size)));
      },
    });
  }

  it("refuses a token request over 16 KiB and a registration over 64 KiB with 400", async () => {
    const tokenResponse = await handleToken(
      post("/oauth/token", `grant_type=refresh_token&refresh_token=${"x".repeat(17 * 1024)}`, "application/x-www-form-urlencoded"),
      deps(),
    );
    expect(tokenResponse.status).toBe(400);
    expect(await tokenResponse.json()).toMatchObject({ error: "invalid_request" });
    const big = JSON.stringify({ redirect_uris: [REDIRECT], client_name: "Claude", padding: "x".repeat(65 * 1024) });
    const registration = await handleRegister(post("/oauth/register", big, "application/json"), deps());
    expect(registration.status).toBe(400);
    expect(await testDb.client.oAuthClient.count()).toBe(0);
  });

  it("answers 413 for an authenticated MCP POST over 1 MiB, with or without content-length", async () => {
    const { access_token } = await connect();
    const headers = { authorization: `Bearer ${access_token}`, accept: "application/json, text/event-stream" };
    const declared = await handleMcp(post("/api/mcp", " ".repeat(1024 * 1024 + 1), "application/json", headers), deps());
    expect(declared.status).toBe(413);
    expect(await declared.json()).toEqual({ error: "payload_too_large" });
    const chunked = new Request(`${APP_URL}/api/mcp`, {
      method: "POST",
      body: streamed(2 * 1024 * 1024),
      headers: { "content-type": "application/json", ...headers },
      duplex: "half",
    } as RequestInit);
    expect(chunked.headers.get("content-length")).toBeNull();
    const response = await handleMcp(chunked, deps());
    expect(response.status).toBe(413);
  });
});

describe("/api/mcp authentication", () => {
  const challenge = `Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/api/mcp"`;

  it("answers 401 with WWW-Authenticate without a token, and adds invalid_token for a bad one", async () => {
    const none = await mcpRequest({});
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe(challenge);
    const bad = await mcpRequest({ authorization: "Bearer not-a-token" });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toBe(`${challenge}, error="invalid_token"`);
  });

  it("answers 401 once the access token expired (1 h) or its grant was revoked by refresh-token reuse", async () => {
    const { access_token, refresh_token, client_id } = await connect();
    expect((await mcpRequest({ authorization: `Bearer ${access_token}` })).status).toBe(200);
    clock = new Date(NOW.getTime() + 3600_000);
    expect((await mcpRequest({ authorization: `Bearer ${access_token}` })).status).toBe(401);

    clock = NOW;
    const refresh = (token: string) =>
      handleToken(
        post("/oauth/token", new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id }).toString(), "application/x-www-form-urlencoded"),
        deps(),
      );
    const rotated = await refresh(refresh_token);
    expect(rotated.status).toBe(200);
    const { access_token: second } = (await rotated.json()) as { access_token: string };
    expect((await mcpRequest({ authorization: `Bearer ${second}` })).status).toBe(200);
    const reuse = await refresh(refresh_token);
    expect(reuse.status).toBe(400);
    expect(await reuse.json()).toMatchObject({ error: "invalid_grant" });
    const after = await mcpRequest({ authorization: `Bearer ${second}` });
    expect(after.status).toBe(401);
    expect(after.headers.get("www-authenticate")).toBe(`${challenge}, error="invalid_token"`);
  });
});

describe("/api/mcp after disconnecting in Settings (story 9.5)", () => {
  const refresh = (token: string, clientId: string) =>
    handleToken(
      post("/oauth/token", new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: clientId }).toString(), "application/x-www-form-urlencoded"),
      deps(),
    );

  it("answers 401 with the old access token and invalid_grant for the refresh token; the same client can reconnect", async () => {
    const { access_token, refresh_token, client_id } = await connect();
    expect((await mcpRequest({ authorization: `Bearer ${access_token}` })).status).toBe(200);
    const [app] = await listConnectedApps(testDb.client);
    expect(app.lastUsedAt).toBe(NOW.toISOString());

    expect(await disconnectApp(app.grantId, testDb.client, () => clock)).toEqual({ ok: true, clientName: "Claude" });
    expect((await mcpRequest({ authorization: `Bearer ${access_token}` })).status).toBe(401);
    const refused = await refresh(refresh_token, client_id);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "invalid_grant" });

    const again = await connect(client_id);
    expect((await mcpRequest({ authorization: `Bearer ${again.access_token}` })).status).toBe(200);
    const apps = await listConnectedApps(testDb.client);
    expect(apps.map((listed) => listed.clientName)).toEqual(["Claude"]);
    expect(apps[0].grantId).not.toBe(app.grantId);
  });

  it("answers 401 for every connection after Alle trennen", async () => {
    const first = await connect();
    const second = await connect();
    expect(await disconnectAllApps(testDb.client, () => clock)).toEqual({ ok: true, count: 2 });
    for (const { access_token } of [first, second]) {
      expect((await mcpRequest({ authorization: `Bearer ${access_token}` })).status).toBe(401);
    }
  });
});

describe("MCP tools through a real MCP client", () => {
  async function seed() {
    const ideas = await createWatchlist({ name: "Ideen" }, testDb.client);
    const dividends = await createWatchlist({ name: "Dividenden" }, testDb.client);
    if (!ideas.ok || !dividends.ok) throw new Error("setup failed");
    const sap = await ensureSecurity({ isin: SAP }, { name: "SAP SE", assetType: "STOCK" }, testDb.client);
    if (!sap.ok) throw new Error("setup failed");
    for (const [date, price] of [["2026-10-26", "100"], ["2026-10-27", "110"]]) {
      await testDb.client.price.create({ data: { securityId: sap.security.id, date, source: "PROVIDER", price, fetchedAt: `${date}T18:00:00.000Z` } });
    }
    return { ideas: ideas.watchlist.id, dividends: dividends.watchlist.id, sap: sap.security.id };
  }

  it("lists exactly the nine watchlist tools plus the nine portfolio read tools, with or without portfolio:read (acceptance)", async () => {
    const writeTools = ["create_watchlist", "rename_watchlist", "delete_watchlist", "add_watchlist_entry", "update_watchlist_entry", "remove_watchlist_entry"];
    for (const options of [{}, { scope: "watchlist portfolio:read", portfolioRead: true }]) {
      const client = await mcpClient((await connect(undefined, options)).access_token);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(18);
      expect(tools.map((tool) => tool.name).sort()).toEqual([...WATCHLIST_TOOL_NAMES, ...PORTFOLIO_TOOL_NAMES].sort());
      for (const name of PORTFOLIO_TOOL_NAMES) expect(tools.find((tool) => tool.name === name)?.annotations?.readOnlyHint).toBe(true);
      // No tool outside the watchlist write tools may write: everything else is read-only.
      const writable = tools.filter((tool) => tool.annotations?.readOnlyHint !== true).map((tool) => tool.name);
      expect(writable.sort()).toEqual([...writeTools].sort());
      await client.close();
    }
  });

  it("adds held to watchlist entries only with portfolio:read (acceptance)", async () => {
    const { ideas, sap } = await seed();
    const apple = await ensureSecurity({ isin: APPLE }, { name: "Apple Inc.", assetType: "STOCK" }, testDb.client);
    const depot = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, testDb.client);
    if (!apple.ok || !depot.ok) throw new Error("setup failed");
    await recordTransaction({ depotId: depot.depot.id, type: "DEPOSIT", date: "2026-01-02", amount: "1000" }, testDb.client);
    const buy = await recordTransaction(
      { depotId: depot.depot.id, type: "BUY", date: "2026-01-05", quantity: "1", price: "100", security: { id: sap } },
      testDb.client,
    );
    if (!buy.ok) throw new Error("setup failed");
    await addWatchlistEntry({ watchlistId: ideas, security: { id: sap } }, TODAY, testDb.client);

    const withScope = await mcpClient((await connect(undefined, { scope: "watchlist portfolio:read", portfolioRead: true })).access_token);
    const got = await call(withScope, "get_watchlist", { watchlist_id: ideas });
    expect(got.payload.entries.map((entry: { held: boolean }) => entry.held)).toEqual([true]);
    const added = await call(withScope, "add_watchlist_entry", { watchlist_id: ideas, isin: APPLE });
    expect(added.payload.held).toBe(false);
    const updated = await call(withScope, "update_watchlist_entry", { entry_id: added.payload.id, note: "x" });
    expect(updated.payload.held).toBe(false);
    await withScope.close();

    const without = await mcpClient((await connect()).access_token);
    const plain = await call(without, "get_watchlist", { watchlist_id: ideas });
    for (const entry of plain.payload.entries) expect(entry).not.toHaveProperty("held");
    const updatedPlain = await call(without, "update_watchlist_entry", { entry_id: added.payload.id, note: "y" });
    expect(updatedPlain.payload).not.toHaveProperty("held");
    await without.close();
  });

  it("adds an entry with source MCP and the client name, visible in watchlistView (acceptance)", async () => {
    const { ideas, sap } = await seed();
    const client = await mcpClient((await connect()).access_token);
    const added = await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: SAP.toLowerCase(), note: "KGV", date_added: "2026-10-26" });
    expect(added).toEqual({
      isError: false,
      payload: {
        id: expect.any(String),
        security_id: sap,
        name: "SAP SE",
        isin: SAP,
        crypto_symbol: null,
        asset_type: "STOCK",
        note: "KGV",
        date_added: "2026-10-26",
        price: "110",
        price_date: "2026-10-27",
        stale: false,
        change_today: { per_unit: "10", ratio: "0.1" },
        change_since_added: "0.1",
        source: "MCP",
        client_name: "Claude",
      },
    });
    expect(added.payload).not.toHaveProperty("held");
    expect(lookups).toEqual([]);
    expect(changes).toEqual([{ backfill: true }]);
    const [list] = await watchlistView(TODAY, testDb.client);
    expect(list.entries).toHaveLength(1);
    expect(list.entries[0]).toMatchObject({ securityId: sap, source: "MCP", clientName: "Claude" });
    await client.close();
  });

  it("get_watchlist returns the key figures per entry: snapshot decimals or null, as_of, stale and fifty_two_week", async () => {
    const { ideas, sap } = await seed();
    await addWatchlistEntry({ watchlistId: ideas, security: { id: sap } }, TODAY, testDb.client);
    const client = await mcpClient((await connect()).access_token);
    let got = await call(client, "get_watchlist", { watchlist_id: ideas });
    expect(got.payload.entries[0].key_figures).toMatchObject({
      source: "Yahoo Finance",
      as_of: null,
      stale: false,
      trailing_pe: null,
      fifty_two_week: { high: "110", high_date: "2026-10-27", low: "100", low_date: "2026-10-26", distance_to_high: "0", performance: null },
    });

    await testDb.client.securityKeyFigures.create({
      data: {
        securityId: sap,
        symbol: "SAP.DE", kind: "stock",
        figures: JSON.stringify({ trailingPE: "30.4321", dividendYield: "0.0118", marketCap: "243770000000", marketCapCurrency: "EUR" }),
        fetchedAt: "2026-10-27T09:00:00.000Z",
      },
    });
    got = await call(client, "get_watchlist", { watchlist_id: ideas });
    const figures = got.payload.entries[0].key_figures;
    expect(figures).toMatchObject({
      as_of: "2026-10-27",
      stale: false,
      trailing_pe: "30.4321",
      forward_pe: null,
      dividend_yield: "0.0118",
      market_cap: "243770000000",
      market_cap_currency: "EUR",
      expense_ratio: null,
    });
    expect(got.payload.entries[0]).not.toHaveProperty("held");
    await client.close();
  });

  it("get_watchlist returns each entry's analyst ratings (story 9.7) or null", async () => {
    const { ideas, sap } = await seed();
    await addWatchlistEntry({ watchlistId: ideas, security: { id: sap } }, TODAY, testDb.client);
    const client = await mcpClient((await connect()).access_token);
    let got = await call(client, "get_watchlist", { watchlist_id: ideas });
    expect(got.payload.entries[0].key_figures.analysts).toBeNull();

    await testDb.client.securityKeyFigures.create({
      data: {
        securityId: sap,
        symbol: "SAP.DE",
        kind: "stock",
        figures: "{}",
        analystSymbol: "SAP.DE",
        analysts: JSON.stringify({
          trend: [
            { period: "-1m", strongBuy: 10, buy: 21, hold: 14, sell: 2, strongSell: 1 },
            { period: "0m", strongBuy: 11, buy: 20, hold: 14, sell: 3, strongSell: 1 },
          ],
          analystCount: 51,
          consensusMean: "1.85",
          target: { low: "200", mean: "270", median: "272.5", high: "310", currentPrice: "240", currency: "EUR" },
          changes: [
            { date: "2026-10-21", firm: "Synthetic Securities", fromGrade: "Hold", toGrade: "Buy", action: "up", priceTargetFrom: "250", priceTargetTo: "270" },
          ],
        }),
        fetchedAt: "2026-10-27T09:00:00.000Z",
      },
    });
    got = await call(client, "get_watchlist", { watchlist_id: ideas });
    expect(got.payload.entries[0].key_figures.analysts).toEqual({
      symbol: "SAP.DE",
      consensus: "optimistic",
      consensus_mean: "1.85",
      analyst_count: 51,
      trend: [
        { period: "-1m", strong_buy: 10, buy: 21, hold: 14, sell: 2, strong_sell: 1 },
        { period: "0m", strong_buy: 11, buy: 20, hold: 14, sell: 3, strong_sell: 1 },
      ],
      price_target: { low: "200", mean: "270", median: "272.5", high: "310", currency: "EUR", current_price: "240", implied_change: "0.125" },
      recent_changes: [
        {
          date: "2026-10-21",
          firm: "Synthetic Securities",
          from_grade: "Hold",
          to_grade: "Buy",
          action: "up",
          price_target_from: "250",
          price_target_to: "270",
        },
      ],
    });
    await client.close();
  });

  it("lists, gets, creates, renames and deletes watchlists", async () => {
    const { ideas, sap } = await seed();
    await addWatchlistEntry({ watchlistId: ideas, security: { id: sap } }, TODAY, testDb.client);
    const client = await mcpClient((await connect()).access_token);

    expect((await call(client, "list_watchlists")).payload).toEqual([
      { id: ideas, name: "Ideen", entry_count: 1 },
      { id: expect.any(String), name: "Dividenden", entry_count: 0 },
    ]);
    const got = await call(client, "get_watchlist", { watchlist_id: ideas });
    expect(got.payload).toMatchObject({ id: ideas, name: "Ideen", entries: [{ security_id: sap, source: "APP", client_name: null }] });
    expect(got.payload.entries[0]).not.toHaveProperty("held");
    expect(await call(client, "get_watchlist", { watchlist_id: "nope" })).toEqual({
      isError: true,
      payload: { error: "watchlist-not-found", message: "Diese Watchlist gibt es nicht." },
    });

    const created = await call(client, "create_watchlist", { name: " Tech " });
    expect(created).toEqual({ isError: false, payload: { id: expect.any(String), name: "Tech", entry_count: 0 } });
    expect(await call(client, "create_watchlist", { name: "ideen" })).toMatchObject({ isError: true, payload: { error: "name-taken" } });
    expect(await call(client, "create_watchlist", { name: "x".repeat(61) })).toMatchObject({ isError: true, payload: { error: "name-too-long" } });
    expect(await call(client, "rename_watchlist", { watchlist_id: created.payload.id, name: "Technologie" })).toMatchObject({
      payload: { name: "Technologie" },
    });
    expect(await call(client, "rename_watchlist", { watchlist_id: "nope", name: "X" })).toMatchObject({
      isError: true,
      payload: { error: "watchlist-not-found" },
    });

    expect(await call(client, "delete_watchlist", { watchlist_id: created.payload.id })).toEqual({
      isError: false,
      payload: { deleted: true, id: created.payload.id, name: "Technologie", entries_deleted: 0 },
    });
    expect(await call(client, "delete_watchlist", { watchlist_id: ideas })).toMatchObject({ isError: true, payload: { error: "confirm-name-mismatch" } });
    expect(await call(client, "delete_watchlist", { watchlist_id: ideas, confirm_name: "ideen" })).toMatchObject({
      isError: true,
      payload: { error: "confirm-name-mismatch" },
    });
    expect(await testDb.client.watchlist.count({ where: { id: ideas } })).toBe(1);
    expect(await call(client, "delete_watchlist", { watchlist_id: ideas, confirm_name: "Ideen" })).toMatchObject({
      payload: { deleted: true, entries_deleted: 1 },
    });
    expect(await testDb.client.security.count({ where: { id: sap } })).toBe(1);
    expect(changes.every((change) => change.backfill === false)).toBe(true);
    await client.close();
  });

  it("creates an unknown ISIN from OpenFIGI, an unknown crypto symbol from its symbol, and refuses misses without writing", async () => {
    const { ideas } = await seed();
    const client = await mcpClient((await connect()).access_token);
    const securities = () => testDb.client.security.count();
    const before = await securities();

    lookupReply = { status: "not-found" };
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: APPLE })).toEqual({
      isError: true,
      payload: { error: "isin-not-found", message: expect.any(String) },
    });
    lookupReply = { status: "error" };
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: APPLE })).toMatchObject({ payload: { error: "isin-lookup-failed" } });
    lookupReply = { status: "found", value: { name: "Some Bond", securityType: "Corp Bond", securityType2: null, marketSector: "Corp" } };
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: APPLE })).toMatchObject({ payload: { error: "asset-type-unknown" } });
    expect(await securities()).toBe(before);
    expect(await testDb.client.watchlistEntry.count()).toBe(0);
    expect(lookups).toEqual([APPLE, APPLE, APPLE]);

    lookupReply = { status: "found", value: { name: "ISHARES CORE MSCI WORLD", securityType: "ETP", securityType2: "Mutual Fund", marketSector: "Equity" } };
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: MSCI_WORLD })).toMatchObject({
      isError: false,
      payload: { name: "ISHARES CORE MSCI WORLD", isin: MSCI_WORLD, asset_type: "ETF", price: null, change_since_added: null, source: "MCP" },
    });
    lookupReply = { status: "found", value: { name: "APPLE INC", securityType: "Common Stock", securityType2: "Common Stock", marketSector: "Equity" } };
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: APPLE, name: `Apple ${"x".repeat(200)}` })).toMatchObject({
      payload: { name: `Apple ${"x".repeat(94)}`, asset_type: "STOCK" },
    });
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, crypto_symbol: "eth" })).toMatchObject({
      payload: { name: "ETH", crypto_symbol: "ETH", asset_type: "CRYPTO", source: "MCP", client_name: "Claude" },
    });
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, crypto_symbol: "eth" })).toMatchObject({
      payload: { error: "already-on-list", message: "Steht schon auf dieser Liste." },
    });
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: SAP, crypto_symbol: "BTC" })).toMatchObject({
      payload: { error: "identifier-invalid" },
    });
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas })).toMatchObject({ payload: { error: "identifier-invalid" } });
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: "US0378331006" })).toMatchObject({ payload: { error: "isin-invalid" } });
    expect(await call(client, "add_watchlist_entry", { watchlist_id: "nope", isin: SAP })).toMatchObject({ payload: { error: "watchlist-not-found" } });
    expect(await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: SAP, date_added: "2099-01-01" })).toMatchObject({
      payload: { error: "date-invalid" },
    });
    expect(lookups).toHaveLength(5);
    await client.close();
  });

  it("updates, moves and removes entries", async () => {
    const { ideas, dividends, sap } = await seed();
    const client = await mcpClient((await connect()).access_token);
    const added = await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: SAP });
    const entryId = added.payload.id as string;
    changes = [];

    expect(await call(client, "update_watchlist_entry", { entry_id: entryId, note: "Neu", date_added: "2026-10-26" })).toMatchObject({
      payload: { id: entryId, note: "Neu", date_added: "2026-10-26", change_since_added: "0.1" },
    });
    expect(changes).toEqual([{ backfill: true }]);
    changes = [];
    expect(await call(client, "update_watchlist_entry", { entry_id: entryId, note: "Nur Notiz" })).toMatchObject({ payload: { note: "Nur Notiz" } });
    expect(changes).toEqual([{ backfill: false }]);
    expect(await call(client, "update_watchlist_entry", { entry_id: entryId, note: "x".repeat(2001) })).toMatchObject({ payload: { error: "note-too-long" } });
    changes = [];
    expect(await call(client, "update_watchlist_entry", { entry_id: entryId, watchlist_id: dividends })).toMatchObject({ payload: { id: entryId } });
    expect(changes).toEqual([{ backfill: true }]);
    expect((await testDb.client.watchlistEntry.findUniqueOrThrow({ where: { id: entryId } })).watchlistId).toBe(dividends);
    expect(await call(client, "update_watchlist_entry", { entry_id: "nope", note: "x" })).toMatchObject({
      payload: { error: "entry-not-found", message: "Diesen Eintrag gibt es nicht." },
    });

    expect(await call(client, "remove_watchlist_entry", { entry_id: entryId })).toEqual({ isError: false, payload: { removed: true, id: entryId } });
    expect(await call(client, "remove_watchlist_entry", { entry_id: entryId })).toMatchObject({ payload: { error: "entry-not-found" } });
    expect(await testDb.client.security.count({ where: { id: sap } })).toBe(1);
    await client.close();
  });

  it("searches known Securities", async () => {
    await seed();
    await ensureSecurity({ cryptoSymbol: "BTC" }, { name: "Bitcoin", assetType: "CRYPTO" }, testDb.client);
    const client = await mcpClient((await connect()).access_token);
    expect((await call(client, "search_securities", { query: "sap" })).payload).toEqual([
      { id: expect.any(String), name: "SAP SE", isin: SAP, crypto_symbol: null, asset_type: "STOCK" },
    ]);
    expect((await call(client, "search_securities", { query: "btc" })).payload).toMatchObject([{ name: "Bitcoin" }]);
    expect(await call(client, "search_securities", { query: " " })).toMatchObject({ isError: true, payload: { error: "query-empty" } });
    expect(lookups).toEqual([]);
    await client.close();
  });

  it("never logs tokens or payload values", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const { access_token } = await connect();
    const { ideas } = await seed();
    const client = await mcpClient(access_token);
    await call(client, "add_watchlist_entry", { watchlist_id: ideas, isin: SAP, note: "geheime Notiz" });
    await call(client, "create_watchlist", { name: "ideen" });
    const logged = logs.flatMap((spy) => spy.mock.calls.flat()).map(String).join("\n");
    expect(logged).not.toContain(access_token);
    expect(logged).not.toContain("geheime Notiz");
    await client.close();
  });
});

describe("portfolio:read through a real MCP client (story 10.1)", () => {
  const DENIED = { error: "portfolio-read-required", message: "Keine Berechtigung für Depotdaten" };

  async function seedDepots() {
    const main = await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" }, testDb.client);
    const old = await createDepot({ name: "Altdepot", broker: "FINANZEN_ZERO" }, testDb.client);
    if (!main.ok || !old.ok) throw new Error("setup failed");
    const deposit = await recordTransaction({ depotId: main.depot.id, type: "DEPOSIT", date: "2026-01-05", amount: "1234.56" }, testDb.client);
    if (!deposit.ok) throw new Error("setup failed");
    if (!(await archiveDepot(old.depot.id, testDb.client)).ok) throw new Error("setup failed");
    return { main: main.depot.id, old: old.depot.id };
  }

  const refresh = (token: string, clientId: string, scope?: string) =>
    handleToken(
      post(
        "/oauth/token",
        new URLSearchParams({ grant_type: "refresh_token", refresh_token: token, client_id: clientId, ...(scope ? { scope } : {}) }).toString(),
        "application/x-www-form-urlencoded",
      ),
      deps(),
    );

  it("list_depots returns every Depot (archived included) in listDepots order with decimal-string cash balances", async () => {
    const { main, old } = await seedDepots();
    const connection = await connect(undefined, { scope: "watchlist portfolio:read", portfolioRead: true });
    expect(connection.scope).toBe("watchlist portfolio:read");
    const client = await mcpClient(connection.access_token);
    const { isError, payload } = await call(client, "list_depots");
    expect(isError).toBe(false);
    expect(payload).toEqual({
      depots: [
        { id: old, name: "Altdepot", broker: "FINANZEN_ZERO", archived: true, cash_balance: expect.any(String) },
        { id: main, name: "Hauptdepot", broker: "COMDIRECT", archived: false, cash_balance: expect.any(String) },
      ],
    });
    const expected = (await listDepots(testDb.client)).map((depot) => depot.cashBalance);
    expect(payload.depots.map((depot: { cash_balance: string }) => depot.cash_balance)).toEqual(expected);
    expect(payload.depots[1].cash_balance).toMatch(/^1234\.56/);
    await client.close();
  });

  it.each([
    ["not requested", { scope: "watchlist" }],
    ["requested but unchecked", { scope: "watchlist portfolio:read", portfolioRead: false }],
    ["forged checkbox without the requested scope", { scope: "watchlist", portfolioRead: true }],
  ])("refuses list_depots without data when %s (acceptance)", async (_case, options) => {
    await seedDepots();
    const connection = await connect(undefined, options);
    expect(connection.scope).toBe("watchlist");
    const client = await mcpClient(connection.access_token);
    const result = (await client.callTool({ name: "list_depots", arguments: {} })) as ToolResult;
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(JSON.parse(result.content[0].text)).toEqual(DENIED);
    expect(result.content[0].text).not.toContain("Hauptdepot");
    expect((await call(client, "list_watchlists")).isError).toBe(false);
    await client.close();
  });

  it("get_portfolio_summary end-to-end: figures with portfolio:read, the refusal without it", async () => {
    await seedDepots();
    const granted = await mcpClient((await connect(undefined, { scope: "watchlist portfolio:read", portfolioRead: true })).access_token);
    const { isError, payload } = await call(granted, "get_portfolio_summary", { period: "YTD" });
    expect(isError).toBe(false);
    expect(payload).toMatchObject({ period: "YTD", from: "2026-01-01", to: TODAY, value: "1234.56", cash: "1234.56", has_transactions: true });
    expect(payload.depots.map((depot: { name: string }) => depot.name)).toEqual(["Hauptdepot"]);
    await granted.close();
    const plain = await mcpClient((await connect()).access_token);
    expect(await call(plain, "get_portfolio_summary")).toEqual({ isError: true, payload: DENIED });
    await plain.close();
  });

  it("grants watchlist plus portfolio:read when only portfolio:read was requested and checked", async () => {
    const connection = await connect(undefined, { scope: "portfolio:read", portfolioRead: true });
    expect(connection.scope).toBe("watchlist portfolio:read");
    const client = await mcpClient(connection.access_token);
    expect((await call(client, "list_depots")).isError).toBe(false);
    expect((await call(client, "list_watchlists")).isError).toBe(false);
    await client.close();
  });

  it("after Depotzugriff entfernen the same access token is refused, watchlist tools still work and refresh cannot regain the scope (acceptance)", async () => {
    await seedDepots();
    const { access_token, refresh_token, client_id } = await connect(undefined, { scope: "watchlist portfolio:read", portfolioRead: true });
    const before = await mcpClient(access_token);
    expect((await call(before, "list_depots")).isError).toBe(false);
    await before.close();

    const [app] = await listConnectedApps(testDb.client);
    expect(await removePortfolioAccess(app.grantId, testDb.client)).toEqual({ ok: true, clientName: "Claude" });
    expect(await listConnectedApps(testDb.client)).toEqual([expect.objectContaining({ grantId: app.grantId, scopes: ["watchlist"] })]);

    const after = await mcpClient(access_token);
    expect(await call(after, "list_depots")).toEqual({ isError: true, payload: DENIED });
    expect((await call(after, "list_watchlists")).isError).toBe(false);
    await after.close();

    const widened = await refresh(refresh_token, client_id, "portfolio:read");
    expect(widened.status).toBe(400);
    expect(await widened.json()).toMatchObject({ error: "invalid_scope" });
    const renewed = await refresh(refresh_token, client_id);
    expect(renewed.status).toBe(200);
    const body = (await renewed.json()) as { access_token: string; scope: string };
    expect(body.scope).toBe("watchlist");
    const next = await mcpClient(body.access_token);
    expect(await call(next, "list_depots")).toEqual({ isError: true, payload: DENIED });
    await next.close();
  });
});
