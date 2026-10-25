import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestFakes } from "../../../test/helpers/next-mocks";
import { createSessionToken, SESSION_COOKIE } from "@/modules/auth";

const fakes = vi.hoisted(() => ({}) as { current: ReturnType<typeof createRequestFakes> });
const dbFile = await vi.hoisted(async () => {
  const { useMigratedDatabaseForSingleton } = await import("../../../test/helpers/migrated-db-file");
  return useMigratedDatabaseForSingleton();
});

vi.mock("next/headers", () => ({
  cookies: async () => fakes.current.cookieStore,
  headers: async () => fakes.current.state.headers,
}));

import { prisma } from "@/db";
import { archiveDepot, createDepot } from "@/modules/ledger";
import { previewParqetAction } from "./migration";

const FIXTURE = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export.csv.txt"), "utf8");
const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  await prisma.transaction.deleteMany();
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

async function depotId(name = "Hauptdepot") {
  const created = await createDepot({ name, broker: "FINANZEN_ZERO" });
  if (!created.ok) throw new Error("setup failed");
  return created.depot.id;
}

function form(fields: { depotId?: string; file?: File | string }) {
  const data = new FormData();
  if (fields.depotId !== undefined) data.set("depotId", fields.depotId);
  if (fields.file !== undefined) data.set("file", fields.file);
  return data;
}

const csvFile = (text: string, name = "Depot-20241001-120000.csv") => new File([text], name, { type: "text/csv" });

describe("previewParqetAction", () => {
  it("returns the preview for the uploaded file and writes nothing", async () => {
    const id = await depotId();
    const result = await previewParqetAction(null, form({ depotId: id, file: csvFile(FIXTURE) }));
    if (!result?.ok) throw new Error(JSON.stringify(result));
    expect(result.preview.depot.name).toBe("Hauptdepot");
    expect(result.preview.exportDate).toBe("2024-06-10");
    expect(result.preview.figures?.cashBalance).toBe("9142.666322");
    expect(await prisma.security.count()).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.corporateAction.count()).toBe(0);
  });

  it.each([
    ["no file field", {}],
    ["a string instead of a file", { file: "text" }],
    ["an empty file input", { file: new File([], "") }],
  ])("returns file-missing for %s", async (_label, fields) => {
    const id = await depotId();
    expect(await previewParqetAction(null, form({ depotId: id, ...fields }))).toEqual({ ok: false, reason: "file-missing" });
  });

  it("returns file-too-large above 5 MB", async () => {
    const id = await depotId();
    const big = csvFile("x".repeat(5 * 1024 * 1024 + 1));
    expect(await previewParqetAction(null, form({ depotId: id, file: big }))).toEqual({ ok: false, reason: "file-too-large" });
  });

  it("returns depot-not-found for a missing or unknown Depot and depot-archived for an archived one", async () => {
    expect(await previewParqetAction(null, form({ file: csvFile(FIXTURE) }))).toEqual({ ok: false, reason: "depot-not-found" });
    expect(await previewParqetAction(null, form({ depotId: "nope", file: csvFile(FIXTURE) }))).toEqual({
      ok: false,
      reason: "depot-not-found",
    });
    const id = await depotId("Alt");
    expect((await archiveDepot(id)).ok).toBe(true);
    expect(await previewParqetAction(null, form({ depotId: id, file: csvFile(FIXTURE) }))).toEqual({
      ok: false,
      reason: "depot-archived",
    });
  });

  it("returns empty-file and missing-columns from the reader", async () => {
    const id = await depotId();
    expect(await previewParqetAction(null, form({ depotId: id, file: csvFile("﻿") }))).toEqual({
      ok: false,
      reason: "empty-file",
    });
    const noAmount = FIXTURE.replace(";amount;", ";betrag;");
    expect(await previewParqetAction(null, form({ depotId: id, file: csvFile(noAmount) }))).toEqual({
      ok: false,
      reason: "missing-columns",
      columns: ["amount"],
    });
  });

  it("returns unauthorized without a session", async () => {
    const id = await depotId();
    fakes.current.state.incoming.clear();
    expect(await previewParqetAction(null, form({ depotId: id, file: csvFile(FIXTURE) }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });
});
