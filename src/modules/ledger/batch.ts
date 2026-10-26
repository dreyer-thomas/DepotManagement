/**
 * Batch write (AD-3, AD-16): ensures Securities and books Transactions, splits and ISIN changes in the given
 * order through the ledger's single write path, inside ONE DB transaction. The first failing item aborts
 * and rolls back everything. Used by the Parqet migration (story 2.4).
 */
import { prisma } from "@/db";
import {
  type IsinChangeRecord,
  type IsinChangeResult,
  recordIsinChange,
  recordSplit,
  type SplitRecord,
  type SplitResult,
} from "./corporate-actions";
import type { LedgerDb } from "./depots";
import {
  ensureSecurity,
  type SecurityDetailsInput,
  type SecurityIdentifierInput,
  type SecurityResult,
  type SecuritySummary,
} from "./securities";
import {
  recordTransaction,
  type RecordTransactionInput,
  type RecordTransactionResult,
  type TransactionRecord,
} from "./transactions";

/** Long enough for multi-year files (each booked row re-reads the Depot's trades for the holding guard). */
export const BATCH_TIMEOUT_MS = 300_000;

export type BatchSecurity = { ref: string; identifier: SecurityIdentifierInput; details: SecurityDetailsInput };

/** A Transaction of the batch Depot; `securityRef` names one of the batch's Securities (or none). */
export type BatchTransactionEntry = {
  kind: "transaction";
  ref: string;
  securityRef: string | null;
  input: Omit<RecordTransactionInput, "depotId" | "security">;
};

/** An ISIN change between two of the batch's Securities. */
export type BatchIsinChangeEntry = {
  kind: "isin-change";
  ref: string;
  oldSecurityRef: string;
  newSecurityRef: string;
  date: string;
  oldQuantity: string;
  newQuantity: string;
};

/** A stock split of one of the batch's Securities; `ratio` is `old:new` text (e.g. `1:4`). */
export type BatchSplitEntry = {
  kind: "split";
  ref: string;
  securityRef: string;
  date: string;
  ratio: string;
};

export type BatchEntry = BatchTransactionEntry | BatchIsinChangeEntry | BatchSplitEntry;

export type RecordBatchInput = { depotId: string; securities: BatchSecurity[]; entries: BatchEntry[] };

/** Why the batch failed: the failing item's ledger result (no write happened). */
export type BatchFailure =
  | { ok: false; reason: "depot-not-found" | "depot-archived" }
  | { ok: false; reason: "security-ref-unknown" }
  | Extract<SecurityResult, { ok: false }>
  | Extract<RecordTransactionResult, { ok: false }>
  | Extract<IsinChangeResult, { ok: false }>
  | Extract<SplitResult, { ok: false }>;

export type RecordBatchResult =
  | {
      ok: true;
      securities: Record<string, SecuritySummary>;
      transactions: Record<string, TransactionRecord>;
      isinChanges: Record<string, IsinChangeRecord>;
      splits: Record<string, SplitRecord>;
    }
  /** `ref` is the failing Security's or entry's ref, `"depot"` for a Depot failure. */
  | { ok: false; ref: string; failure: BatchFailure };

/** Thrown inside the DB transaction to roll it back; carries the typed failure out. */
class BatchAbort extends Error {
  constructor(
    readonly ref: string,
    readonly failure: BatchFailure,
  ) {
    super(`batch aborted at ${ref}`);
  }
}

/** Options of `recordBatch`. */
export type RecordBatchOptions = {
  /**
   * Runs first inside the batch's DB transaction, before the Depot check and any ledger write, with the
   * transaction client (e.g. import claims its batch OPEN→BOOKED here so claim and booking commit together).
   * A throw rolls back everything and propagates to the caller unchanged.
   */
  beforeEntries?: (tx: LedgerDb) => Promise<void>;
};

async function apply(input: RecordBatchInput, tx: LedgerDb, options: RecordBatchOptions) {
  if (options.beforeEntries) await options.beforeEntries(tx);
  const depot = await tx.depot.findUnique({ where: { id: input.depotId }, select: { archived: true } });
  if (!depot) throw new BatchAbort("depot", { ok: false, reason: "depot-not-found" });
  if (depot.archived) throw new BatchAbort("depot", { ok: false, reason: "depot-archived" });

  const securities: Record<string, SecuritySummary> = {};
  for (const security of input.securities) {
    const result = await ensureSecurity(security.identifier, security.details, tx);
    if (!result.ok) throw new BatchAbort(security.ref, result);
    securities[security.ref] = result.security;
  }
  const idOf = (entryRef: string, securityRef: string): string => {
    const security = securities[securityRef];
    if (!security) throw new BatchAbort(entryRef, { ok: false, reason: "security-ref-unknown" });
    return security.id;
  };

  const transactions: Record<string, TransactionRecord> = {};
  const isinChanges: Record<string, IsinChangeRecord> = {};
  const splits: Record<string, SplitRecord> = {};
  for (const entry of input.entries) {
    if (entry.kind === "transaction") {
      const result = await recordTransaction(
        {
          ...entry.input,
          depotId: input.depotId,
          security: entry.securityRef === null ? null : { id: idOf(entry.ref, entry.securityRef) },
        },
        tx,
      );
      if (!result.ok) throw new BatchAbort(entry.ref, result);
      transactions[entry.ref] = result.transaction;
    } else if (entry.kind === "split") {
      const result = await recordSplit(
        { securityId: idOf(entry.ref, entry.securityRef), date: entry.date, ratio: entry.ratio },
        tx,
      );
      if (!result.ok) throw new BatchAbort(entry.ref, result);
      splits[entry.ref] = result.split;
    } else {
      const result = await recordIsinChange(
        {
          oldSecurityId: idOf(entry.ref, entry.oldSecurityRef),
          newSecurity: { id: idOf(entry.ref, entry.newSecurityRef) },
          date: entry.date,
          oldQuantity: entry.oldQuantity,
          newQuantity: entry.newQuantity,
        },
        tx,
      );
      if (!result.ok) throw new BatchAbort(entry.ref, result);
      isinChanges[entry.ref] = result.isinChange;
    }
  }
  return { ok: true as const, securities, transactions, isinChanges, splits };
}

/**
 * Ensures `securities` (idempotent `ensureSecurity`), then books `entries` in the given order into
 * Depot `depotId` via `recordTransaction` / `recordSplit` / `recordIsinChange` (the ledger assigns sequences, appended
 * per date). All in one DB transaction with a long timeout: the first failing item aborts and rolls back
 * everything and is returned by its `ref`. Duplicate handling is the entry's `allowDuplicate`. Called with
 * a transaction client, it runs inside it and a failure throws so the caller's transaction rolls back.
 * `options.beforeEntries` runs first inside the same DB transaction; its throw rolls back and propagates.
 */
export async function recordBatch(
  input: RecordBatchInput,
  db: LedgerDb = prisma,
  options: RecordBatchOptions = {},
): Promise<RecordBatchResult> {
  const client = db as LedgerDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction !== "function") return apply(input, db, options);
  try {
    return await client.$transaction((tx) => apply(input, tx, options), { timeout: BATCH_TIMEOUT_MS, maxWait: 10_000 });
  } catch (error) {
    if (error instanceof BatchAbort) return { ok: false, ref: error.ref, failure: error.failure };
    throw error;
  }
}
