import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minimalPdf } from "../../../test/helpers/pdf";
import { createRequestFakes, expectRedirect, RedirectError } from "../../../test/helpers/next-mocks";
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
vi.mock("next/navigation", async () => {
  const { RedirectError: Redirect } = await import("../../../test/helpers/next-mocks");
  return {
    redirect: (url: string) => {
      throw new Redirect(url);
    },
  };
});

import { prisma } from "@/db";
import { countOpenBatches, getImportBatch, UNRECOGNIZED_REASON } from "@/modules/import";
import { archiveDepot, createDepot } from "@/modules/ledger";
import { discardImportBatchAction, uploadDocumentsAction } from "./import";

const SECRET = "test-secret-with-at-least-32-characters";
const HASH = "$2b$04$Raf6EM460q2HE2THwTzIR.5Uk58FNzZG7FhlOvTFD.sbuFp.We4pO";
const savedEnv = { ...process.env };
let dataDir: string;
let depotId: string;

beforeEach(async () => {
  fakes.current = createRequestFakes();
  dataDir = mkdtempSync(join(tmpdir(), "depot-import-action-"));
  process.env.AUTH_USERNAME = "tester";
  process.env.AUTH_PASSWORD_HASH = HASH;
  process.env.SESSION_SECRET = SECRET;
  process.env.DATA_DIR = dataDir;
  fakes.current.state.incoming.set(SESSION_COOKIE, await createSessionToken("tester", SECRET));
  revalidatePath.mockClear();
  await prisma.importBatch.deleteMany();
  await prisma.depot.deleteMany();
  const depot = await createDepot({ name: "ROBIN", broker: "DEUTSCHE_BANK" });
  if (!depot.ok) throw new Error("setup failed");
  depotId = depot.depot.id;
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(dataDir, { recursive: true, force: true });
});

afterAll(async () => {
  await prisma.$disconnect();
  dbFile.removeFiles();
});

const pdfFile = (name: string, text = name) => new File([minimalPdf(text)], name, { type: "application/pdf" });

function form(depot: string | null, files: File[]) {
  const data = new FormData();
  if (depot !== null) data.set("depotId", depot);
  for (const file of files) data.append("files", file);
  return data;
}

const imports = () => {
  try {
    return readdirSync(join(dataDir, "imports"));
  } catch {
    return [];
  }
};

describe("uploadDocumentsAction", () => {
  it("stages the PDFs as one batch, revalidates and redirects to the batch view", async () => {
    const url = await expectRedirect(() => uploadDocumentsAction(null, form(depotId, [pdfFile("a.pdf"), pdfFile("b.pdf")])));
    const batch = await prisma.importBatch.findFirstOrThrow();
    expect(url).toBe(`/import/${batch.id}`);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    const view = await getImportBatch(batch.id);
    expect(view?.items.map((item) => [item.fileName, item.status, item.reason])).toEqual([
      ["a.pdf", "FAILED", UNRECOGNIZED_REASON],
      ["b.pdf", "FAILED", UNRECOGNIZED_REASON],
    ]);
    expect(await countOpenBatches()).toBe(1);
    expect(imports()).toEqual([batch.id]);
    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.security.count()).toBe(0);
  });

  it.each([
    ["no files", () => form(depotId, []), "files-missing"],
    ["only an empty file input", () => form(depotId, [new File([], "")]), "files-missing"],
    ["too many files", () => form(depotId, Array.from({ length: 51 }, (_, i) => pdfFile(`${i}.pdf`))), "too-many-files"],
    [
      "more than 20 MB",
      () => form(depotId, Array.from({ length: 5 }, (_, i) => new File([new Uint8Array(4.5 * 1024 * 1024)], `${i}.pdf`))),
      "upload-too-large",
    ],
    ["an unknown Depot", () => form("nope", [pdfFile("a.pdf")]), "depot-not-found"],
    ["no Depot", () => form(null, [pdfFile("a.pdf")]), "depot-not-found"],
  ])("returns a typed failure for %s without writing", async (_label, data, reason) => {
    expect(await uploadDocumentsAction(null, data())).toEqual({ ok: false, reason });
    expect(await prisma.importBatch.count()).toBe(0);
    expect(imports()).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an archived Depot", async () => {
    expect((await archiveDepot(depotId)).ok).toBe(true);
    expect(await uploadDocumentsAction(null, form(depotId, [pdfFile("a.pdf")]))).toEqual({ ok: false, reason: "depot-archived" });
    expect(await prisma.importBatch.count()).toBe(0);
  });

  it("writes nothing without a session", async () => {
    fakes.current.state.incoming.clear();
    expect(await uploadDocumentsAction(null, form(depotId, [pdfFile("a.pdf")]))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await prisma.importBatch.count()).toBe(0);
    expect(imports()).toEqual([]);
  });
});

describe("discardImportBatchAction", () => {
  async function staged(): Promise<string> {
    try {
      await uploadDocumentsAction(null, form(depotId, [pdfFile("a.pdf")]));
    } catch (error) {
      if (!(error instanceof RedirectError)) throw error;
    }
    revalidatePath.mockClear();
    return (await prisma.importBatch.findFirstOrThrow()).id;
  }

  const discardForm = (batchId?: string) => {
    const data = new FormData();
    if (batchId !== undefined) data.set("batchId", batchId);
    return data;
  };

  it("deletes the batch and its PDFs, revalidates and redirects to /import", async () => {
    const batchId = await staged();
    expect(existsSync(join(dataDir, "imports", batchId))).toBe(true);
    expect(await expectRedirect(() => discardImportBatchAction(null, discardForm(batchId)))).toBe("/import");
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    expect(await countOpenBatches()).toBe(0);
    expect(existsSync(join(dataDir, "imports", batchId))).toBe(false);
  });

  it("returns not-found for an unknown or missing id", async () => {
    expect(await discardImportBatchAction(null, discardForm("nope"))).toEqual({ ok: false, reason: "not-found" });
    expect(await discardImportBatchAction(null, discardForm())).toEqual({ ok: false, reason: "not-found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps the batch without a session", async () => {
    const batchId = await staged();
    fakes.current.state.incoming.clear();
    expect(await discardImportBatchAction(null, discardForm(batchId))).toEqual({ ok: false, reason: "unauthorized" });
    expect(await countOpenBatches()).toBe(1);
  });
});
