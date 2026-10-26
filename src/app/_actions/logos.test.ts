import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { ensureSecurity } from "@/modules/ledger";
import { uploadLogoAction } from "./logos";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let dataDir: string;
let securityId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  dataDir = mkdtempSync(join(tmpdir(), "depot-logo-action-"));
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
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

function form(fields: Record<string, string | File>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const file = (bytes: Uint8Array<ArrayBuffer>, name = "logo.png", type = "image/png") => new File([bytes], name, { type });
const stored = () => prisma.securityLogo.findUnique({ where: { securityId } });
const files = () => {
  try {
    return readdirSync(join(dataDir, "logos"));
  } catch {
    return [];
  }
};

describe("uploadLogoAction", () => {
  it("stores the upload as the manual logo and revalidates", async () => {
    expect(await uploadLogoAction(null, form({ securityId, file: file(PNG) }))).toEqual({ ok: true });
    expect(await stored()).toMatchObject({ source: "MANUAL", provider: null, contentType: "image/png" });
    expect(files()).toHaveLength(1);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it.each([
    ["no file", {}, "file-missing"],
    ["an empty file", { file: file(new Uint8Array(0)) }, "file-missing"],
    ["a 2 MiB file", { file: file(new Uint8Array([...PNG, ...new Uint8Array(2 * 1024 * 1024)])) }, "file-too-large"],
    ["a GIF named .png", { file: file(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) }, "file-type"],
  ])("returns a typed failure for %s without writing", async (_label, fields, reason) => {
    expect(await uploadLogoAction(null, form({ securityId, ...fields }))).toEqual({ ok: false, reason });
    expect(await stored()).toBeNull();
    expect(files()).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown Security", async () => {
    expect(await uploadLogoAction(null, form({ securityId: "nope", file: file(PNG) }))).toEqual({ ok: false, reason: "not-found" });
    expect(await uploadLogoAction(null, form({ file: file(PNG) }))).toEqual({ ok: false, reason: "not-found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes nothing without a session", async () => {
    fakes.current.state.incoming.clear();
    expect(await uploadLogoAction(null, form({ securityId, file: file(PNG) }))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await stored()).toBeNull();
    expect(files()).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
