import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));

import { prisma } from "@/db";
import { ensureSecurity } from "@/modules/ledger";
import { saveManualLogo } from "@/modules/logos";
import { GET } from "./route";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
let dataDir: string;
let securityId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  dataDir = mkdtempSync(join(tmpdir(), "depot-logo-route-"));
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  await prisma.securityLogo.deleteMany();
  await prisma.security.deleteMany();
  const security = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
  if (!security.ok) throw new Error("setup failed");
  securityId = security.security.id;
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(dataDir, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

const get = (id: string) => GET(new Request(`http://localhost/api/logos/${id}`), { params: Promise.resolve({ securityId: id }) });

describe("GET /api/logos/[securityId]", () => {
  it("returns 401 without a session", async () => {
    await saveManualLogo(securityId, PNG);
    fakes.current.state.incoming.clear();
    const response = await get(securityId);
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).not.toMatch(/^image\//);
  });

  it("returns 404 for an unknown Security, one without a row, and a marker", async () => {
    expect((await get("nope")).status).toBe(404);
    expect((await get(securityId)).status).toBe(404);
    await prisma.securityLogo.create({ data: { securityId, source: "FETCHED", fetchedAt: "2026-10-26T10:00:00.000Z" } });
    expect((await get(securityId)).status).toBe(404);
  });

  it("serves the stored file with its content type and the cache and security headers", async () => {
    expect(await saveManualLogo(securityId, PNG)).toEqual({ ok: true });
    const response = await get(securityId);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
  });

  it("returns 404 for a stored file name outside the logo directory", async () => {
    await prisma.securityLogo.create({
      data: { securityId, source: "MANUAL", fileName: "../depot.db", contentType: "image/png", fetchedAt: "2026-10-26T10:00:00.000Z" },
    });
    expect((await get(securityId)).status).toBe(404);
  });
});
