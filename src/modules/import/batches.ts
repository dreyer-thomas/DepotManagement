// Import staging (AD-4): an upload becomes one ImportBatch with one ImportItem per file. Nothing here
// writes the ledger; Depots are read only through the ledger's exported services. The module's only
// writes are ImportBatch / ImportItem rows and files under `<DATA_DIR>/imports/<batchId>/`.
import { createHash } from "node:crypto";
import { prisma } from "@/db";
import type { ImportBatchStatus, ImportItemStatus, Prisma } from "@/db/generated/prisma/client";
import type { IsinChange } from "@/core/corporate-actions";
import { classifySecurityName } from "@/core/asset-type";
import {
  type BatchEntry,
  type BatchFailure,
  type BatchSecurity,
  type Broker,
  getDepot,
  listDepots,
  listIsinChanges,
  listSecurities,
  listTransactions,
  recordBatch,
  type TransactionRecord,
} from "@/modules/ledger";
import { EDITABLE_PROPOSAL_FIELDS, type EditableProposalField, editableFields } from "./edit-fields";
import { extractPdfText, isPdf } from "./extract";
import { IMPORT_MAX_BATCH_BYTES, IMPORT_MAX_FILE_BYTES, IMPORT_MAX_FILES } from "./limits";
import { DATE_PATTERN, germanDate } from "./parsers/german";
import { linkDocuments } from "./parsers/link";
import { PARSERS, type ParseOutcome, parseDocument, type ParserRegistry } from "./parsers/registry";
import { type ProposalType, proposalListSchema, type TransactionProposal, transactionProposalSchema } from "./proposal";
import {
  classifyBatch,
  type EffectiveDecision,
  effectiveDecision,
  type ItemReviewStatus,
  itemReviewStatus,
  type ProposalReviewStatus,
  proposalKey,
  readDecisions,
  type ReviewCounts,
  type ReviewDecision,
  reviewCounts,
} from "./review";
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

/** One proposal of a file, classified against the Depot's ledger and the rest of the batch (story 5.3). */
export type ProposalReviewView = {
  /** `"<itemId>:<index>"`, stable within the batch. */
  key: string;
  index: number;
  proposal: TransactionProposal;
  status: ProposalReviewStatus;
  /** Ledger rows of the Depot the proposal may repeat. */
  ledgerMatches: TransactionRecord[];
  /** Another proposal of this batch is the same booking. */
  siblingMatch: boolean;
  /** The stored decision; `null` = none. */
  decision: ReviewDecision | null;
  effective: EffectiveDecision;
  /** The stored Security of the proposal's ISIN; `null` when it does not exist yet (or no ISIN). */
  securityId: string | null;
  /** Stored Security name, else the document's name, else the ISIN; `null` without an ISIN. */
  securityName: string | null;
};

/** One file of a batch, as shown in review. */
export type ImportItemView = {
  id: string;
  position: number;
  fileName: string;
  status: ImportItemStatus;
  /** The chip: erkannt, mehrdeutig, Duplikat, keine Buchung or fehlgeschlagen. */
  reviewStatus: ItemReviewStatus;
  documentType: string | null;
  /** German text: failure reason (FAILED), review note (PARSED, optional) or info (NO_BOOKING). */
  reason: string | null;
  /** The same file bytes were uploaded before (warning only). */
  duplicateUpload: boolean;
  /** First readable date of a parser-failed file (`YYYY-MM-DD`), prefills manual entry. */
  documentDate: string | null;
  proposals: ProposalReviewView[];
};

/** A batch with its Depot and its items in upload order. */
export type ImportBatchView = {
  id: string;
  depotId: string;
  depotName: string;
  broker: Broker;
  /** Booking is rejected by the ledger while the Depot is archived. */
  depotArchived: boolean;
  status: ImportBatchStatus;
  /** UTC ISO timestamp of the upload. */
  createdAt: string;
  items: ImportItemView[];
  /** Files per chip. */
  files: ReviewCounts["files"];
  /** Ambiguous proposals without a decision ("N Buchungen buchen" stays disabled). */
  openDecisions: number;
  /** Keys of the proposals "N Buchungen buchen" books, in batch order. */
  bookKeys: string[];
};

export type ReviewWriteFailure = { ok: false; reason: "not-found" };

export type DecideProposalResult = { ok: true } | ReviewWriteFailure;

/** An edit: canonical decimal strings / a business date per field; `""` clears fee or tax to 0. */
export type ProposalEdit = Partial<Record<EditableProposalField, string>>;

export type UpdateProposalResult =
  | { ok: true; proposal: TransactionProposal }
  | ReviewWriteFailure
  /** `issue` is the proposal schema's code, e.g. `quantity-invalid`. */
  | { ok: false; reason: "invalid"; field: EditableProposalField; issue: string };

export type BookImportBatchResult =
  | { ok: true; booked: number; depotId: string }
  | { ok: false; reason: "not-found" | "decisions-open" | "review-changed" | "nothing-to-book" }
  /** The ledger rejected an entry: nothing was booked. `fileName`/`type` name the failing proposal (null for a Depot failure). */
  | { ok: false; reason: "ledger-rejected"; fileName: string | null; type: ProposalType | null; failure: BatchFailure };

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
  /** Extracted text, kept until linking decides whether the file failed; null without text. */
  text: string | null;
};

/** The first `dd.mm.yyyy` in `text` that is a real day, as `YYYY-MM-DD`; `null` without one. */
export function firstDocumentDate(text: string): string | null {
  for (const match of text.matchAll(new RegExp(String.raw`(?<!\d)${DATE_PATTERN}(?!\d)`, "g"))) {
    const date = germanDate(match[0]);
    if (date) return date;
  }
  return null;
}

async function prepare(file: UploadedFile, broker: Broker, deps: ImportDeps): Promise<PreparedItem> {
  const base = { fileName: file.name, fileHash: sha256(file.bytes), text: null };
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
  return { ...base, keep: file.bytes, outcome: parseDocument(broker, text, deps.registry ?? PARSERS), text };
}

/** Normalises a client-supplied file name for display (no path, bounded length). */
function displayName(name: string, position: number): string {
  const base = name.normalize("NFC").split(/[/\\]/).pop()?.trim() ?? "";
  // Truncated by code points so no surrogate pair is cut in half.
  return Array.from(base || `Datei ${position + 1}`).slice(0, 255).join("");
}

/**
 * Stages `files` for Depot `depotId`: one OPEN batch, one item per file in upload order, each PARSED (with
 * validated proposals and an optional review note), NO_BOOKING (with an info) or FAILED (with a German
 * reason). The outcomes of all files are linked first (`linkDocuments`: a comdirect Steuermitteilung is
 * merged into its Ertragsgutschrift). A hash already stored on another item, or seen
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
  const linked = linkDocuments(
    prepared.map((item, position) => ({ fileName: displayName(item.fileName, position), outcome: item.outcome })),
  );

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
        const outcome = linked[position];
        const created = await tx.importItem.create({
          data: {
            batchId: batch.id,
            position,
            fileName: displayName(item.fileName, position),
            fileHash: item.fileHash,
            duplicateUpload: seen.has(item.fileHash),
            status: outcome.status,
            documentType: outcome.status === "FAILED" ? null : outcome.documentType,
            reason: outcome.status === "PARSED" ? (outcome.note ?? null) : outcome.reason,
            proposals: JSON.stringify(outcome.status === "PARSED" ? outcome.proposals : []),
            // First readable date of a file that failed after extraction (prefills manual entry).
            documentDate: outcome.status === "FAILED" && item.text !== null ? firstDocumentDate(item.text) : null,
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

type ItemRow = {
  id: string;
  position: number;
  fileName: string;
  status: ImportItemStatus;
  documentType: string | null;
  reason: string | null;
  duplicateUpload: boolean;
  documentDate: string | null;
  proposals: string;
  decisions: string;
};

type Review = { items: ImportItemView[] } & ReviewCounts;

/**
 * Reads the items' proposals and decisions and classifies every proposal against the Depot's current
 * ledger rows and the rest of the batch (`classifyBatch`). Read-only.
 */
async function reviewItems(depotId: string, rows: readonly ItemRow[], db: ImportDb): Promise<Review> {
  // Sequential: `db` may be an interactive transaction client.
  const transactions = await listTransactions(depotId, db);
  const securities = await listSecurities(db);
  const changes = await listIsinChanges(db);
  const byIsin = new Map(securities.flatMap((security) => (security.isin ? [[security.isin, security] as const] : [])));
  const securityIdByIsin = new Map([...byIsin].map(([isin, security]) => [isin, security.id]));
  const isinChanges: IsinChange[] = changes.map((change) => ({
    oldSecurityId: change.oldSecurity.id,
    newSecurityId: change.newSecurity.id,
    date: change.date,
    oldQuantity: change.oldQuantity,
    newQuantity: change.newQuantity,
  }));
  const ledgerRows = transactions.map((row) => ({ ...row, securityId: row.security?.id ?? null }));

  const read = rows.map((item) => {
    const proposals = readProposals(item.proposals);
    const broken = proposals === null || (item.status === "PARSED" && proposals.length === 0);
    if (broken) console.warn("Import: stored proposals of an item failed validation");
    const status: ImportItemStatus = broken ? "FAILED" : item.status;
    return { item, status, broken, proposals: status === "PARSED" ? (proposals ?? []) : [] };
  });
  const classified = classifyBatch(
    depotId,
    read.map(({ item, status, proposals }) => ({ id: item.id, status, proposals })),
    ledgerRows,
    securityIdByIsin,
    isinChanges,
  );
  const items = read.map(({ item, status, broken, proposals }, itemIndex): ImportItemView => {
    const decisions = readDecisions(item.decisions, proposals.length);
    const classes = classified[itemIndex] ?? [];
    const views = proposals.map((proposal, index): ProposalReviewView => {
      const result = classes[index] ?? { status: "unique" as const, ledgerMatches: [], siblingMatch: false };
      const decision = decisions[index] ?? null;
      const security = proposal.isin ? byIsin.get(proposal.isin) : undefined;
      return {
        key: proposalKey(item.id, index),
        index,
        proposal,
        status: result.status,
        ledgerMatches: result.ledgerMatches.map((match) => {
          const record: Partial<typeof match> = { ...match };
          delete record.securityId;
          return record as TransactionRecord;
        }),
        siblingMatch: result.siblingMatch,
        decision,
        effective: effectiveDecision(result.status, decision),
        securityId: security?.id ?? null,
        securityName: security?.name ?? proposal.name ?? proposal.isin ?? null,
      };
    });
    return {
      id: item.id,
      position: item.position,
      fileName: item.fileName,
      status,
      reviewStatus: itemReviewStatus(status, views.map((view) => view.status)),
      documentType: item.documentType,
      reason: broken ? STORED_PROPOSALS_INVALID_REASON : item.reason,
      duplicateUpload: item.duplicateUpload,
      documentDate: item.documentDate,
      proposals: views,
    };
  });
  return { items, ...reviewCounts(items) };
}

const ITEM_ORDER = { orderBy: { position: "asc" } } as const;

/**
 * A batch with its Depot and items in review (classification, decisions, counts), or `null` for an
 * unknown id or a Depot that no longer exists.
 */
export async function getImportBatch(id: string, db: ImportDb = prisma): Promise<ImportBatchView | null> {
  if (!id) return null;
  const batch = await db.importBatch.findUnique({ where: { id }, include: { items: ITEM_ORDER } });
  if (!batch) return null;
  const depot = await getDepot(batch.depotId, db);
  if (!depot) return null;
  const review = await reviewItems(depot.id, batch.items, db);
  return {
    id: batch.id,
    depotId: depot.id,
    depotName: depot.name,
    broker: depot.broker,
    depotArchived: depot.archived,
    status: batch.status,
    createdAt: batch.createdAt,
    items: review.items,
    files: review.files,
    openDecisions: review.openDecisions,
    bookKeys: review.bookKeys,
  };
}

/** The PARSED item `itemId` of OPEN batch `batchId` with valid proposals, read inside `tx`; `null` otherwise. */
async function openItem(tx: ImportDb, batchId: string, itemId: string) {
  if (!batchId || !itemId) return null;
  const item = await tx.importItem.findFirst({
    where: { id: itemId, batchId, status: "PARSED", batch: { status: "OPEN" } },
    select: { id: true, proposals: true, decisions: true },
  });
  if (!item) return null;
  const proposals = readProposals(item.proposals);
  if (!proposals || proposals.length === 0) return null;
  return { id: item.id, proposals, decisions: readDecisions(item.decisions, proposals.length) };
}

function validIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < length;
}

/**
 * Stores the review decision (`"book"`, `"discard"` or `null` = none) of proposal `index` of item `itemId`.
 * Only OPEN batches; an unknown batch, item or index is `not-found`.
 */
export async function decideProposal(
  batchId: string,
  itemId: string,
  index: number,
  decision: ReviewDecision | null,
  db: ImportDb = prisma,
): Promise<DecideProposalResult> {
  if (decision !== null && decision !== "book" && decision !== "discard") return { ok: false, reason: "not-found" };
  return inTransaction(db, async (tx) => {
    const item = await openItem(tx, batchId, itemId);
    if (!item || !validIndex(index, item.proposals.length)) return { ok: false as const, reason: "not-found" as const };
    const decisions = [...item.decisions];
    decisions[index] = decision;
    await tx.importItem.update({ where: { id: item.id }, data: { decisions: JSON.stringify(decisions) } });
    return { ok: true as const };
  });
}

/**
 * Replaces the editable fields of proposal `index` of item `itemId` (OPEN batches only) after validating the
 * result with `transactionProposalSchema`; type, ISIN and name stay unchanged. The decision is kept.
 */
export async function updateProposal(
  batchId: string,
  itemId: string,
  index: number,
  edit: ProposalEdit,
  db: ImportDb = prisma,
): Promise<UpdateProposalResult> {
  return inTransaction(db, async (tx): Promise<UpdateProposalResult> => {
    const item = await openItem(tx, batchId, itemId);
    const current = item && validIndex(index, item.proposals.length) ? item.proposals[index] : undefined;
    if (!item || !current) return { ok: false, reason: "not-found" };
    const next: Record<string, unknown> = { ...current };
    for (const field of editableFields(current.type)) {
      const value = edit[field];
      if (value === undefined) continue;
      next[field] = value === "" && (field === "fee" || field === "tax") ? "0" : value;
    }
    const parsed = transactionProposalSchema.safeParse(next);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((entry) =>
        (EDITABLE_PROPOSAL_FIELDS as readonly unknown[]).includes(entry.path[0]),
      );
      const field = (issue?.path[0] as EditableProposalField | undefined) ?? editableFields(current.type)[0] ?? "date";
      return { ok: false, reason: "invalid", field, issue: issue?.message ?? `${field}-invalid` };
    }
    const proposals = [...item.proposals];
    proposals[index] = parsed.data;
    await tx.importItem.update({ where: { id: item.id }, data: { proposals: JSON.stringify(proposals) } });
    return { ok: true, proposal: parsed.data };
  });
}

/** Thrown inside the booking transaction when the batch is no longer OPEN or the review changed. */
class BookingAbort extends Error {
  constructor(readonly reason: "not-found" | "review-changed") {
    super(`import booking aborted: ${reason}`);
  }
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((key) => set.has(key));
}

/**
 * Books OPEN batch `batchId` (story 5.3): recomputes the review against the current ledger, refuses open
 * decisions (`decisions-open`), a set of proposals to book other than `expectedKeys` (`review-changed`, the
 * user saw another set) and an empty set (`nothing-to-book`). Then, in ONE DB transaction through
 * `ledger.recordBatch`, claims the batch OPEN→BOOKED (fails → `not-found`, nothing booked), clears the
 * items' stored files, ensures the Securities and books the accepted proposals ordered by (date, item
 * position, index) with `allowDuplicate` (the review decided). A ledger failure rolls back everything
 * (batch stays OPEN, PDFs kept). After the commit the batch's PDFs are deleted; item rows stay.
 */
export async function bookImportBatch(
  batchId: string,
  expectedKeys: readonly string[],
  deps: Pick<ImportDeps, "env"> = {},
  db: ImportDb = prisma,
): Promise<BookImportBatchResult> {
  if (!batchId) return { ok: false, reason: "not-found" };
  const batch = await db.importBatch.findFirst({ where: { id: batchId, status: "OPEN" }, include: { items: ITEM_ORDER } });
  if (!batch) return { ok: false, reason: "not-found" };
  const review = await reviewItems(batch.depotId, batch.items, db);
  if (review.openDecisions > 0) return { ok: false, reason: "decisions-open" };
  if (!sameKeys(review.bookKeys, expectedKeys)) return { ok: false, reason: "review-changed" };
  if (review.bookKeys.length === 0) return { ok: false, reason: "nothing-to-book" };

  type Accepted = { fileName: string; position: number; view: ProposalReviewView };
  const accepted: Accepted[] = review.items.flatMap((item) =>
    item.proposals
      .filter((view) => view.effective === "book")
      .map((view) => ({ fileName: item.fileName, position: item.position, view })),
  );
  accepted.sort(
    (a, b) =>
      (a.view.proposal.date < b.view.proposal.date ? -1 : a.view.proposal.date > b.view.proposal.date ? 1 : 0) ||
      a.position - b.position ||
      a.view.index - b.view.index,
  );
  const securities = new Map<string, BatchSecurity>();
  for (const { view } of accepted) {
    const { isin, name } = view.proposal;
    if (!isin || securities.has(isin)) continue;
    const securityName = name ?? isin;
    securities.set(isin, {
      ref: isin,
      identifier: { isin },
      details: { name: securityName, assetType: classifySecurityName(securityName) },
    });
  }
  const entries: BatchEntry[] = accepted.map(({ view }) => {
    const { proposal } = view;
    return {
      kind: "transaction",
      ref: view.key,
      securityRef: proposal.isin ?? null,
      input: {
        type: proposal.type,
        date: proposal.date,
        quantity: proposal.quantity,
        price: proposal.price,
        amount: proposal.amount,
        fee: proposal.fee,
        tax: proposal.tax,
        allowDuplicate: true,
      },
    };
  });

  let result: Awaited<ReturnType<typeof recordBatch>>;
  try {
    result = await recordBatch({ depotId: batch.depotId, securities: [...securities.values()], entries }, db, {
      beforeEntries: async (tx) => {
        const claimed = await tx.importBatch.updateMany({ where: { id: batch.id, status: "OPEN" }, data: { status: "BOOKED" } });
        if (claimed.count !== 1) throw new BookingAbort("not-found");
        // The review may have changed between the read above and this transaction (e.g. a manual entry).
        const current = await reviewItems(batch.depotId, await tx.importItem.findMany({ where: { batchId: batch.id }, ...ITEM_ORDER }), tx);
        if (current.openDecisions > 0 || !sameKeys(current.bookKeys, review.bookKeys)) throw new BookingAbort("review-changed");
        await tx.importItem.updateMany({ where: { batchId: batch.id }, data: { storedFile: null } });
      },
    });
  } catch (error) {
    if (error instanceof BookingAbort) return { ok: false, reason: error.reason };
    throw error;
  }
  if (!result.ok) {
    const failing = accepted.find(({ view }) => view.key === result.ref) ?? accepted.find(({ view }) => view.proposal.isin === result.ref);
    console.warn(`Import: booking a batch was rejected by the ledger (${result.failure.reason})`);
    return {
      ok: false,
      reason: "ledger-rejected",
      fileName: failing?.fileName ?? null,
      type: failing?.view.proposal.type ?? null,
      failure: result.failure,
    };
  }
  deleteBatchDir(importsDir(deps.env ?? process.env), batch.id);
  return { ok: true, booked: entries.length, depotId: batch.depotId };
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
    const failedCount = batch.items.filter((item) => item.status === "FAILED").length;
    return [
      {
        id: batch.id,
        depotId: depot.id,
        depotName: depot.name,
        broker: depot.broker,
        createdAt: batch.createdAt,
        fileCount: batch.items.length,
        parsedCount,
        failedCount,
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
