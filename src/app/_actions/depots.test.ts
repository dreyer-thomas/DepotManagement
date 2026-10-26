import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const revalidatePath = vi.hoisted(() => vi.fn());
/** `after()` from next/server: callbacks are captured, never run (no provider call in tests). */
const after = vi.hoisted(() => vi.fn());
/** The logo fetch that follows the price backfill in the same `after()` callback. */
const logos = vi.hoisted(() => ({ fetchMissingLogos: vi.fn() }));
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/modules/logos", () => logos);

import { prisma } from "@/db";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createImportBatch } from "@/modules/import";
import { listDepots, listTransactions, recordTransaction } from "@/modules/ledger";
import { confirmParqetMigration, EMPTY_DECISIONS, previewParqetMigration } from "@/modules/migration";
import { archiveDepotAction, createDepotAction, deleteDepotAction, renameDepotAction, unarchiveDepotAction } from "./depots";

const CASHLESS = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export-cashless.csv.txt"), "utf8");

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
  after.mockClear();
  await prisma.transaction.deleteMany();
  await prisma.corporateAction.deleteMany();
  await prisma.security.deleteMany();
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
      depot: {
        id: expect.any(String),
        name: "Hauptdepot",
        broker: "COMDIRECT",
        cashBalance: "0",
        archived: false,
        archivable: true,
        transactionCount: 0,
      },
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

describe("archiveDepotAction / unarchiveDepotAction", () => {
  async function createOne(name: string) {
    const result = await createDepotAction(null, form({ name, broker: "COMDIRECT" }));
    if (!result?.ok) throw new Error("setup failed");
    revalidatePath.mockClear();
    return result.depot;
  }

  it("archives a flat Depot, then reactivates it, revalidating each time", async () => {
    const depot = await createOne("Hauptdepot");
    expect(await archiveDepotAction(null, form({ id: depot.id }))).toEqual({
      ok: true,
      depot: { ...depot, archived: true },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(after).not.toHaveBeenCalled();
    revalidatePath.mockClear();
    expect(await unarchiveDepotAction(null, form({ id: depot.id }))).toEqual({ ok: true, depot });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("returns depot-not-flat for a Depot with cash and does not revalidate", async () => {
    const depot = await createOne("Hauptdepot");
    const deposit = await recordTransaction({ depotId: depot.id, type: "DEPOSIT", date: "2026-01-05", amount: "0.01" });
    expect(deposit.ok).toBe(true);
    expect(await archiveDepotAction(null, form({ id: depot.id }))).toEqual({ ok: false, reason: "depot-not-flat" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect((await listDepots())[0].archived).toBe(false);
  });

  it.each([archiveDepotAction, unarchiveDepotAction])("returns not-found for an unknown or missing id (%#)", async (action) => {
    expect(await action(null, form({ id: "nope" }))).toEqual({ ok: false, reason: "not-found" });
    expect(await action(null, form({}))).toEqual({ ok: false, reason: "not-found" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it.each([archiveDepotAction, unarchiveDepotAction])("returns unauthorized without a session (%#)", async (action) => {
    const depot = await createOne("Hauptdepot");
    fakes.current.state.incoming.clear();
    expect(await action(null, form({ id: depot.id }))).toEqual({ ok: false, reason: "unauthorized" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect((await listDepots())[0].archived).toBe(false);
  });
});

describe("deleteDepotAction", () => {
  async function createOne(name: string) {
    const result = await createDepotAction(null, form({ name, broker: "COMDIRECT" }));
    if (!result?.ok) throw new Error("setup failed");
    revalidatePath.mockClear();
    return result.depot;
  }

  it("rejects a missing session and keeps the Depot", async () => {
    const depot = await createOne("Hauptdepot");
    fakes.current.state.incoming.clear();
    expect(await deleteDepotAction(null, form({ id: depot.id, confirmName: "Hauptdepot" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
    expect(await listDepots()).toHaveLength(1);
  });

  it.each(["hauptdepot", "Hauptdepo", ""])("keeps the Depot when the typed name is %j", async (confirmName) => {
    const depot = await createOne("Hauptdepot");
    expect(await deleteDepotAction(null, form({ id: depot.id, confirmName }))).toEqual({ ok: false, reason: "name-mismatch" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await listDepots()).toHaveLength(1);
  });

  it("normalizes the typed name to NFC before comparing", async () => {
    const depot = await createOne("M\u00fcnchen");
    expect(await deleteDepotAction(null, form({ id: depot.id, confirmName: "Mu\u0308nchen" }))).toEqual({
      ok: true,
      deleted: { transactions: 0 },
    });
    expect(await listDepots()).toEqual([]);
  });

  it("discards the Depot's import batches with their PDFs", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "depot-delete-import-"));
    process.env.DATA_DIR = dataDir;
    try {
      const depot = await createOne("Hauptdepot");
      const bytes = new TextEncoder().encode("%PDF-1.4 synthetic");
      const staged = await createImportBatch(depot.id, [{ name: "a.pdf", bytes }], { extract: async () => "" });
      if (!staged.ok) throw new Error(staged.reason);
      expect(existsSync(join(dataDir, "imports", staged.batchId))).toBe(true);
      expect(await deleteDepotAction(null, form({ id: depot.id, confirmName: "Hauptdepot" }))).toMatchObject({ ok: true });
      expect(await prisma.importBatch.count()).toBe(0);
      expect(existsSync(join(dataDir, "imports", staged.batchId))).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("reports an unknown or missing id as not-found", async () => {
    expect(await deleteDepotAction(null, form({ id: "nope", confirmName: "x" }))).toEqual({ ok: false, reason: "not-found" });
    expect(await deleteDepotAction(null, form({ confirmName: "x" }))).toEqual({ ok: false, reason: "not-found" });
  });

  it("deletes a migrated Depot; the same export then migrates into a new Depot of that name without duplicates", async () => {
    const first = await createOne("Cominvest");
    const migrated = await confirmParqetMigration(first.id, CASHLESS, EMPTY_DECISIONS);
    if (!migrated.ok) throw new Error(migrated.reason);
    const booked = (await listTransactions(first.id)).length;
    expect(booked).toBe(9);

    expect(await deleteDepotAction(null, form({ id: first.id, confirmName: " Cominvest " }))).toEqual({
      ok: true,
      deleted: { transactions: booked },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await listDepots()).toEqual([]);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.security.count()).toBe(3);

    const second = await createOne("Cominvest");
    const preview = await previewParqetMigration(second.id, CASHLESS);
    if (!preview.ok) throw new Error(preview.reason);
    expect(preview.preview.duplicates).toEqual([]);
    expect(preview.preview.securities.every((security) => security.existing)).toBe(true);
    const again = await confirmParqetMigration(second.id, CASHLESS, EMPTY_DECISIONS);
    if (!again.ok) throw new Error(again.reason);
    expect(again.summary.booked).toMatchObject({ transactions: 9, securities: 0 });
    expect(again.summary.comparison?.positions.some((position) => position.mismatch)).toBe(false);
    expect(again.summary.comparison?.investedCapital.mismatch).toBe(false);
  });
});
