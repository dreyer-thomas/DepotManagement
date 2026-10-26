import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minimalPdf } from "../../../test/helpers/pdf";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import { archiveDepot, createDepot } from "@/modules/ledger";
import {
  countOpenBatches,
  createImportBatch,
  discardImportBatch,
  discardImportBatchesOfDepot,
  EXTRACTION_FAILED_REASON,
  getImportBatch,
  type ImportDeps,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_FILES,
  listOpenBatches,
  NOT_A_PDF_REASON,
  type Parser,
  type ParserRegistry,
  TOO_LARGE_REASON,
  UNRECOGNIZED_REASON,
  type UploadedFile,
} from "./index";
import { STORED_PROPOSALS_INVALID_REASON } from "./batches";

let testDb: TestDatabase;
let dataDir: string;

beforeEach(() => {
  testDb = createTestDatabase();
  dataDir = mkdtempSync(join(tmpdir(), "depot-import-"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  vi.restoreAllMocks();
  await testDb.cleanup();
  rmSync(dataDir, { recursive: true, force: true });
});

const db = () => testDb.client;
const NOW = new Date("2026-10-26T10:00:00.000Z");
const BUY = { type: "BUY", date: "2026-10-08", isin: "DE0007164600", quantity: "2", price: "10.5", amount: "21", fee: "1.5" } as const;

/** Stub parser: claims documents containing "Kauf". */
const stub: Parser = (text) => (text.includes("Kauf") ? [BUY] : { error: "unrecognized" });
const STUB_REGISTRY: ParserRegistry = { COMDIRECT: [], DEUTSCHE_BANK: [{ documentType: "trade", parse: stub }], FINANZEN_ZERO: [] };

function deps(overrides: Partial<ImportDeps> = {}): ImportDeps {
  // The text is the PDF bytes decoded, so tests choose it without running pdf.js.
  return { env: { DATA_DIR: dataDir }, now: () => NOW, extract: async (bytes) => new TextDecoder().decode(bytes), ...overrides };
}

const pdf = (name: string, text = "Dokument"): UploadedFile => ({ name, bytes: new TextEncoder().encode(`%PDF-1.4 ${text}`) });

async function depot(broker: "DEUTSCHE_BANK" | "COMDIRECT" = "DEUTSCHE_BANK", name = "ROBIN") {
  const result = await createDepot({ name, broker }, db());
  if (!result.ok) throw new Error("setup failed");
  return result.depot;
}

async function create(depotId: string, files: UploadedFile[], overrides: Partial<ImportDeps> = {}) {
  const result = await createImportBatch(depotId, files, deps(overrides), db());
  if (!result.ok) throw new Error(`create failed: ${result.reason}`);
  return result.batchId;
}

const batchFiles = (batchId: string) => {
  try {
    return readdirSync(join(dataDir, "imports", batchId)).sort();
  } catch {
    return [];
  }
};

async function ledgerCounts() {
  const client = db();
  return {
    transactions: await client.transaction.count(),
    securities: await client.security.count(),
    prices: await client.price.count(),
    logos: await client.securityLogo.count(),
  };
}

describe("createImportBatch", () => {
  it("stages one OPEN batch with one item per file in upload order", async () => {
    const { id } = await depot();
    const batchId = await create(id, [pdf("a.pdf"), pdf("b.pdf", "x"), pdf("c.pdf", "y")]);
    const batch = await getImportBatch(batchId, db());
    expect(batch).toMatchObject({ depotId: id, depotName: "ROBIN", broker: "DEUTSCHE_BANK", status: "OPEN", createdAt: NOW.toISOString() });
    expect(batch?.items.map((item) => [item.position, item.fileName, item.status, item.reason])).toEqual([
      [0, "a.pdf", "FAILED", UNRECOGNIZED_REASON],
      [1, "b.pdf", "FAILED", UNRECOGNIZED_REASON],
      [2, "c.pdf", "FAILED", UNRECOGNIZED_REASON],
    ]);
    expect(await countOpenBatches(db())).toBe(1);
  });

  it("stores the PDFs as <itemId>.pdf under DATA_DIR/imports/<batchId>", async () => {
    const { id } = await depot();
    const file = pdf("a.pdf");
    const batchId = await create(id, [file]);
    const item = await db().importItem.findFirstOrThrow({ where: { batchId } });
    expect(item.storedFile).toBe(`${item.id}.pdf`);
    expect(batchFiles(batchId)).toEqual([`${item.id}.pdf`]);
    expect(new Uint8Array(readFileSync(join(dataDir, "imports", batchId, `${item.id}.pdf`)))).toEqual(file.bytes);
    expect(item.fileHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stores the stub parser's proposals and document type for a recognised document", async () => {
    const { id } = await depot();
    const batchId = await create(id, [pdf("kauf.pdf", "Kauf"), pdf("auszug.pdf")], { registry: STUB_REGISTRY });
    const batch = await getImportBatch(batchId, db());
    expect(batch?.items[0]).toMatchObject({
      status: "PARSED",
      documentType: "trade",
      reason: null,
      proposals: [{ ...BUY, tax: "0" }],
    });
    expect(batch?.items[1]).toMatchObject({ status: "FAILED", documentType: null, reason: UNRECOGNIZED_REASON, proposals: [] });
  });

  it("parses with the Depot's Broker", async () => {
    const { id } = await depot("COMDIRECT", "comdirect");
    const batchId = await create(id, [pdf("kauf.pdf", "Kauf")], { registry: STUB_REGISTRY });
    expect((await getImportBatch(batchId, db()))?.items[0]?.status).toBe("FAILED");
  });

  it("flags a re-upload of the same bytes (earlier batch or same upload) without blocking", async () => {
    const { id } = await depot();
    const first = await create(id, [pdf("a.pdf", "same")]);
    const second = await create(id, [pdf("renamed.pdf", "same"), pdf("b.pdf", "other"), pdf("b-copy.pdf", "other")]);
    expect((await getImportBatch(first, db()))?.items.map((item) => item.duplicateUpload)).toEqual([false]);
    expect((await getImportBatch(second, db()))?.items.map((item) => item.duplicateUpload)).toEqual([true, false, true]);
    expect(await countOpenBatches(db())).toBe(2);
  });

  it("fails a non-PDF and an oversized file without affecting the others and keeps neither on disk", async () => {
    const { id } = await depot();
    const text = { name: "notiz.pdf", bytes: new TextEncoder().encode("Kauf 10 Stück") };
    const big = { name: "gross.pdf", bytes: new Uint8Array(IMPORT_MAX_FILE_BYTES + 1) };
    big.bytes.set(new TextEncoder().encode("%PDF-1.4"));
    const batchId = await create(id, [text, big, pdf("ok.pdf", "Kauf")], { registry: STUB_REGISTRY });
    const items = (await getImportBatch(batchId, db()))?.items ?? [];
    expect(items.map((item) => [item.status, item.reason])).toEqual([
      ["FAILED", NOT_A_PDF_REASON],
      ["FAILED", TOO_LARGE_REASON],
      ["PARSED", null],
    ]);
    expect(TOO_LARGE_REASON).toBe("Datei zu groß (max. 5 MB).");
    expect(NOT_A_PDF_REASON).toBe("Keine PDF-Datei.");
    const rows = await db().importItem.findMany({ where: { batchId }, orderBy: { position: "asc" } });
    expect(rows.map((row) => row.storedFile === null)).toEqual([true, true, false]);
    expect(batchFiles(batchId)).toHaveLength(1);
  });

  it("fails a PDF whose text cannot be extracted", async () => {
    const { id } = await depot();
    const extract = async () => {
      throw new Error("broken");
    };
    const batchId = await create(id, [pdf("a.pdf")], { extract });
    expect((await getImportBatch(batchId, db()))?.items[0]).toMatchObject({ status: "FAILED", reason: EXTRACTION_FAILED_REASON });
    expect(EXTRACTION_FAILED_REASON).toBe("Text konnte nicht gelesen werden.");
  });

  it("extracts real PDF text with unpdf by default", async () => {
    const { id } = await depot();
    const result = await createImportBatch(
      id,
      [{ name: "kauf.pdf", bytes: minimalPdf("Wertpapierabrechnung Kauf") }],
      { env: { DATA_DIR: dataDir }, now: () => NOW, registry: STUB_REGISTRY },
      db(),
    );
    if (!result.ok) throw new Error("create failed");
    expect((await getImportBatch(result.batchId, db()))?.items[0]?.status).toBe("PARSED");
  });

  it.each([
    ["no files", () => [], "files-missing"],
    ["too many files", () => Array.from({ length: IMPORT_MAX_FILES + 1 }, (_, i) => pdf(`${i}.pdf`)), "too-many-files"],
    [
      "more than 20 MB in total",
      () => Array.from({ length: 5 }, (_, i) => ({ name: `${i}.pdf`, bytes: new Uint8Array(4.5 * 1024 * 1024) })),
      "upload-too-large",
    ],
  ])("rejects an upload with %s and writes nothing", async (_label, files, reason) => {
    const { id } = await depot();
    expect(await createImportBatch(id, files(), deps(), db())).toEqual({ ok: false, reason });
    expect(await db().importBatch.count()).toBe(0);
    expect(existsSync(join(dataDir, "imports"))).toBe(false);
  });

  it("rejects an unknown or archived Depot and writes nothing", async () => {
    expect(await createImportBatch("nope", [pdf("a.pdf")], deps(), db())).toEqual({ ok: false, reason: "depot-not-found" });
    expect(await createImportBatch("", [pdf("a.pdf")], deps(), db())).toEqual({ ok: false, reason: "depot-not-found" });
    const { id } = await depot();
    expect((await archiveDepot(id, db())).ok).toBe(true);
    expect(await createImportBatch(id, [pdf("a.pdf")], deps(), db())).toEqual({ ok: false, reason: "depot-archived" });
    expect(await db().importBatch.count()).toBe(0);
    expect(existsSync(join(dataDir, "imports"))).toBe(false);
  });

  it("writes no Transaction, Security, Price or logo rows", async () => {
    const { id } = await depot();
    const before = await ledgerCounts();
    await create(id, [pdf("kauf.pdf", "Kauf")], { registry: STUB_REGISTRY });
    expect(await ledgerCounts()).toEqual(before);
    expect(before).toEqual({ transactions: 0, securities: 0, prices: 0, logos: 0 });
  });

  it("rolls back and removes the written files when a later write fails", async () => {
    const { id } = await depot();
    let updates = 0;
    const failing = (tx: Parameters<Parameters<TestDatabase["client"]["$transaction"]>[0]>[0]) =>
      new Proxy(tx, {
        get(target, property, receiver) {
          // Behave like a plain transaction client so the service writes through this proxy.
          if (property === "$transaction") return undefined;
          if (property !== "importItem") return Reflect.get(target, property, receiver);
          const items = target.importItem;
          return new Proxy(items, {
            get(itemTarget, itemProperty, itemReceiver) {
              if (itemProperty !== "update") return Reflect.get(itemTarget, itemProperty, itemReceiver);
              return (args: Parameters<typeof items.update>[0]) => {
                updates++;
                if (updates === 2) throw new Error("disk full");
                return items.update(args);
              };
            },
          });
        },
      });
    await expect(
      db().$transaction((tx) => createImportBatch(id, [pdf("a.pdf", "a"), pdf("b.pdf", "b")], deps(), failing(tx))),
    ).rejects.toThrow("disk full");
    expect(updates).toBe(2);
    expect(await db().importBatch.count()).toBe(0);
    expect(await db().importItem.count()).toBe(0);
    expect(readdirSync(join(dataDir, "imports"))).toEqual([]);
  });

  it("truncates long file names by code points", async () => {
    const { id } = await depot();
    const batchId = await create(id, [pdf(`${"a".repeat(254)}😀😀.pdf`)]);
    const name = (await getImportBatch(batchId, db()))?.items[0]?.fileName ?? "";
    expect(Array.from(name)).toHaveLength(255);
    expect(name.endsWith("😀")).toBe(true);
  });

  it("strips path components from file names", async () => {
    const { id } = await depot();
    const batchId = await create(id, [pdf("../../etc/a.pdf"), pdf("C:\\docs\\b.pdf"), pdf("")]);
    expect((await getImportBatch(batchId, db()))?.items.map((item) => item.fileName)).toEqual(["a.pdf", "b.pdf", "Datei 3"]);
  });
});

describe("getImportBatch", () => {
  it("returns null for an unknown id", async () => {
    expect(await getImportBatch("nope", db())).toBeNull();
    expect(await getImportBatch("", db())).toBeNull();
  });

  it("shows an item whose stored proposals no longer validate as failed", async () => {
    const { id } = await depot();
    const batchId = await create(id, [pdf("kauf.pdf", "Kauf")], { registry: STUB_REGISTRY });
    await db().importItem.updateMany({ where: { batchId }, data: { proposals: '[{"type":"BUY"}]' } });
    expect((await getImportBatch(batchId, db()))?.items[0]).toMatchObject({
      status: "FAILED",
      reason: STORED_PROPOSALS_INVALID_REASON,
      proposals: [],
    });
  });

  it("shows a PARSED item with an empty stored proposal list as failed", async () => {
    const { id } = await depot();
    const batchId = await create(id, [pdf("kauf.pdf", "Kauf")], { registry: STUB_REGISTRY });
    await db().importItem.updateMany({ where: { batchId }, data: { proposals: "[]" } });
    expect((await getImportBatch(batchId, db()))?.items[0]).toMatchObject({
      status: "FAILED",
      reason: STORED_PROPOSALS_INVALID_REASON,
      proposals: [],
    });
  });
});

describe("listOpenBatches", () => {
  it("lists open batches newest first with Depot and counts", async () => {
    const { id } = await depot();
    const older = await create(id, [pdf("kauf.pdf", "Kauf"), pdf("x.pdf")], { registry: STUB_REGISTRY });
    const newer = await create(id, [pdf("y.pdf")], { now: () => new Date("2026-10-27T08:00:00.000Z") });
    expect(await listOpenBatches(db())).toEqual([
      { id: newer, depotId: id, depotName: "ROBIN", broker: "DEUTSCHE_BANK", createdAt: "2026-10-27T08:00:00.000Z", fileCount: 1, parsedCount: 0, failedCount: 1 },
      { id: older, depotId: id, depotName: "ROBIN", broker: "DEUTSCHE_BANK", createdAt: NOW.toISOString(), fileCount: 2, parsedCount: 1, failedCount: 1 },
    ]);
  });

  it("leaves out booked batches", async () => {
    const { id } = await depot();
    const batchId = await create(id, [pdf("a.pdf")]);
    await db().importBatch.update({ where: { id: batchId }, data: { status: "BOOKED" } });
    expect(await listOpenBatches(db())).toEqual([]);
    expect(await countOpenBatches(db())).toBe(0);
  });
});

describe("discardImportBatch", () => {
  it("deletes the batch rows and its PDF directory", async () => {
    const { id } = await depot();
    const batchId = await create(id, [pdf("a.pdf"), pdf("b.pdf", "b")]);
    const other = await create(id, [pdf("c.pdf", "c")]);
    expect(batchFiles(batchId)).toHaveLength(2);
    expect(await discardImportBatch(batchId, { env: { DATA_DIR: dataDir } }, db())).toEqual({ ok: true });
    expect(await getImportBatch(batchId, db())).toBeNull();
    expect(await db().importItem.count({ where: { batchId } })).toBe(0);
    expect(existsSync(join(dataDir, "imports", batchId))).toBe(false);
    expect(batchFiles(other)).toHaveLength(1);
    expect(await countOpenBatches(db())).toBe(1);
  });

  it("returns not-found for an unknown id", async () => {
    expect(await discardImportBatch("nope", { env: { DATA_DIR: dataDir } }, db())).toEqual({ ok: false, reason: "not-found" });
    expect(await discardImportBatch("", { env: { DATA_DIR: dataDir } }, db())).toEqual({ ok: false, reason: "not-found" });
    expect(await discardImportBatch("../..", { env: { DATA_DIR: dataDir } }, db())).toEqual({ ok: false, reason: "not-found" });
    expect(existsSync(dataDir)).toBe(true);
  });
});

describe("discardImportBatchesOfDepot", () => {
  it("removes every batch of the Depot with its files and leaves other Depots alone", async () => {
    const robin = await depot();
    const other = await depot("COMDIRECT", "comdirect");
    const a = await create(robin.id, [pdf("a.pdf")]);
    const b = await create(robin.id, [pdf("b.pdf", "b")]);
    const c = await create(other.id, [pdf("c.pdf", "c")]);
    expect(await discardImportBatchesOfDepot(robin.id, { env: { DATA_DIR: dataDir } }, db())).toBe(2);
    expect(batchFiles(a)).toEqual([]);
    expect(batchFiles(b)).toEqual([]);
    expect(batchFiles(c)).toHaveLength(1);
    expect(await db().importBatch.count()).toBe(1);
  });
});
