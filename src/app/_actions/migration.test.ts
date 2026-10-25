import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { archiveDepot, createDepot, listTransactions, recordTransaction } from "@/modules/ledger";
import type { MigrationDecisions } from "@/modules/migration";
import { confirmParqetAction, openingBalanceAction, previewParqetAction } from "./migration";

const FIXTURE = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export.csv.txt"), "utf8");
const NO_CASH = readFileSync(resolve(__dirname, "../../../test/fixtures/parqet/synthetic-export-no-cash.csv.txt"), "utf8");

const DECIDED: MigrationDecisions = {
  classifications: { DE0007164600: "STOCK", DE000SYN0013: "ETF", US0378331005: "FUND" },
  flags: Object.fromEntries(["2", "3", "4-5", "7", "8"].map((key) => [key, { action: "skip" as const }])),
  duplicates: {},
};
const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };

beforeEach(async () => {
  fakes.current = createRequestFakes();
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  await prisma.corporateAction.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.security.deleteMany();
  await prisma.depot.deleteMany();
  revalidatePath.mockClear();
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

function form(fields: Record<string, File | string | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) data.set(key, value);
  return data;
}

const csvFile = (text: string, name = "Depot-20241001-120000.csv") => new File([text], name, { type: "text/csv" });

describe("previewParqetAction", () => {
  it("returns the preview for the uploaded file and writes nothing", async () => {
    const id = await depotId();
    const result = await previewParqetAction(null, form({ depotId: id, file: csvFile(FIXTURE) }));
    if (!result?.ok) throw new Error(JSON.stringify(result));
    expect(result.preview.depot.name).toBe("Hauptdepot");
    expect(result.preview.exportDate).toBe("2024-07-03");
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

describe("confirmParqetAction", () => {
  it("books the file with the decisions and revalidates", async () => {
    const id = await depotId();
    const result = await confirmParqetAction(form({ depotId: id, file: csvFile(FIXTURE), decisions: JSON.stringify(DECIDED) }));
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.summary.booked).toEqual({ transactions: 10, splits: 0, isinChanges: 1, securities: 5 });
    const rows = await listTransactions(id);
    expect(rows).toHaveLength(10);
    expect(rows.find((row) => row.security?.isin === "US0378331005")?.security?.assetType).toBe("FUND");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("returns decisions-open with the fresh preview, without revalidating", async () => {
    const id = await depotId();
    expect((await recordTransaction({ depotId: id, type: "DEPOSIT", date: "2024-01-02", amount: "10000" })).ok).toBe(true);
    const result = await confirmParqetAction(form({ depotId: id, file: csvFile(FIXTURE), decisions: JSON.stringify(DECIDED) }));
    expect(result).toMatchObject({ ok: false, reason: "decisions-open", open: [{ kind: "duplicate", key: "24" }] });
    expect(await prisma.transaction.count()).toBe(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["not JSON", "{"],
    ["not decisions", JSON.stringify({ classifications: { X: "BOND" }, flags: {}, duplicates: {} })],
  ])("returns decisions-invalid when the decisions are %s", async (_label, decisions) => {
    const id = await depotId();
    expect(await confirmParqetAction(form({ depotId: id, file: csvFile(FIXTURE), decisions }))).toEqual({
      ok: false,
      reason: "decisions-invalid",
    });
  });

  it("applies the preview's file checks and the session check", async () => {
    const id = await depotId();
    const decisions = JSON.stringify(DECIDED);
    expect(await confirmParqetAction(form({ depotId: id, decisions }))).toEqual({ ok: false, reason: "file-missing" });
    expect(await confirmParqetAction(form({ depotId: id, file: csvFile("x".repeat(5 * 1024 * 1024 + 1)), decisions }))).toEqual({
      ok: false,
      reason: "file-too-large",
    });
    expect(await confirmParqetAction(form({ file: csvFile(FIXTURE), decisions }))).toEqual({ ok: false, reason: "depot-not-found" });
    expect((await archiveDepot(id)).ok).toBe(true);
    expect(await confirmParqetAction(form({ depotId: id, file: csvFile(FIXTURE), decisions }))).toEqual({
      ok: false,
      reason: "depot-archived",
    });
    fakes.current.state.incoming.clear();
    expect(await confirmParqetAction(form({ depotId: id, file: csvFile(FIXTURE), decisions }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });
});

describe("openingBalanceAction", () => {
  it("books the difference to the entered German balance and revalidates", async () => {
    const id = await depotId();
    const decisions = JSON.stringify({ classifications: { IE00B4L5Y983: "ETF" }, flags: {}, duplicates: {} });
    expect((await confirmParqetAction(form({ depotId: id, file: csvFile(NO_CASH), decisions }))).ok).toBe(true);
    revalidatePath.mockClear();

    // Funded buy: the ledger holds the 300 from the sale at the export date.
    const result = await openingBalanceAction(form({ depotId: id, date: "2024-05-02", asOf: "2024-05-02", balance: "1.300,00" }));
    expect(result).toMatchObject({ ok: true, transaction: { type: "DEPOSIT", date: "2024-05-02", amount: "1000" }, balance: "1300" });
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");

    revalidatePath.mockClear();
    expect(await openingBalanceAction(form({ depotId: id, date: "2024-05-02", asOf: "2024-05-02", balance: "1300" }))).toEqual({
      ok: true,
      transaction: null,
      balance: "1300",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an unparseable balance and a missing session", async () => {
    const id = await depotId();
    expect(await openingBalanceAction(form({ depotId: id, date: "2024-02-01", asOf: "2024-05-02", balance: "abc" }))).toEqual({
      ok: false,
      reason: "balance-invalid",
    });
    expect(await openingBalanceAction(form({ depotId: id, date: "2024-02-01", asOf: "2024-05-02" }))).toEqual({
      ok: false,
      reason: "balance-invalid",
    });
    fakes.current.state.incoming.clear();
    expect(await openingBalanceAction(form({ depotId: id, date: "2024-02-01", asOf: "2024-05-02", balance: "1" }))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });
});
