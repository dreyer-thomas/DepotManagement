import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidatePath = vi.hoisted(() => vi.fn());
const schedulePriceBackfill = vi.hoisted(() => vi.fn());
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/app/_actions/price-refresh", () => ({ schedulePriceBackfill }));

import { prisma } from "@/db";
import { ensureSecurity } from "@/modules/ledger";
import { approveAuthorization, readMcpConfig, validateAuthorizeRequest } from "@/modules/mcp";
import { createWatchlist, watchlistView } from "@/modules/watchlist";
import { GET as authorizationServer } from "../../.well-known/oauth-authorization-server/route";
import { GET as protectedResourceSuffixed } from "../../.well-known/oauth-protected-resource/api/mcp/route";
import { GET as protectedResource } from "../../.well-known/oauth-protected-resource/route";
import { POST as register } from "../../oauth/register/route";
import { POST as token } from "../../oauth/token/route";
import { DELETE, GET, POST } from "./route";

const APP_URL = "https://depot.example.com";
const REDIRECT = "http://localhost:33418/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const savedEnv = { ...process.env };

beforeEach(async () => {
  process.env.APP_URL = APP_URL;
  revalidatePath.mockClear();
  schedulePriceBackfill.mockClear();
  await prisma.oAuthToken.deleteMany();
  await prisma.oAuthGrant.deleteMany();
  await prisma.oAuthClient.deleteMany();
  await prisma.watchlistEntry.deleteMany();
  await prisma.watchlist.deleteMany();
  await prisma.security.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${APP_URL}/api/mcp`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", ...headers },
  });
}

describe("OAuth and MCP routes", () => {
  it("answer GET and DELETE on /api/mcp with 405 (no SSE stream, no sessions)", async () => {
    expect(GET().status).toBe(405);
    expect(DELETE().status).toBe(405);
  });

  it("answer 503 while APP_URL is unset", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.APP_URL;
    expect(protectedResource().status).toBe(503);
    expect(protectedResourceSuffixed().status).toBe(503);
    expect(authorizationServer().status).toBe(503);
    expect((await POST(rpc({}))).status).toBe(503);
  });

  it("serve discovery and connect Claude Code end to end; an add revalidates the pages and schedules the backfill", async () => {
    expect(await protectedResourceSuffixed().json()).toMatchObject({ resource: `${APP_URL}/api/mcp`, authorization_servers: [APP_URL] });
    expect(await authorizationServer().json()).toMatchObject({ token_endpoint: `${APP_URL}/oauth/token` });
    const unauthorized = await POST(rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/api/mcp"`,
    );

    const registered = await register(
      new Request(`${APP_URL}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Claude Code", redirect_uris: [REDIRECT] }),
      }),
    );
    expect(registered.status).toBe(201);
    const { client_id } = (await registered.json()) as { client_id: string };
    const config = readMcpConfig({ APP_URL })!;
    const validation = await validateAuthorizeRequest(
      { response_type: "code", client_id, redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: "S256" },
      config,
    );
    if (validation.kind !== "ok") throw new Error("setup failed");
    const code = new URL(await approveAuthorization(validation.request, config)).searchParams.get("code")!;
    const issued = await token(
      new Request(`${APP_URL}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id }).toString(),
      }),
    );
    expect(issued.status).toBe(200);
    const { access_token } = (await issued.json()) as { access_token: string };

    const list = await createWatchlist({ name: "Ideen" });
    const btc = await ensureSecurity({ cryptoSymbol: "BTC" }, { name: "Bitcoin", assetType: "CRYPTO" });
    if (!list.ok || !btc.ok) throw new Error("setup failed");
    const auth = { authorization: `Bearer ${access_token}` };
    const response = await POST(
      rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "add_watchlist_entry", arguments: { watchlist_id: list.watchlist.id, crypto_symbol: "BTC" } } }, auth),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBeUndefined();
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({ security_id: btc.security.id, source: "MCP", client_name: "Claude Code" });
    expect(revalidatePath).toHaveBeenCalledWith("/watchlists");
    expect(revalidatePath).toHaveBeenCalledWith("/securities");
    expect(revalidatePath).toHaveBeenCalledWith("/securities/[id]", "page");
    expect(schedulePriceBackfill).toHaveBeenCalledTimes(1);
    const [view] = await watchlistView("2026-10-28");
    expect(view.entries[0]).toMatchObject({ source: "MCP", clientName: "Claude Code" });
  });
});
