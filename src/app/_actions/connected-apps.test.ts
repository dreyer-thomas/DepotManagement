import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { prisma } from "@/db";
import { disconnectAllAppsAction, disconnectAppAction } from "./connected-apps";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
const T0 = "2026-10-28T10:00:00.000Z";

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  await prisma.oAuthClient.deleteMany();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

/** A client with one active grant and an access token (only its hash matters here). */
async function grant(name: string, suffix: string) {
  const client = await prisma.oAuthClient.create({
    data: {
      clientId: `client-${suffix}`,
      clientName: name,
      redirectUris: JSON.stringify(["https://claude.ai/cb"]),
      grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
      tokenEndpointAuthMethod: "none",
      createdAt: T0,
    },
  });
  const created = await prisma.oAuthGrant.create({ data: { clientId: client.id, scope: "watchlist", createdAt: T0 } });
  await prisma.oAuthToken.create({
    data: {
      kind: "ACCESS",
      hash: `hash-${suffix}`,
      clientId: client.id,
      grantId: created.id,
      scope: "watchlist",
      resource: "https://depot.example.com/api/mcp",
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: T0,
    },
  });
  return created.id;
}

describe("connected-apps actions without a session", () => {
  it("refuse and write nothing", async () => {
    const id = await grant("Claude", "a");
    fakes.current.state.incoming.clear();
    const unauthorized = { ok: false, reason: "unauthorized" };
    expect(await disconnectAppAction(id)).toEqual(unauthorized);
    expect(await disconnectAllAppsAction()).toEqual(unauthorized);
    expect(await prisma.oAuthGrant.count({ where: { revokedAt: null } })).toBe(1);
    expect(await prisma.oAuthToken.count()).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("disconnectAppAction", () => {
  it("revokes the grant, deletes its tokens and revalidates /settings", async () => {
    const id = await grant("Claude", "a");
    const other = await grant("Claude Code", "b");
    expect(await disconnectAppAction(id)).toEqual({ ok: true, clientName: "Claude" });
    expect((await prisma.oAuthGrant.findUniqueOrThrow({ where: { id } })).revokedAt).not.toBeNull();
    expect(await prisma.oAuthToken.count({ where: { grantId: id } })).toBe(0);
    expect(await prisma.oAuthToken.count({ where: { grantId: other } })).toBe(1);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });

  it("answers not-found for a stale, unknown or non-string id", async () => {
    const id = await grant("Claude", "a");
    await disconnectAppAction(id);
    revalidatePath.mockClear();
    for (const value of [id, "unknown", 7, undefined]) {
      expect(await disconnectAppAction(value)).toEqual({ ok: false, reason: "not-found" });
    }
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });
});

describe("disconnectAllAppsAction", () => {
  it("revokes every active grant and names the count", async () => {
    await grant("A", "a");
    await grant("B", "b");
    await grant("C", "c");
    expect(await disconnectAllAppsAction()).toEqual({ ok: true, count: 3 });
    expect(await prisma.oAuthGrant.count({ where: { revokedAt: null } })).toBe(0);
    expect(await prisma.oAuthToken.count()).toBe(0);
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });
});
