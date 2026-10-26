/**
 * Depot reconciliation against a broker statement (story 2.9). Runs and their rows are user-entered
 * ledger data (statement values, checks), never derived; app values are computed on read by
 * `core/reconciliation` for the statement date. Corrections are booked through `recordTransaction`.
 */
import { prisma } from "@/db";
import { isBusinessDate } from "@/core/dates";
import { canonicalDecimal, ExactDecimal, isDecimalString } from "@/core/decimal";
import {
  type ReconciliationLedgerRow,
  type ReconciliationProgress,
  type ReconciliationRowView,
  reconciliationRows,
} from "@/core/reconciliation";
import { loadCorporateActions } from "./corporate-actions";
import { inTransaction, type LedgerDb } from "./depots";
import { securityLineage } from "./positions";
import type { SecuritySummary } from "./securities";
import {
  QUANTITY_MAX_DECIMALS,
  recordTransaction,
  type RecordTransactionResult,
  type TransactionRecord,
} from "./transactions";

/** Note of a cash correction booked by the reconciliation. */
export const RECONCILIATION_NOTE = "Kontoabgleich";

export type ReconciliationFailureReason =
  | "depot-not-found"
  | "depot-archived"
  | "date-invalid"
  | "date-in-future"
  | "run-open"
  | "run-not-found"
  | "run-finished"
  | "row-not-found"
  | "value-invalid"
  | "price-invalid"
  | "no-difference";

/** One row of a run with its Security (`null` = the Cash Account). */
export type ReconciliationRowRecord = ReconciliationRowView & {
  security: SecuritySummary | null;
  /** Default unit cost of a positive correction: the average purchase price, 8 decimals; `null` without one. */
  defaultUnitCost: string | null;
};

/** Decimal places of the default unit cost (the average purchase price may not terminate). */
const UNIT_COST_DECIMALS = 8;

function defaultUnitCost(averagePrice: string | null): string | null {
  if (averagePrice === null) return null;
  return canonicalDecimal(new ExactDecimal(averagePrice).toDecimalPlaces(UNIT_COST_DECIMALS, ExactDecimal.ROUND_HALF_UP));
}

/** An open run as shown on the reconcile page (computed on read from the user's entries). */
export type ReconciliationRunView = {
  id: string;
  depotId: string;
  statementDate: string;
  rows: ReconciliationRowRecord[];
  progress: ReconciliationProgress;
};

export type ReconciliationOverview = {
  /** The Depot's open run, or `null`. */
  run: ReconciliationRunView | null;
  /** Statement date of the most recently finished run; `null` when none finished. */
  lastReconciled: string | null;
};

export type OpenReconciliationResult =
  | { ok: true; runId: string }
  | { ok: false; reason: "depot-not-found" | "depot-archived" | "date-invalid" | "date-in-future" | "run-open" };

export type SaveReconciliationRowInput = {
  /** Entered statement value (quantity or EUR balance); `null`/"" clears it, `undefined` keeps it. */
  statementValue?: unknown;
  /** The "stimmt" check; `undefined` keeps it. */
  checked?: unknown;
};

export type SaveReconciliationRowResult =
  | { ok: true }
  | { ok: false; reason: "run-not-found" | "run-finished" | "depot-archived" | "row-not-found" | "value-invalid" };

export type FinishReconciliationResult =
  | { ok: true; statementDate: string }
  | { ok: false; reason: "run-not-found" | "run-finished" | "depot-archived" };

export type BookReconciliationCorrectionResult =
  | { ok: true; transaction: TransactionRecord }
  | { ok: false; reason: "run-not-found" | "run-finished" | "depot-archived" | "row-not-found" | "price-invalid" | "no-difference" }
  | Exclude<RecordTransactionResult, { ok: true }>;

const SECURITY_SELECT = { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true } as const;

const LEDGER_SELECT = {
  securityId: true,
  type: true,
  date: true,
  sequence: true,
  quantity: true,
  price: true,
  amount: true,
  fee: true,
  tax: true,
} as const;

type RunRow = { id: string; depotId: string; statementDate: string; status: "OPEN" | "FINISHED"; archived: boolean };

/** The run with its Depot's archive flag, or `null`. */
async function findRun(runId: unknown, db: LedgerDb): Promise<RunRow | null> {
  if (typeof runId !== "string" || runId === "") return null;
  const run = await db.reconciliationRun.findUnique({
    where: { id: runId },
    select: { id: true, depotId: true, statementDate: true, status: true, depot: { select: { archived: true } } },
  });
  if (!run) return null;
  return { id: run.id, depotId: run.depotId, statementDate: run.statementDate, status: run.status, archived: run.depot.archived };
}

/** A run that may be written: exists, still OPEN, its Depot not archived. */
async function writableRun(
  runId: unknown,
  db: LedgerDb,
): Promise<{ ok: true; run: RunRow } | { ok: false; reason: "run-not-found" | "run-finished" | "depot-archived" }> {
  const run = await findRun(runId, db);
  if (!run) return { ok: false, reason: "run-not-found" };
  if (run.status !== "OPEN") return { ok: false, reason: "run-finished" };
  if (run.archived) return { ok: false, reason: "depot-archived" };
  return { ok: true, run };
}

/** The run's rows computed for its statement date, with Securities. */
async function runRows(
  run: Pick<RunRow, "id" | "depotId" | "statementDate">,
  db: LedgerDb,
): Promise<{ rows: ReconciliationRowRecord[]; progress: ReconciliationProgress }> {
  const [ledger, saved, actions] = await Promise.all([
    db.transaction.findMany({ where: { depotId: run.depotId }, select: LEDGER_SELECT }) as Promise<ReconciliationLedgerRow[]>,
    db.reconciliationRow.findMany({ where: { runId: run.id }, select: { securityId: true, statementValue: true, checked: true } }),
    loadCorporateActions(db),
  ]);
  const securityIds = new Set<string>();
  for (const row of ledger) if (row.securityId) securityIds.add(row.securityId);
  for (const row of saved) if (row.securityId) securityIds.add(row.securityId);
  const securities = await db.security.findMany({
    where: { id: { in: securityLineage(securityIds, actions) } },
    select: SECURITY_SELECT,
  });
  const byId = new Map(securities.map((security) => [security.id, security]));
  const names = new Map(securities.map((security) => [security.id, security.name]));
  const { rows, progress } = reconciliationRows(ledger, actions, run.statementDate, saved, names);
  return {
    rows: rows.map((row) => ({
      ...row,
      security: row.securityId === null ? null : (byId.get(row.securityId) ?? null),
      defaultUnitCost: defaultUnitCost(row.averagePrice),
    })),
    progress,
  };
}

/**
 * The Depot's open run (statement date, rows with app values on that date, progress) or `null`, plus the
 * statement date of its most recently finished run. Read-only.
 */
export async function getReconciliation(depotId: string, db: LedgerDb = prisma): Promise<ReconciliationOverview> {
  const [open, finished] = await Promise.all([
    db.reconciliationRun.findFirst({
      where: { depotId, status: "OPEN" },
      orderBy: { createdAt: "desc" },
      select: { id: true, depotId: true, statementDate: true },
    }),
    db.reconciliationRun.findFirst({
      where: { depotId, status: "FINISHED" },
      orderBy: [{ finishedAt: "desc" }, { createdAt: "desc" }],
      select: { statementDate: true },
    }),
  ]);
  return {
    run: open ? { ...open, ...(await runRows(open, db)) } : null,
    lastReconciled: finished?.statementDate ?? null,
  };
}

/**
 * Starts a run of a non-archived Depot for `statementDate` (≤ `today`); at most one open run per Depot
 * (`run-open`). One DB transaction.
 */
export async function openReconciliation(
  depotId: string,
  statementDate: unknown,
  today: string,
  db: LedgerDb = prisma,
): Promise<OpenReconciliationResult> {
  if (!isBusinessDate(statementDate)) return { ok: false, reason: "date-invalid" };
  if (statementDate > today) return { ok: false, reason: "date-in-future" };
  return inTransaction(db, async (tx): Promise<OpenReconciliationResult> => {
    const depot = await tx.depot.findUnique({ where: { id: typeof depotId === "string" ? depotId : "" }, select: { id: true, archived: true } });
    if (!depot) return { ok: false, reason: "depot-not-found" };
    if (depot.archived) return { ok: false, reason: "depot-archived" };
    const open = await tx.reconciliationRun.findFirst({ where: { depotId: depot.id, status: "OPEN" }, select: { id: true } });
    if (open) return { ok: false, reason: "run-open" };
    const run = await tx.reconciliationRun.create({
      data: { depotId: depot.id, statementDate, createdAt: new Date().toISOString() },
      select: { id: true },
    });
    return { ok: true, runId: run.id };
  });
}

/** Parses an entered statement value: Position ≥ 0 with ≤ 8 decimals, cash any decimal; `""`/`null` clears. */
function parseStatementValue(value: unknown, isCash: boolean): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === "") return { ok: true, value: null };
  if (!isDecimalString(value)) return { ok: false };
  const parsed = new ExactDecimal(value);
  if (!isCash && (parsed.isNegative() || parsed.decimalPlaces() > QUANTITY_MAX_DECIMALS)) return { ok: false };
  return { ok: true, value: canonicalDecimal(parsed) };
}

/**
 * Saves the user's entries of one row (`securityId` null = the Cash Account): the statement value
 * and/or the "stimmt" check; omitted fields stay. The Security must be a row of the run (held on the
 * statement date or saved before), else `row-not-found`. One DB transaction.
 */
export async function saveReconciliationRow(
  runId: string,
  securityId: string | null,
  input: SaveReconciliationRowInput,
  db: LedgerDb = prisma,
): Promise<SaveReconciliationRowResult> {
  return inTransaction(db, async (tx): Promise<SaveReconciliationRowResult> => {
    const writable = await writableRun(runId, tx);
    if (!writable.ok) return writable;
    const { run } = writable;
    const isCash = securityId === null;
    const statementValue = input.statementValue === undefined ? undefined : parseStatementValue(input.statementValue, isCash);
    if (statementValue && !statementValue.ok) return { ok: false, reason: "value-invalid" };
    if (input.checked !== undefined && typeof input.checked !== "boolean") return { ok: false, reason: "value-invalid" };

    if (!isCash) {
      const { rows } = await runRows(run, tx);
      if (!rows.some((row) => row.securityId === securityId)) return { ok: false, reason: "row-not-found" };
    }
    const data = {
      ...(statementValue ? { statementValue: statementValue.value } : {}),
      ...(input.checked === undefined ? {} : { checked: input.checked as boolean }),
    };
    // SQLite NULLs are distinct in the unique index: look the row (also the cash row) up explicitly.
    const existing = await tx.reconciliationRow.findFirst({ where: { runId: run.id, securityId }, select: { id: true } });
    if (existing) await tx.reconciliationRow.update({ where: { id: existing.id }, data });
    else await tx.reconciliationRow.create({ data: { runId: run.id, securityId, ...data } });
    return { ok: true };
  });
}

/** Finishes an open run ("Abgleich abschließen") at `now` (UTC ISO timestamp). One DB transaction. */
export async function finishReconciliation(runId: string, now: string, db: LedgerDb = prisma): Promise<FinishReconciliationResult> {
  return inTransaction(db, async (tx): Promise<FinishReconciliationResult> => {
    const writable = await writableRun(runId, tx);
    if (!writable.ok) return writable;
    await tx.reconciliationRun.update({ where: { id: writable.run.id }, data: { status: "FINISHED", finishedAt: now } });
    return { ok: true, statementDate: writable.run.statementDate };
  });
}

/**
 * Books the correction of a differing row on the statement date through `recordTransaction` (same DB
 * transaction, duplicates allowed): a Position gets an ADJUSTMENT of `statement − app` at `unitCost`
 * (default: the Position's average purchase price on the statement date, rounded to 8 decimals;
 * `price-invalid` when a positive
 * correction has neither); the Cash Account a DEPOSIT (difference > 0) or WITHDRAWAL of the exact
 * |difference| with the note "Kontoabgleich". `no-difference` when the row has no statement value or
 * matches.
 */
export async function bookReconciliationCorrection(
  runId: string,
  securityId: string | null,
  unitCost?: unknown,
  db: LedgerDb = prisma,
): Promise<BookReconciliationCorrectionResult> {
  return inTransaction(db, async (tx): Promise<BookReconciliationCorrectionResult> => {
    const writable = await writableRun(runId, tx);
    if (!writable.ok) return writable;
    const { run } = writable;
    const { rows } = await runRows(run, tx);
    const row = rows.find((candidate) => candidate.securityId === securityId);
    if (!row) return { ok: false, reason: "row-not-found" };
    if (row.difference === null) return { ok: false, reason: "no-difference" };
    const difference = new ExactDecimal(row.difference);
    const matches = securityId === null ? difference.abs().lessThan("0.005") : difference.isZero();
    if (matches) return { ok: false, reason: "no-difference" };

    if (securityId === null) {
      return recordTransaction(
        {
          depotId: run.depotId,
          type: difference.isPositive() ? "DEPOSIT" : "WITHDRAWAL",
          date: run.statementDate,
          amount: canonicalDecimal(difference.abs()),
          note: RECONCILIATION_NOTE,
          allowDuplicate: true,
        },
        tx,
      );
    }

    let price: string | undefined;
    if (difference.isPositive()) {
      if (unitCost !== undefined && unitCost !== null && unitCost !== "") {
        if (!isDecimalString(unitCost) || new ExactDecimal(unitCost).isNegative()) return { ok: false, reason: "price-invalid" };
        price = canonicalDecimal(unitCost);
      } else if (row.defaultUnitCost !== null) {
        price = row.defaultUnitCost;
      } else {
        return { ok: false, reason: "price-invalid" };
      }
    }
    return recordTransaction(
      {
        depotId: run.depotId,
        type: "ADJUSTMENT",
        date: run.statementDate,
        quantity: canonicalDecimal(difference),
        price,
        security: { id: securityId },
        allowDuplicate: true,
      },
      tx,
    );
  });
}
