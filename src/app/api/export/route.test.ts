import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));

import { prisma } from "@/db";
import { createExport, EXPORT_SCHEMA_VERSION, exportFileSchema, serializeExport } from "@/modules/backup";
import { setTaxAllowances } from "@/modules/tax";
import { createDepot, ensureSecurity } from "@/modules/ledger";
import { saveManualLogo } from "@/modules/logos";
import { GET } from "./route";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
let dataDir: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  dataDir = mkdtempSync(join(tmpdir(), "depot-export-route-"));
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  await prisma.securityLogo.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...savedEnv };
  rmSync(dataDir, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

describe("GET /api/export", () => {
  it("returns 401 JSON without a session and no data", async () => {
    await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    fakes.current.state.incoming.clear();
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(response.headers.get("Content-Disposition")).toBeNull();
  });

  it("serves the export as an attachment with no-store and nosniff", async () => {
    await createDepot({ name: "Hauptdepot", broker: "COMDIRECT" });
    const security = await ensureSecurity({ isin: "DE0007164600" }, { name: "SAP SE", assetType: "STOCK" });
    if (!security.ok) throw new Error("setup failed");
    expect(await saveManualLogo(security.security.id, PNG)).toEqual({ ok: true });
    expect(await setTaxAllowances("2026", { COMDIRECT: "801" })).toEqual({ ok: true });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="depotmanagement-export-\d{8}-\d{6}\.json"$/,
    );
    const text = await response.text();
    expect(text.startsWith(`{\n  "schemaVersion": ${EXPORT_SCHEMA_VERSION},`)).toBe(true);
    const file = exportFileSchema.parse(JSON.parse(text));
    expect(file.depots.map((depot) => depot.name)).toEqual(["Hauptdepot"]);
    expect(file.logos).toHaveLength(1);
    expect(file.taxAllowances).toMatchObject([{ broker: "COMDIRECT", year: 2026, amount: "801" }]);
    expect(Buffer.from(file.logos[0]!.data, "base64")).toEqual(Buffer.from(PNG));
    expect(text).toBe(serializeExport(await createExport()));
  });

  it("answers an unexpected failure with 500 export-failed, no attachment and a name-only log", async () => {
    await prisma.depot.create({ data: { name: "Hauptdepot", broker: "COMDIRECT" } });
    // A stored name that breaks the schema makes the export fail validation.
    await prisma.depot.updateMany({ data: { name: "" } });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "export-failed" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    const routeLog = error.mock.calls.map((call) => String(call[0])).find((line) => line.startsWith("Export: creating"));
    expect(routeLog).toBe("Export: creating the export failed (Error)");
    expect(routeLog).not.toContain("export-invalid");
  });
});
