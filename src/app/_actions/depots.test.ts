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
import { listDepots } from "@/modules/ledger";
import { createDepotAction, renameDepotAction } from "./depots";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  await prisma.depot.deleteMany();
});

afterEach(() => {
  process.env = { ...savedEnv };
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("createDepotAction", () => {
  it("creates the Depot and revalidates the layout", async () => {
    const result = await createDepotAction(null, form({ name: " Hauptdepot ", broker: "COMDIRECT" }));
    expect(result).toEqual({
      ok: true,
      depot: { id: expect.any(String), name: "Hauptdepot", broker: "COMDIRECT", cashBalance: "0" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect((await listDepots()).map((d) => d.name)).toEqual(["Hauptdepot"]);
  });

  it.each([
    [{ name: "  ", broker: "COMDIRECT" }, "name-empty"],
    [{ name: "x".repeat(61), broker: "COMDIRECT" }, "name-too-long"],
    [{ name: "Depot", broker: "FOO" }, "broker-invalid"],
    [{ name: "Depot" }, "broker-invalid"],
  ])("returns the field error for %j without writing", async (fields, reason) => {
    expect(await createDepotAction(null, form(fields))).toEqual({ ok: false, reason });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listDepots()).toEqual([]);
  });

  it("returns name-taken for a duplicate in another case", async () => {
    await createDepotAction(null, form({ name: "Comdirect Depot", broker: "COMDIRECT" }));
    revalidatePath.mockClear();
    const result = await createDepotAction(null, form({ name: "comdirect depot", broker: "COMDIRECT" }));
    expect(result).toEqual({ ok: false, reason: "name-taken" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["no cookie", undefined],
    ["an invalid cookie", "garbage"],
  ])("returns unauthorized with %s and writes nothing", async (_label, cookie) => {
    fakes.current.state.incoming.clear();
    if (cookie) fakes.current.state.incoming.set(SESSION_COOKIE, cookie);
    const result = await createDepotAction(null, form({ name: "Hauptdepot", broker: "COMDIRECT" }));
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listDepots()).toEqual([]);
  });
});

describe("renameDepotAction", () => {
  async function createOne(name: string) {
    const result = await createDepotAction(null, form({ name, broker: "COMDIRECT" }));
    if (!result?.ok) throw new Error("setup failed");
    revalidatePath.mockClear();
    return result.depot;
  }

  it("renames and revalidates", async () => {
    const depot = await createOne("Comdirect Depot");
    const result = await renameDepotAction(null, form({ id: depot.id, name: "Hauptdepot" }));
    expect(result).toEqual({ ok: true, depot: { ...depot, name: "Hauptdepot" } });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("returns name-taken for another Depot's name", async () => {
    const depot = await createOne("Hauptdepot");
    await createOne("ZERO");
    expect(await renameDepotAction(null, form({ id: depot.id, name: "ZERO" }))).toEqual({
      ok: false,
      reason: "name-taken",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([{ id: "xyz", name: "Neu" }, { name: "Neu" }])("returns not-found for %j", async (fields) => {
    expect(await renameDepotAction(null, form(fields))).toEqual({ ok: false, reason: "not-found" });
  });

  it("returns unauthorized without a session and leaves the name unchanged", async () => {
    const depot = await createOne("Hauptdepot");
    fakes.current.state.incoming.clear();
    expect(await renameDepotAction(null, form({ id: depot.id, name: "Neu" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await listDepots()).map((d) => d.name)).toEqual(["Hauptdepot"]);
  });

  it("returns name-empty for a blank name without revalidating", async () => {
    const depot = await createOne("Hauptdepot");
    expect(await renameDepotAction(null, form({ id: depot.id, name: "   " }))).toEqual({
      ok: false,
      reason: "name-empty",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await listDepots()).map((d) => d.name)).toEqual(["Hauptdepot"]);
  });
});
