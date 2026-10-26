// Import staging (AD-4): an upload becomes one ImportBatch with one ImportItem per file. Nothing here
// writes the ledger; Depots are read only through the ledger's exported services. The module's only
// writes are ImportBatch / ImportItem rows and files under `<DATA_DIR>/imports/<batchId>/`.
import { createHash } from "node:crypto";
import { prisma } from "@/db";
import type { ImportBatchStatus, ImportItemStatus, Prisma } from "@/db/generated/prisma/client";
import { type Broker, getDepot, listDepots } from "@/modules/ledger";
import { extractPdfText, isPdf } from "./extract";
import { IMPORT_MAX_BATCH_BYTES, IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILES } from "./limits";
import { PARSERS, type ParseOutcome, parseDocument, type ParserRegistry } from "./parsers/registry";
import { proposalListSchema, type TransactionProposal } from "./proposal";
import { deleteBatchDir, importsDir, writeImportFile } from "./storage";

export type { ImportBatchStatus, ImportItemStatus } from "@/db/generated/prisma/client";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type ImportDb = Prisma.TransactionClient;

/** External dependencies of the import services; each defaults to the real thing (tests inject fakes). */
export type ImportDeps = {
  env?: { DATA_DIR?: string };
  /** Current time for `createdAt`. */
  now?: () => Date;
  /** PDF text extraction (default: unpdf). */
  extract?: (bytes: Uint8Array) => Promise<string>;
  /** Parser registry (default: the production registry). */
  registry?: ParserRegistry;
};

/** One uploaded file. */
export type UploadedFile = { name: string; bytes: Uint8Array };

export const TOO_LARGE_REASON = "Datei zu groß (max. 5 MB).";
export const NOT_A_PDF_REASON = "Keine PDF-Datei.";
export const EXTRACTION_FAILED_REASON = "Text konnte nicht gelesen werden.";
/** Shown for a stored item whose proposals no longer validate (never expected). */
export const STORED_PROPOSALS_INVALID_REASON = "Gespeicherte Vorschläge sind ungültig. Bitte erneut hochladen.";

export type CreateImportBatchFailureReason =
  | "files-missing"
  | "too-many-files"
  | "upload-too-large"
  | "depot-not-found"
  | "depot-archived";

export type CreateImportBatchResult = { ok: true; batchId: string } | { ok: false; reason: CreateImportBatchFailureReason };

export type DiscardImportBatchResult = { ok: true } | { ok: false; reason: "not-found" };

/** One file of a batch, as shown in review. */
export type ImportItemView = {
  id: string;
  position: number;
  fileName: string;
  status: ImportItemStatus;
  documentType: string | null;
  /** German reason of a FAILED item. */
  reason: string | null;
  /** The same file bytes were uploaded before (warning only). */
  duplicateUpload: boolean;
  proposals: TransactionProposal[];
};

/** A batch with its Depot and its items in upload order. */
export type ImportBatchView = {
  id: string;
  depotId: string;
  depotName: string;
  broker: Broker;
  status: ImportBatchStatus;
  /** UTC ISO timestamp of the upload. */
  createdAt: string;
  items: ImportItemView[];
};

/** An open batch in the list on `/import`. */
export type OpenImportBatch = {
  id: string;
  depotId: string;
  depotName: string;
  broker: Broker;
  createdAt: string;
  fileCount: number;
  parsedCount: number;
  failedCount: number;
};

/** Timeout of the upload transaction: it writes up to `IMPORT_MAX_FILES` files besides its rows. */
export const IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;

async function inTransaction<T>(
  db: ImportDb,
  write: (tx: ImportDb) => Promise<T>,
  options?: { timeout: number; maxWait: number },
): Promise<T> {
  const client = db as ImportDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") return client.$transaction((tx) => write(tx), options);
  return write(db);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type PreparedItem = {
  fileName: string;
  fileHash: string;
  /** Bytes to keep on disk; null when the file is not kept. */
  keep: Uint8Array | null;
  outcome: ParseOutcome;
};

async function prepare(file: UploadedFile, broker: Broker, deps: ImportDeps): Promise<PreparedItem> {
  const base = { fileName: file.name, fileHash: sha256(file.bytes) };
  if (file.bytes.byteLength > IMPORT_MAX_FILE_BYTES) {
    return { ...base, keep: null, outcome: { status: "FAILED", reason: TOO_LARGE_REASON } };
  }
  if (!isPdf(file.bytes)) return { ...base, keep: null, outcome: { status: "FAILED", reason: NOT_A_PDF_REASON } };
  let text: string;
  try {
    text = await (deps.extract ?? extractPdfText)(file.bytes);
  } catch (error) {
    console.warn(`Import: text extraction failed (${error instanceof Error ? error.name : "unknown"})`);
    return { ...base, keep: file.bytes, outcome: { status: "FAILED", reason: EXTRACTION_FAILED_REASON } };
  }
  return { ...base, keep: file.bytes, outcome: parseDocument(broker, text, deps.registry ?? PARSERS) };
}

/** Normalises a client-supplied file name for display (no path, bounded length). */
function displayName(name: string, position: number): string {
  const base = name.normalize("NFC").split(/[/\\]/).pop()?.trim() ?? "";
  // Truncated by code points so no surrogate pair is cut in half.
  return Array.from(base || `Datei ${position + 1}`).slice(0, 255).join("");
}

/**
 * Stages `files` for Depot `depotId`: one OPEN batch, one item per file in upload order, each PARSED (with
 * validated proposals) or FAILED (with a German reason). A hash already stored on another item, or seen
 * earlier in this upload, only flags `duplicateUpload`. Rejects (nothing written) an empty upload, more than
 * `IMPORT_MAX_FILES` files, more than `IMPORT_MAX_BATCH_BYTES` in total and an unknown or archived Depot.
 */
export async function createImportBatch(
  depotId: string,
  files: readonly UploadedFile[],
  deps: ImportDeps = {},
  db: ImportDb = prisma,
): Promise<CreateImportBatchResult> {
  if (files.length === 0) return { ok: false, reason: "files-missing" };
  if (files.length > IMPORT_MAX_FILES) return { ok: false, reason: "too-many-files" };
  const total = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  if (total > IMPORT_MAX_BATCH_BYTES) return { ok: false, reason: "upload-too-large" };
  const depot = depotId ? await getDepot(depotId, db) : null;
  if (!depot) return { ok: false, reason: "depot-not-found" };
  if (depot.archived) return { ok: false, reason: "depot-archived" };

  // Extraction and parsing run before any write, outside the DB transaction.
  const prepared: PreparedItem[] = [];
  for (const file of files) prepared.push(await prepare(file, depot.broker, deps));

  const dir = importsDir(deps.env ?? process.env);
  const createdAt = (deps.now ?? (() => new Date()))().toISOString();
  let batchId: string | null = null;
  try {
    return await inTransaction(db, async (tx) => {
      const hashes = [...new Set(prepared.map((item) => item.fileHash))];
      const stored = await tx.importItem.findMany({ where: { fileHash: { in: hashes } }, select: { fileHash: true } });
      const seen = new Set(stored.map((item) => item.fileHash));
      const batch = await tx.importBatch.create({ data: { depotId: depot.id, status: "OPEN", createdAt } });
      batchId = batch.id;
      for (const [position, item] of prepared.entries()) {
        const { outcome } = item;
        const created = await tx.importItem.create({
          data: {
            batchId: batch.id,
            position,
            fileName: displayName(item.fileName, position),
            fileHash: item.fileHash,
            duplicateUpload: seen.has(item.fileHash),
            status: outcome.status,
            documentType: outcome.status === "PARSED" ? outcome.documentType : null,
            reason: outcome.status === "FAILED" ? outcome.reason : null,
            proposals: JSON.stringify(outcome.status === "PARSED" ? outcome.proposals : []),
          },
          select: { id: true },
        });
        seen.add(item.fileHash);
        if (item.keep) {
          const storedFile = writeImportFile(dir, batch.id, created.id, item.keep);
          await tx.importItem.update({ where: { id: created.id }, data: { storedFile } });
        }
      }
      return { ok: true as const, batchId: batch.id };
    }, { timeout: IMPORT_TRANSACTION_TIMEOUT_MS, maxWait: 10_000 });
  } catch (error) {
    // The rows were rolled back; files written so far must go too.
    if (batchId) deleteBatchDir(dir, batchId);
    throw error;
  }
}

/** Stored proposals, validated with the proposal schema; `null` when they do not validate. */
function readProposals(json: string): TransactionProposal[] | null {
  try {
    const parsed = proposalListSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** A batch with its Depot and items, or `null` for an unknown id or a Depot that no longer exists. */
export async function getImportBatch(id: string, db: ImportDb = prisma): Promise<ImportBatchView | null> {
  if (!id) return null;
  const batch = await db.importBatch.findUnique({ where: { id }, include: { items: { orderBy: { position: "asc" } } } });
  if (!batch) return null;
  const depot = await getDepot(batch.depotId, db);
  if (!depot) return null;
  return {
    id: batch.id,
    depotId: depot.id,
    depotName: depot.name,
    broker: depot.broker,
    status: batch.status,
    createdAt: batch.createdAt,
    items: batch.items.map((item) => {
      const proposals = readProposals(item.proposals);
      const broken = proposals === null || (item.status === "PARSED" && proposals.length === 0);
      if (broken) console.warn("Import: stored proposals of an item failed validation");
      return {
        id: item.id,
        position: item.position,
        fileName: item.fileName,
        status: broken ? "FAILED" : item.status,
        documentType: item.documentType,
        reason: broken ? STORED_PROPOSALS_INVALID_REASON : item.reason,
        duplicateUpload: item.duplicateUpload,
        proposals: proposals ?? [],
      };
    }),
  };
}

/** Open batches, newest first, with their Depot and item counts. */
export async function listOpenBatches(db: ImportDb = prisma): Promise<OpenImportBatch[]> {
  const batches = await db.importBatch.findMany({
    where: { status: "OPEN" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { items: { select: { status: true } } },
  });
  if (batches.length === 0) return [];
  const depots = new Map((await listDepots(db)).map((depot) => [depot.id, depot]));
  return batches.flatMap((batch) => {
    const depot = depots.get(batch.depotId);
    if (!depot) return [];
    const parsedCount = batch.items.filter((item) => item.status === "PARSED").length;
    return [
      {
        id: batch.id,
        depotId: depot.id,
        depotName: depot.name,
        broker: depot.broker,
        createdAt: batch.createdAt,
        fileCount: batch.items.length,
        parsedCount,
        failedCount: batch.items.length - parsedCount,
      },
    ];
  });
}

/** Number of open batches (the Import navigation badge). */
export async function countOpenBatches(db: ImportDb = prisma): Promise<number> {
  return db.importBatch.count({ where: { status: "OPEN" } });
}

/** Discards an open batch: deletes its rows, then its PDF directory. */
export async function discardImportBatch(
  id: string,
  deps: Pick<ImportDeps, "env"> = {},
  db: ImportDb = prisma,
): Promise<DiscardImportBatchResult> {
  if (!id) return { ok: false, reason: "not-found" };
  const deleted = await inTransaction(db, async (tx) => {
    const batch = await tx.importBatch.findFirst({ where: { id, status: "OPEN" }, select: { id: true } });
    if (!batch) return false;
    await tx.importItem.deleteMany({ where: { batchId: batch.id } });
    await tx.importBatch.delete({ where: { id: batch.id } });
    return true;
  });
  if (!deleted) return { ok: false, reason: "not-found" };
  deleteBatchDir(importsDir(deps.env ?? process.env), id);
  return { ok: true };
}

/**
 * Deletes every batch of Depot `depotId` (any status) with its files; called before the Depot is deleted
 * so no PDF directory is orphaned. Returns the number of batches removed.
 */
export async function discardImportBatchesOfDepot(
  depotId: string,
  deps: Pick<ImportDeps, "env"> = {},
  db: ImportDb = prisma,
): Promise<number> {
  if (!depotId) return 0;
  const ids = await inTransaction(db, async (tx) => {
    const batches = await tx.importBatch.findMany({ where: { depotId }, select: { id: true } });
    const batchIds = batches.map((batch) => batch.id);
    if (batchIds.length === 0) return batchIds;
    await tx.importItem.deleteMany({ where: { batchId: { in: batchIds } } });
    await tx.importBatch.deleteMany({ where: { id: { in: batchIds } } });
    return batchIds;
  });
  const dir = importsDir(deps.env ?? process.env);
  for (const id of ids) deleteBatchDir(dir, id);
  return ids.length;
}
