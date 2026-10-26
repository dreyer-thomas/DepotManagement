import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { minimalPdf } from "../../../test/helpers/pdf";
import { createTestDatabase, type TestDatabase } from "../../../test/helpers/test-db";
import {
  archiveDepot,
  createDepot,
  ensureSecurity,
  listIsinChanges,
  listPositions,
  listTransactions,
  recordIsinChange,
  recordTransaction,
} from "@/modules/ledger";
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
  bookImportBatch,
  decideProposal,
  firstDocumentDate,
  type TransactionProposalInput,
  updateProposal,
} from "./index";
import { type ProposalEdit, STORED_PROPOSALS_INVALID_REASON } from "./batches";

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

async function depot(broker: "DEUTSCHE_BANK" | "COMDIRECT" | "FINANZEN_ZERO" = "DEUTSCHE_BANK", name = "ROBIN") {
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
      proposals: [{ proposal: { ...BUY, tax: "0" }, status: "unique", decision: null, effective: "book" }],
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

// ---- Review and booking (story 5.3) ----

/** Parser for review tests: a document `P:<json>` proposes exactly the JSON proposals. */
const jsonParser: Parser = (text) => {
  const at = text.indexOf("P:");
  return at < 0 ? { error: "unrecognized" } : (JSON.parse(text.slice(at + 2)) as TransactionProposalInput[]);
};
const JSON_REGISTRY: ParserRegistry = { COMDIRECT: [], DEUTSCHE_BANK: [{ documentType: "trade", parse: jsonParser }], FINANZEN_ZERO: [] };
const doc = (name: string, ...proposals: TransactionProposalInput[]) => pdf(name, `P:${JSON.stringify(proposals)}`);

const ETF = "IE00BK5BQT80";
const SAP = "DE0007164600";
const SUCCESSOR = "DE000SYN0013";
const PLAN: TransactionProposalInput = { type: "BUY", date: "2026-10-15", isin: ETF, name: "iShares Core MSCI World UCITS ETF", quantity: "3.412871", price: "43.95", amount: "150" };
const SAP_BUY: TransactionProposalInput = { type: "BUY", date: "2026-10-08", isin: SAP, name: "SAP SE", quantity: "2", price: "10.5", amount: "21", fee: "1.5" };
const DIVIDEND: TransactionProposalInput = { type: "DIVIDEND", date: "2026-10-01", isin: SAP, name: "SAP SE", amount: "84.12", tax: "15.51" };
const ACCOUNT_FEE: TransactionProposalInput = { type: "FEE", date: "2026-10-20", amount: "0", fee: "4.9" };
const WITHHOLDING: TransactionProposalInput = { type: "TAX", date: "2026-10-21", amount: "0", tax: "1.5" };

const env = () => ({ env: { DATA_DIR: dataDir } });
const review = async (batchId: string) => {
  const batch = await getImportBatch(batchId, db());
  if (!batch) throw new Error("batch missing");
  return batch;
};
const stage = (depotId: string, files: UploadedFile[]) => create(depotId, files, { registry: JSON_REGISTRY });
const book = async (batchId: string) => bookImportBatch(batchId, (await review(batchId)).bookKeys, env(), db());

describe("getImportBatch review", () => {
  it("classifies a fresh batch as erkannt and books every proposal by default", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("a.pdf", SAP_BUY), doc("b.pdf", DIVIDEND), doc("c.pdf", PLAN)]);
    const batch = await review(batchId);
    expect(batch.items.map((item) => item.reviewStatus)).toEqual(["PARSED", "PARSED", "PARSED"]);
    expect(batch).toMatchObject({ depotArchived: false, openDecisions: 0, files: { PARSED: 3, AMBIGUOUS: 0, DUPLICATE: 0, FAILED: 0 } });
    expect(batch.bookKeys).toEqual(batch.items.map((item) => `${item.id}:0`));
    expect(batch.items[0]?.proposals[0]).toMatchObject({ securityId: null, securityName: "SAP SE", ledgerMatches: [], siblingMatch: false });
  });

  it("marks two identical buys of the batch ambiguous on an empty ledger until both are decided", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("plan-1.pdf", PLAN), doc("plan-2.pdf", PLAN)]);
    let batch = await review(batchId);
    expect(batch.items.map((item) => [item.reviewStatus, item.proposals[0]?.status, item.proposals[0]?.siblingMatch])).toEqual([
      ["AMBIGUOUS", "ambiguous", true],
      ["AMBIGUOUS", "ambiguous", true],
    ]);
    expect(batch.openDecisions).toBe(2);
    expect(batch.bookKeys).toEqual([]);
    expect(await bookImportBatch(batchId, [], env(), db())).toEqual({ ok: false, reason: "decisions-open" });
    for (const item of batch.items) expect(await decideProposal(batchId, item.id, 0, "book", db())).toEqual({ ok: true });
    batch = await review(batchId);
    expect(batch.openDecisions).toBe(0);
    expect(batch.items.map((item) => item.proposals[0]?.effective)).toEqual(["book", "book"]);
    expect(await book(batchId)).toEqual({ ok: true, booked: 2, depotId: id });
    expect(await db().transaction.count()).toBe(2);
  });

  it("lists both ledger matches of an ambiguous proposal", async () => {
    const { id } = await depot();
    const security = await ensureSecurity({ isin: ETF }, { name: "Gespeichert", assetType: "ETF" }, db());
    if (!security.ok) throw new Error("setup failed");
    for (let i = 0; i < 2; i++) {
      const recorded = await recordTransaction(
        { depotId: id, type: "BUY", date: "2026-10-15", quantity: "3.412871", price: "43.95", amount: "150", security: { id: security.security.id }, allowDuplicate: true },
        db(),
      );
      expect(recorded.ok).toBe(true);
    }
    const batchId = await stage(id, [doc("plan.pdf", PLAN)]);
    const proposal = (await review(batchId)).items[0]?.proposals[0];
    expect(proposal).toMatchObject({ status: "ambiguous", siblingMatch: false, securityId: security.security.id, securityName: "Gespeichert" });
    expect(proposal?.ledgerMatches.map((match) => [match.type, match.date, match.quantity, match.amount])).toEqual([
      ["BUY", "2026-10-15", "3.412871", "150"],
      ["BUY", "2026-10-15", "3.412871", "150"],
    ]);
  });

  it("treats a proposal of an old ISIN matching a row of its successor as duplicate", async () => {
    const { id } = await depot();
    const old = await ensureSecurity({ isin: SAP }, { name: "Alt", assetType: "STOCK" }, db());
    const successor = await ensureSecurity({ isin: SUCCESSOR }, { name: "Neu", assetType: "STOCK" }, db());
    if (!old.ok || !successor.ok) throw new Error("setup failed");
    const change = await recordIsinChange(
      { oldSecurityId: old.security.id, newSecurity: { id: successor.security.id }, date: "2026-01-01", oldQuantity: "1", newQuantity: "1" },
      db(),
    );
    expect(change.ok).toBe(true);
    const recorded = await recordTransaction(
      { depotId: id, type: "BUY", date: "2026-10-08", quantity: "2", price: "10.5", fee: "1.5", security: { id: successor.security.id } },
      db(),
    );
    expect(recorded.ok).toBe(true);
    const batchId = await stage(id, [doc("kauf.pdf", SAP_BUY)]);
    const batch = await review(batchId);
    expect(batch.items[0]).toMatchObject({ reviewStatus: "DUPLICATE", proposals: [{ status: "duplicate", effective: "discard" }] });
    expect(batch.bookKeys).toEqual([]);
  });

  it("stores the first readable date of a parser-failed file", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [pdf("konto.pdf", "Kontoauszug 31.02.2026 vom 15.10.2026 bis 31.10.2026"), pdf("leer.pdf", "nichts")]);
    expect((await review(batchId)).items.map((item) => [item.reviewStatus, item.documentDate])).toEqual([
      ["FAILED", "2026-10-15"],
      ["FAILED", null],
    ]);
    expect(firstDocumentDate("am 01.13.2026 und 02.01.2026")).toBe("2026-01-02");
    expect(firstDocumentDate("Nr. 123.12.20245 vom 03.01.2026")).toBe("2026-01-03");
    expect(firstDocumentDate("Nr. 123.12.20245")).toBeNull();
  });
});

describe("decideProposal / updateProposal", () => {
  it("discards a unique row so it is not booked, and undoes it with null", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("a.pdf", SAP_BUY, DIVIDEND)]);
    const itemId = (await review(batchId)).items[0]!.id;
    expect(await decideProposal(batchId, itemId, 1, "discard", db())).toEqual({ ok: true });
    expect((await review(batchId)).bookKeys).toEqual([`${itemId}:0`]);
    expect(await decideProposal(batchId, itemId, 1, null, db())).toEqual({ ok: true });
    expect((await review(batchId)).bookKeys).toEqual([`${itemId}:0`, `${itemId}:1`]);
  });

  it("refuses unknown batches, items and indexes", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("a.pdf", SAP_BUY), pdf("x.pdf")]);
    const [parsed, failed] = (await review(batchId)).items;
    expect(await decideProposal("nope", parsed!.id, 0, "book", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await decideProposal(batchId, "nope", 0, "book", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await decideProposal(batchId, parsed!.id, 1, "book", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await decideProposal(batchId, parsed!.id, -1, "book", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await decideProposal(batchId, failed!.id, 0, "book", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await updateProposal(batchId, parsed!.id, 3, { amount: "1" }, db())).toEqual({ ok: false, reason: "not-found" });
  });

  it("stores a valid edit and reclassifies on the next read", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("a.pdf", PLAN), doc("b.pdf", PLAN)]);
    const items = (await review(batchId)).items;
    expect(items.map((item) => item.reviewStatus)).toEqual(["AMBIGUOUS", "AMBIGUOUS"]);
    const result = await updateProposal(batchId, items[0]!.id, 0, { amount: "1234.56", fee: "" }, db());
    expect(result).toMatchObject({ ok: true, proposal: { amount: "1234.56", fee: "0", isin: ETF, type: "BUY" } });
    const row = await db().importItem.findUniqueOrThrow({ where: { id: items[0]!.id } });
    expect(JSON.parse(row.proposals)[0].amount).toBe("1234.56");
    expect((await review(batchId)).items.map((item) => item.reviewStatus)).toEqual(["PARSED", "PARSED"]);
  });

  it("rejects an invalid edit with its field and stores nothing", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("a.pdf", SAP_BUY, DIVIDEND)]);
    const itemId = (await review(batchId)).items[0]!.id;
    const before = (await db().importItem.findUniqueOrThrow({ where: { id: itemId } })).proposals;
    expect(await updateProposal(batchId, itemId, 0, { quantity: "0" }, db())).toEqual({ ok: false, reason: "invalid", field: "quantity", issue: "quantity-invalid" });
    expect(await updateProposal(batchId, itemId, 0, { date: "2026-02-30" }, db())).toEqual({ ok: false, reason: "invalid", field: "date", issue: "date-invalid" });
    expect(await updateProposal(batchId, itemId, 1, { amount: "0" }, db())).toEqual({ ok: false, reason: "invalid", field: "amount", issue: "amount-invalid" });
    expect(await updateProposal(batchId, itemId, 0, { fee: "-1" }, db())).toEqual({ ok: false, reason: "invalid", field: "fee", issue: "fee-invalid" });
    // A DIVIDEND has no quantity: the field is ignored, not stored.
    const ignored = await updateProposal(batchId, itemId, 1, { quantity: "5" }, db());
    expect(ignored.ok && ignored.proposal).not.toHaveProperty("quantity");
    expect(JSON.parse((await db().importItem.findUniqueOrThrow({ where: { id: itemId } })).proposals)).toEqual(JSON.parse(before));
  });

  it("edits only the fields of the proposal's type and never type, ISIN or name", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("a.pdf", SAP_BUY, ACCOUNT_FEE, WITHHOLDING)]);
    const itemId = (await review(batchId)).items[0]!.id;
    const foreign = { type: "SELL", isin: ETF, name: "Fremd" } as unknown as ProposalEdit;
    expect(await updateProposal(batchId, itemId, 0, { ...foreign, amount: "22" }, db())).toMatchObject({
      ok: true,
      proposal: { type: "BUY", isin: SAP, name: "SAP SE", amount: "22" },
    });
    expect(await updateProposal(batchId, itemId, 1, { fee: "5.9", tax: "1", amount: "3", date: "2026-10-22" }, db())).toEqual({
      ok: true,
      proposal: { ...ACCOUNT_FEE, fee: "5.9", tax: "0", date: "2026-10-22" },
    });
    expect(await updateProposal(batchId, itemId, 2, { tax: "2.5", fee: "1", amount: "3" }, db())).toEqual({
      ok: true,
      proposal: { ...WITHHOLDING, fee: "0", tax: "2.5" },
    });
  });
});

describe("bookImportBatch", () => {
  it("books every accepted proposal in one call, creates Securities, marks the batch BOOKED and deletes its PDFs", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("a.pdf", SAP_BUY), doc("b.pdf", DIVIDEND), doc("c.pdf", PLAN), doc("d.pdf", ACCOUNT_FEE), pdf("x.pdf")]);
    expect(batchFiles(batchId)).toHaveLength(5);
    expect(await book(batchId)).toEqual({ ok: true, booked: 4, depotId: id });
    const rows = await listTransactions(id, db());
    // listTransactions is newest first.
    expect(
      rows.reverse().map((row) => [row.date, row.type, row.security?.isin ?? null, row.quantity, row.price, row.amount, row.fee, row.tax]),
    ).toEqual([
      ["2026-10-01", "DIVIDEND", SAP, null, null, "84.12", "0", "15.51"],
      ["2026-10-08", "BUY", SAP, "2", "10.5", "21", "1.5", "0"],
      ["2026-10-15", "BUY", ETF, "3.412871", "43.95", "150", "0", "0"],
      ["2026-10-20", "FEE", null, null, null, "0", "4.9", "0"],
    ]);
    const securities = await db().security.findMany({ orderBy: { isin: "asc" } });
    expect(securities.map((security) => [security.isin, security.name, security.assetType])).toEqual([
      [SAP, "SAP SE", "STOCK"],
      [ETF, "iShares Core MSCI World UCITS ETF", "ETF"],
    ]);
    expect((await db().importBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("BOOKED");
    expect(await countOpenBatches(db())).toBe(0);
    expect(existsSync(join(dataDir, "imports", batchId))).toBe(false);
    const items = await db().importItem.findMany({ where: { batchId } });
    expect(items).toHaveLength(5);
    expect(items.every((item) => item.storedFile === null)).toBe(true);
  });

  it("books nothing for a re-import of a booked document", async () => {
    const { id } = await depot();
    const first = await stage(id, [doc("kauf.pdf", SAP_BUY)]);
    expect((await book(first)).ok).toBe(true);
    const again = await stage(id, [doc("kauf.pdf", SAP_BUY)]);
    const batch = await review(again);
    expect(batch.items[0]).toMatchObject({ reviewStatus: "DUPLICATE", duplicateUpload: true });
    expect(batch.items[0]?.proposals[0]?.ledgerMatches).toHaveLength(1);
    expect(batch.bookKeys).toEqual([]);
    expect(await bookImportBatch(again, [], env(), db())).toEqual({ ok: false, reason: "nothing-to-book" });
    expect(await db().transaction.count()).toBe(1);
  });

  it("books a 15-document batch in one call", async () => {
    const { id } = await depot();
    const files = Array.from({ length: 15 }, (_, i) =>
      doc(`plan-${i}.pdf`, { ...PLAN, date: `2026-10-${String(i + 1).padStart(2, "0")}` }),
    );
    const batchId = await stage(id, files);
    expect((await review(batchId)).bookKeys).toHaveLength(15);
    expect(await book(batchId)).toEqual({ ok: true, booked: 15, depotId: id });
    expect(await db().transaction.count()).toBe(15);
    expect(await db().security.count()).toBe(1);
  });

  it("rolls back everything when the ledger rejects an entry and names the file", async () => {
    const { id } = await depot();
    const sell: TransactionProposalInput = { ...SAP_BUY, type: "SELL", date: "2026-10-09", quantity: "5", amount: "52.5" };
    const batchId = await stage(id, [doc("kauf.pdf", SAP_BUY), doc("verkauf.pdf", sell)]);
    const result = await book(batchId);
    expect(result).toMatchObject({ ok: false, reason: "ledger-rejected", fileName: "verkauf.pdf", type: "SELL", failure: { reason: "sell-exceeds-holding", available: "2" } });
    expect(await db().transaction.count()).toBe(0);
    expect(await db().security.count()).toBe(0);
    expect((await db().importBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("OPEN");
    expect(batchFiles(batchId)).toHaveLength(2);
    expect((await db().importItem.findMany({ where: { batchId } })).every((item) => item.storedFile !== null)).toBe(true);
  });

  it("is rejected by the ledger for an archived Depot", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("kauf.pdf", SAP_BUY)]);
    expect((await archiveDepot(id, db())).ok).toBe(true);
    expect((await review(batchId)).depotArchived).toBe(true);
    expect(await book(batchId)).toMatchObject({ ok: false, reason: "ledger-rejected", fileName: null, failure: { reason: "depot-archived" } });
    expect((await db().importBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("OPEN");
  });

  it("refuses with review-changed when the ledger changed after the page was loaded", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("kauf.pdf", SAP_BUY)]);
    const seen = (await review(batchId)).bookKeys;
    const security = await ensureSecurity({ isin: SAP }, { name: "SAP", assetType: "STOCK" }, db());
    if (!security.ok) throw new Error("setup failed");
    await recordTransaction({ depotId: id, type: "BUY", date: "2026-10-08", quantity: "2", price: "10.5", fee: "1.5", security: { id: security.security.id } }, db());
    expect(await bookImportBatch(batchId, seen, env(), db())).toEqual({ ok: false, reason: "review-changed" });
    expect(await bookImportBatch(batchId, [...seen, "x:0"], env(), db())).toEqual({ ok: false, reason: "review-changed" });
    expect(await db().transaction.count()).toBe(1);
  });

  it("refuses a second booking and review writes on a BOOKED batch; discarding it keeps its rows", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("kauf.pdf", SAP_BUY)]);
    const keys = (await review(batchId)).bookKeys;
    const itemId = (await review(batchId)).items[0]!.id;
    expect((await bookImportBatch(batchId, keys, env(), db())).ok).toBe(true);
    expect(await bookImportBatch(batchId, keys, env(), db())).toEqual({ ok: false, reason: "not-found" });
    expect(await decideProposal(batchId, itemId, 0, "discard", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await updateProposal(batchId, itemId, 0, { amount: "1" }, db())).toEqual({ ok: false, reason: "not-found" });
    expect(await discardImportBatch(batchId, env(), db())).toEqual({ ok: false, reason: "not-found" });
    expect(await db().importItem.count({ where: { batchId } })).toBe(1);
    expect(await db().transaction.count()).toBe(1);
  });

  it("books accepted proposals by date, not by file order", async () => {
    const { id } = await depot();
    const sell: TransactionProposalInput = { ...SAP_BUY, type: "SELL", date: "2026-10-20", quantity: "2", amount: "30" };
    const batchId = await stage(id, [doc("verkauf.pdf", sell), doc("kauf.pdf", SAP_BUY)]);
    expect(await book(batchId)).toEqual({ ok: true, booked: 2, depotId: id });
  });

  /** A client whose `$transaction` first runs `before` (another writer between review and booking), then delegates. */
  function interceptedDb(before: () => Promise<void>) {
    const client = db();
    return new Proxy(client, {
      get(target, property, receiver) {
        if (property !== "$transaction") return Reflect.get(target, property, receiver);
        return async (...args: Parameters<typeof client.$transaction>) => {
          await before();
          return (target.$transaction as (...rest: unknown[]) => unknown)(...args);
        };
      },
    });
  }

  it("returns not-found when the batch is claimed by another booking inside the transaction", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("kauf.pdf", SAP_BUY)]);
    const keys = (await review(batchId)).bookKeys;
    const intercepted = interceptedDb(async () => {
      await db().importBatch.update({ where: { id: batchId }, data: { status: "BOOKED" } });
    });
    expect(await bookImportBatch(batchId, keys, env(), intercepted)).toEqual({ ok: false, reason: "not-found" });
    expect(await db().transaction.count()).toBe(0);
    expect(await db().security.count()).toBe(0);
  });

  it("returns review-changed when the ledger changes inside the booking window", async () => {
    const { id } = await depot();
    const batchId = await stage(id, [doc("kauf.pdf", SAP_BUY)]);
    const keys = (await review(batchId)).bookKeys;
    const intercepted = interceptedDb(async () => {
      const security = await ensureSecurity({ isin: SAP }, { name: "SAP", assetType: "STOCK" }, db());
      if (!security.ok) throw new Error("setup failed");
      const recorded = await recordTransaction(
        { depotId: id, type: "BUY", date: "2026-10-08", quantity: "2", price: "10.5", fee: "1.5", security: { id: security.security.id } },
        db(),
      );
      if (!recorded.ok) throw new Error("setup failed");
    });
    expect(await bookImportBatch(batchId, keys, env(), intercepted)).toEqual({ ok: false, reason: "review-changed" });
    expect(await db().transaction.count()).toBe(1);
    expect((await db().importBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("OPEN");
    expect(batchFiles(batchId)).toHaveLength(1);
  });

  it("returns not-found for an unknown batch", async () => {
    expect(await bookImportBatch("nope", [], env(), db())).toEqual({ ok: false, reason: "not-found" });
    expect(await bookImportBatch("", [], env(), db())).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("comdirect upload (story 5.4)", () => {
  const comdirect = (name: string) =>
    readFileSync(resolve(__dirname, "../../../test/fixtures/import/comdirect", name), "utf8");
  const NOTICE_INFO = "Steuern in „dividende.pdf“ übernommen. Keine Buchung erforderlich.";

  it("merges a credit and its Steuermitteilung into one DIVIDEND and books only that", async () => {
    const { id } = await depot("COMDIRECT", "comdirect");
    const batchId = await create(id, [pdf("dividende.pdf", comdirect("dividend.txt")), pdf("steuer.pdf", comdirect("dividend-tax.txt"))]);
    const batch = await review(batchId);
    expect(batch.items.map((item) => [item.fileName, item.status, item.reviewStatus, item.documentType, item.reason, item.documentDate])).toEqual([
      ["dividende.pdf", "PARSED", "PARSED", "dividend", null, null],
      ["steuer.pdf", "NO_BOOKING", "NO_BOOKING", "dividend-tax", NOTICE_INFO, null],
    ]);
    expect(batch.items[0]?.proposals.map((view) => view.proposal)).toEqual([
      {
        type: "DIVIDEND",
        date: "2026-06-21",
        isin: "IE00B3RBWM25",
        name: "Vanguard FTSE All-World UCITS ETF",
        amount: "25.57",
        fee: "0",
        tax: "4.73",
      },
    ]);
    expect(batch.items[1]?.proposals).toEqual([]);
    expect(batch.files).toEqual({ PARSED: 1, AMBIGUOUS: 0, DUPLICATE: 0, NO_BOOKING: 1, CORPORATE_ACTION: 0, FAILED: 0 });
    expect(batch.bookKeys).toHaveLength(1);
    expect(await listOpenBatches(db())).toEqual([expect.objectContaining({ fileCount: 2, parsedCount: 1, failedCount: 0 })]);

    expect(await book(batchId)).toEqual({ ok: true, booked: 1, depotId: id });
    const rows = await listTransactions(id, db());
    expect(rows.map((row) => [row.date, row.type, row.security?.isin, row.amount, row.fee, row.tax])).toEqual([
      ["2026-06-21", "DIVIDEND", "IE00B3RBWM25", "25.57", "0", "4.73"],
    ]);
  });

  it("keeps a lone credit with its note and fails a lone notice with its date", async () => {
    const { id } = await depot("COMDIRECT", "comdirect");
    const credit = await review(await create(id, [pdf("dividende.pdf", comdirect("dividend.txt"))]));
    expect(credit.items[0]).toMatchObject({
      status: "PARSED",
      reviewStatus: "PARSED",
      reason: "Steuermitteilung (Referenz-Nr. 3AAAAAAAAAA001AA) nicht im Import: Steuern sind nicht enthalten. Bitte prüfen oder zusammen hochladen.",
      proposals: [{ proposal: { type: "DIVIDEND", amount: "25.57", tax: "0" } }],
    });
    const notice = await review(await create(id, [pdf("steuer.pdf", comdirect("dividend-tax.txt"))]));
    expect(notice.items[0]).toMatchObject({
      status: "FAILED",
      reviewStatus: "FAILED",
      documentType: null,
      reason: "Steuermitteilung ohne Ertragsgutschrift. Bitte zusammen hochladen.",
      documentDate: "2026-06-21",
      proposals: [],
    });
  });

  it("stages a buy and a sell settlement with the matrix values", async () => {
    const { id } = await depot("COMDIRECT", "comdirect");
    const batch = await review(await create(id, [pdf("kauf.pdf", comdirect("buy.txt")), pdf("verkauf.pdf", comdirect("sell.txt"))]));
    expect(batch.items.flatMap((item) => item.proposals.map((view) => view.proposal))).toEqual([
      expect.objectContaining({ type: "BUY", date: "2026-04-07", isin: "DE0005933931", quantity: "2.5", price: "180.12345", amount: "450.31", fee: "0", tax: "0" }),
      expect.objectContaining({ type: "SELL", date: "2026-05-06", isin: "LU0274209740", quantity: "3.2", price: "52.5", amount: "168", fee: "0", tax: "3.32" }),
    ]);
    expect(batch.items.map((item) => item.reason)).toEqual([null, null]);
  });
});

describe("finanzen.net zero upload (story 5.5)", () => {
  const zero = (name: string) => readFileSync(resolve(__dirname, "../../../test/fixtures/import/finanzen-zero", name), "utf8");

  it("stages a buy, a tax refund, a tax-pot notice and an ISIN change and books the BUY, the TAX and the change in one booking", async () => {
    const { id } = await depot("FINANZEN_ZERO", "finanzen.net zero");
    const batchId = await create(id, [
      pdf("umtausch.pdf", zero("isin-change.txt")),
      pdf("kauf.pdf", zero("buy.txt")),
      pdf("erstattung.pdf", zero("tax-refund.txt")),
      pdf("topf.pdf", zero("tax-pot-no-booking.txt")),
    ]);
    const batch = await review(batchId);
    expect(batch.items.map((item) => [item.fileName, item.status, item.reviewStatus, item.documentType, item.reason])).toEqual([
      ["umtausch.pdf", "CORPORATE_ACTION", "CORPORATE_ACTION", "corporate-action", null],
      ["kauf.pdf", "PARSED", "PARSED", "trade", null],
      ["erstattung.pdf", "PARSED", "PARSED", "tax-refund", null],
      ["topf.pdf", "NO_BOOKING", "NO_BOOKING", "tax-pot", "Keine Buchung erforderlich."],
    ]);
    const change = batch.items[0]!;
    expect(change.proposals).toEqual([]);
    expect(change.isinChange).toEqual({
      key: `${change.id}:0`,
      proposal: {
        kind: "isin-change",
        date: "2026-08-13",
        oldIsin: "DE0007236101",
        oldName: "Siemens AG",
        oldQuantity: "12",
        newIsin: "DE000ENER6Y0",
        newName: "Siemens Energy AG",
        newQuantity: "12",
      },
      status: "unique",
      decision: null,
      effective: "book",
    });
    expect(batch.items[1]?.isinChange).toBeNull();
    expect(batch.files).toEqual({ PARSED: 2, AMBIGUOUS: 0, DUPLICATE: 0, NO_BOOKING: 1, CORPORATE_ACTION: 1, FAILED: 0 });
    expect(batch.bookKeys).toEqual([`${change.id}:0`, `${batch.items[1]!.id}:0`, `${batch.items[2]!.id}:0`]);
    expect(await listOpenBatches(db())).toEqual([expect.objectContaining({ fileCount: 4, parsedCount: 3, failedCount: 0 })]);

    // The BUY (2026-04-15) is booked before the change (2026-08-13) although its file comes later.
    expect(await book(batchId)).toEqual({ ok: true, booked: 3, depotId: id });
    const rows = await listTransactions(id, db());
    expect(rows.reverse().map((row) => [row.date, row.type, row.security?.isin ?? null, row.quantity, row.price, row.amount, row.fee, row.tax])).toEqual([
      ["2026-04-15", "BUY", "DE0007236101", "12", "180.5", "2166", "0", "0"],
      ["2026-08-29", "TAX", null, null, null, "0", "0", "-18.99"],
    ]);
    const changes = await listIsinChanges(db());
    expect(changes.map((entry) => [entry.oldSecurity.isin, entry.newSecurity.isin, entry.date, entry.oldQuantity, entry.newQuantity])).toEqual([
      ["DE0007236101", "DE000ENER6Y0", "2026-08-13", "12", "12"],
    ]);
    expect(changes[0]?.newSecurity).toMatchObject({ name: "Siemens Energy AG", assetType: "STOCK" });
    const positions = await listPositions(id, "2026-10-26", db());
    expect(positions.map((position) => [position.security.isin, position.quantity, position.costBasis])).toEqual([["DE000ENER6Y0", "12", "2166"]]);
  });
});

describe("ISIN changes from broker documents (story 5-6)", () => {
  const zero = (name: string) => readFileSync(resolve(__dirname, "../../../test/fixtures/import/finanzen-zero", name), "utf8");
  const OLD = "DE0007236101";
  const NEW = "DE000ENER6Y0";

  async function zeroDepot() {
    return (await depot("FINANZEN_ZERO", "finanzen.net zero")).id;
  }

  it("books an ISIN change for a BUY of the old ISIN booked earlier: the position moves to the new ISIN", async () => {
    const id = await zeroDepot();
    expect(await book(await create(id, [pdf("kauf.pdf", zero("buy.txt"))]))).toMatchObject({ ok: true, booked: 1 });
    const oldSecurity = await db().security.findUniqueOrThrow({ where: { isin: OLD } });
    // Stored as an ETF: the successor takes over the stored asset type instead of a name estimate (STOCK).
    await db().security.update({ where: { id: oldSecurity.id }, data: { name: "Siemens (gespeichert)", assetType: "ETF" } });

    const batchId = await create(id, [pdf("umtausch.pdf", zero("isin-change.txt"))]);
    const batch = await review(batchId);
    expect(batch.items[0]).toMatchObject({ reviewStatus: "CORPORATE_ACTION", isinChange: { status: "unique", effective: "book" } });
    expect(await book(batchId)).toEqual({ ok: true, booked: 1, depotId: id });
    expect(await db().transaction.count()).toBe(1);
    const positions = await listPositions(id, "2026-10-26", db());
    expect(positions.map((position) => [position.security.isin, position.quantity, position.costBasis])).toEqual([[NEW, "12", "2166"]]);
    // The existing old Security keeps its stored name.
    expect((await db().security.findUniqueOrThrow({ where: { isin: OLD } })).name).toBe("Siemens (gespeichert)");
    expect(await db().security.findUniqueOrThrow({ where: { isin: NEW } })).toMatchObject({ name: "Siemens Energy AG", assetType: "ETF" });
    expect((await db().importBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("BOOKED");
  });

  it("books the ISIN change before a SELL of the new ISIN on the same date, whatever the file order (AD-8)", async () => {
    const id = await zeroDepot();
    const old = await ensureSecurity({ isin: OLD }, { name: "Siemens AG", assetType: "STOCK" }, db());
    if (!old.ok) throw new Error("setup failed");
    const bought = await recordTransaction(
      { depotId: id, type: "BUY", date: "2026-04-15", quantity: "40", price: "20", amount: "800", security: { id: old.security.id } },
      db(),
    );
    expect(bought.ok).toBe(true);
    // A SELL of 30 Siemens Energy on the effective date of the change (synthetic variant of sell.txt).
    const sell = zero("sell.txt").replaceAll("DE0005557508", NEW).replaceAll("15.05.2026", "13.08.2026").replaceAll("Deutsche Telekom AG", "Siemens Energy AG");
    const batchId = await create(id, [pdf("verkauf.pdf", sell), pdf("umtausch.pdf", zero("isin-change.txt"))]);
    const batch = await review(batchId);
    expect(batch.items[0]?.proposals.map((view) => [view.proposal.type, view.proposal.date, view.proposal.isin, view.proposal.quantity])).toEqual([
      ["SELL", "2026-08-13", NEW, "30"],
    ]);
    expect(batch.items[1]?.isinChange?.status).toBe("unique");
    expect(await book(batchId)).toEqual({ ok: true, booked: 2, depotId: id });
    const positions = await listPositions(id, "2026-10-26", db());
    expect(positions.map((position) => [position.security.isin, position.quantity, position.costBasis])).toEqual([[NEW, "10", "200"]]);
  });

  it("shows an already recorded change as recorded and books nothing", async () => {
    const id = await zeroDepot();
    const old = await ensureSecurity({ isin: OLD }, { name: "Siemens AG", assetType: "STOCK" }, db());
    const successor = await ensureSecurity({ isin: NEW }, { name: "Siemens Energy AG", assetType: "STOCK" }, db());
    if (!old.ok || !successor.ok) throw new Error("setup failed");
    const recorded = await recordIsinChange(
      { oldSecurityId: old.security.id, newSecurity: { id: successor.security.id }, date: "2026-08-13", oldQuantity: "12", newQuantity: "12" },
      db(),
    );
    expect(recorded.ok).toBe(true);
    const batchId = await create(id, [pdf("umtausch.pdf", zero("isin-change.txt"))]);
    const batch = await review(batchId);
    expect(batch.items[0]).toMatchObject({ reviewStatus: "CORPORATE_ACTION", isinChange: { status: "recorded", effective: "discard" } });
    expect(batch.bookKeys).toEqual([]);
    expect(await bookImportBatch(batchId, [], env(), db())).toEqual({ ok: false, reason: "nothing-to-book" });
    expect(await listIsinChanges(db())).toHaveLength(1);
  });

  it("books the same change uploaded twice only once", async () => {
    const id = await zeroDepot();
    const batchId = await create(id, [pdf("a.pdf", zero("isin-change.txt")), pdf("b.pdf", zero("isin-change.txt"))]);
    const batch = await review(batchId);
    expect(batch.items.map((item) => [item.isinChange?.status, item.isinChange?.effective])).toEqual([
      ["unique", "book"],
      ["duplicate", "discard"],
    ]);
    expect(batch.bookKeys).toEqual([`${batch.items[0]!.id}:0`]);
    expect(await book(batchId)).toEqual({ ok: true, booked: 1, depotId: id });
    expect(await listIsinChanges(db())).toHaveLength(1);
  });

  it("discards an ISIN change by decision and never edits it", async () => {
    const id = await zeroDepot();
    const batchId = await create(id, [pdf("umtausch.pdf", zero("isin-change.txt")), pdf("kauf.pdf", zero("buy.txt"))]);
    const [change, buy] = (await review(batchId)).items;
    expect(await decideProposal(batchId, change!.id, 0, "discard", db())).toEqual({ ok: true });
    let batch = await review(batchId);
    expect(batch.items[0]?.isinChange).toMatchObject({ decision: "discard", effective: "discard" });
    expect(batch.bookKeys).toEqual([`${buy!.id}:0`]);
    expect(await decideProposal(batchId, change!.id, 1, "book", db())).toEqual({ ok: false, reason: "not-found" });
    expect(await updateProposal(batchId, change!.id, 0, { date: "2026-08-14" }, db())).toEqual({ ok: false, reason: "not-found" });
    expect(await decideProposal(batchId, change!.id, 0, null, db())).toEqual({ ok: true });
    batch = await review(batchId);
    expect(batch.items[0]?.isinChange).toMatchObject({ decision: null, effective: "book" });
  });

  it("names the file of a rejected ISIN change and books nothing", async () => {
    const id = await zeroDepot();
    const old = await ensureSecurity({ isin: OLD }, { name: "Siemens AG", assetType: "STOCK" }, db());
    const other = await ensureSecurity({ isin: SAP }, { name: "SAP SE", assetType: "STOCK" }, db());
    if (!old.ok || !other.ok) throw new Error("setup failed");
    // Another change of the old Security on that date: not "recorded" (other new Security), but the ledger refuses it.
    const recorded = await recordIsinChange(
      { oldSecurityId: old.security.id, newSecurity: { id: other.security.id }, date: "2026-08-13", oldQuantity: "1", newQuantity: "1" },
      db(),
    );
    expect(recorded.ok).toBe(true);
    const batchId = await create(id, [pdf("kauf.pdf", zero("buy.txt")), pdf("umtausch.pdf", zero("isin-change.txt"))]);
    expect((await review(batchId)).items[1]?.isinChange?.status).toBe("unique");
    expect(await book(batchId)).toEqual({
      ok: false,
      reason: "ledger-rejected",
      fileName: "umtausch.pdf",
      type: "ISIN_CHANGE",
      failure: { ok: false, reason: "isin-change-exists" },
    });
    expect(await db().transaction.count()).toBe(0);
    expect(await db().security.count()).toBe(2);
    expect((await db().importBatch.findUniqueOrThrow({ where: { id: batchId } })).status).toBe("OPEN");
  });

  it("stores an unreadable corporate-action notice as FAILED with document type corporate-action", async () => {
    const id = await zeroDepot();
    const split = zero("isin-change.txt").replaceAll("Obligatorischer Umtausch", "Aktiensplit");
    const unreadable = zero("isin-change.txt").replace("Verhältnis: 1 : 1", "Verhältnis: 1 : 1\nBarausgleich EUR 3,50");
    const batchId = await create(id, [pdf("split.pdf", split.replace(/Einbuchung\nStück[^\n]*\nISIN: [^\n]*\n/, "")), pdf("bar.pdf", unreadable), pdf("x.pdf", "Baader Bank\nWertpapierabrechnung: Kauf")]);
    const batch = await review(batchId);
    const reason = "Kapitalmaßnahme bitte in der Position unter „Corporate Action“ erfassen.";
    expect(batch.items.map((item) => [item.status, item.reviewStatus, item.documentType, item.reason, item.isinChange])).toEqual([
      ["FAILED", "FAILED", "corporate-action", reason, null],
      ["FAILED", "FAILED", "corporate-action", reason, null],
      ["FAILED", "FAILED", null, expect.stringContaining("Buchung bitte manuell erfassen."), null],
    ]);
    expect(batch.files.FAILED).toBe(3);
  });

  it("shows a CORPORATE_ACTION item whose stored change no longer validates as failed", async () => {
    const id = await zeroDepot();
    const batchId = await create(id, [pdf("umtausch.pdf", zero("isin-change.txt"))]);
    await db().importItem.updateMany({ where: { batchId }, data: { proposals: '[{"kind":"isin-change"}]' } });
    expect((await review(batchId)).items[0]).toMatchObject({
      status: "FAILED",
      reviewStatus: "FAILED",
      reason: STORED_PROPOSALS_INVALID_REASON,
      isinChange: null,
    });
  });
});
