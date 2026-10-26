import { z } from "zod";
import { prisma } from "@/db";
import { Broker, Prisma } from "@/db/generated/prisma/client";
import { type ArchiveRow, canArchive, heldSecurities } from "@/core/archive";
import { cashBalance } from "@/core/cash";
import { type CorporateActions, NO_CORPORATE_ACTIONS } from "@/core/corporate-actions";
import { businessDate } from "@/core/dates";
import { loadCorporateActions } from "./corporate-actions";

export type { Broker } from "@/db/generated/prisma/client";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type LedgerDb = Prisma.TransactionClient;

/** All Brokers in declaration order. */
export const BROKERS = Object.values(Broker) as [Broker, ...Broker[]];

export const DEPOT_NAME_MAX_LENGTH = 60;

export type DepotSummary = {
  id: string;
  name: string;
  broker: Broker;
  /** Cash Account balance as a decimal string; computed on read, never stored. */
  cashBalance: string;
  /** Archived Depots are read-only and left out of Portfolio figures (AD-17). */
  archived: boolean;
  /** True when the Depot may be archived (no open Positions, cash rounds to 0,00 €); computed on read, never stored. */
  archivable: boolean;
  /** Number of the Depot's Transactions (all dates); computed on read, never stored. */
  transactionCount: number;
};

export type DepotFailureReason = "name-empty" | "name-too-long" | "name-taken" | "broker-invalid" | "not-found" | "depot-archived";

export type DepotResult = { ok: true; depot: DepotSummary } | { ok: false; reason: DepotFailureReason };

export type ArchiveDepotFailureReason = "not-found" | "depot-not-flat";

export type ArchiveDepotResult = { ok: true; depot: DepotSummary } | { ok: false; reason: ArchiveDepotFailureReason };

export type UnarchiveDepotResult = { ok: true; depot: DepotSummary } | { ok: false; reason: "not-found" };

export type DeleteDepotResult = { ok: true; deleted: { transactions: number } } | { ok: false; reason: "not-found" };

export const depotNameSchema = z
  .string({ error: "name-empty" })
  .normalize("NFC")
  .trim()
  .min(1, { error: "name-empty" })
  .max(DEPOT_NAME_MAX_LENGTH, { error: "name-too-long" });

export const brokerSchema = z.enum(BROKERS, { error: "broker-invalid" });

export type CreateDepotInput = { name: unknown; broker: unknown };
export type RenameDepotInput = { name: unknown };

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: DepotFailureReason };

function parse<T>(schema: z.ZodType<T>, value: unknown): Parsed<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, reason: result.error.issues[0].message as DepotFailureReason };
}

function nameKey(name: string): string {
  return name.normalize("NFC").toLocaleLowerCase("de-DE");
}

/** True when another Depot (other than `exceptId`) already has this name, ignoring case. */
async function isNameTaken(db: LedgerDb, name: string, exceptId?: string): Promise<boolean> {
  const key = nameKey(name);
  const existing = await db.depot.findMany({ select: { id: true, name: true } });
  return existing.some((depot) => depot.id !== exceptId && nameKey(depot.name) === key);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const ROW_SELECT = {
  type: true,
  date: true,
  sequence: true,
  amount: true,
  fee: true,
  tax: true,
  securityId: true,
  quantity: true,
} as const;

type DepotRow = { id: string; name: string; broker: Broker; archived: boolean };

/** Today's Europe/Berlin business date. */
function today(): string {
  return businessDate(new Date());
}

/** Cash balance as of today (future-dated rows excluded) and the archive guard. */
function toSummary(depot: DepotRow, rows: readonly ArchiveRow[], actions: CorporateActions): DepotSummary {
  const asOf = today();
  return {
    id: depot.id,
    name: depot.name,
    broker: depot.broker,
    cashBalance: cashBalance(rows, asOf),
    archived: depot.archived,
    archivable: canArchive(rows, asOf, actions),
    transactionCount: rows.length,
  };
}

async function depotRows(db: LedgerDb, depotId: string): Promise<ArchiveRow[]> {
  return db.transaction.findMany({ where: { depotId }, select: ROW_SELECT });
}

/** Runs `write` in one DB transaction: its own, unless `db` already is one. */
export async function inTransaction<T>(db: LedgerDb, write: (tx: LedgerDb) => Promise<T>): Promise<T> {
  const client = db as LedgerDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") return client.$transaction((tx) => write(tx));
  return write(db);
}

/** Creates a Depot; the name is trimmed and must be unique (case-insensitive). */
export async function createDepot(input: CreateDepotInput, db: LedgerDb = prisma): Promise<DepotResult> {
  const name = parse(depotNameSchema, input.name);
  if (!name.ok) return name;
  const broker = parse(brokerSchema, input.broker);
  if (!broker.ok) return broker;
  if (await isNameTaken(db, name.value)) return { ok: false, reason: "name-taken" };
  try {
    const depot = await db.depot.create({ data: { name: name.value, broker: broker.value } });
    return { ok: true, depot: toSummary(depot, [], NO_CORPORATE_ACTIONS) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "name-taken" };
    throw error;
  }
}

/** Renames a Depot; renaming to its own name in any case is allowed. The Broker never changes. */
export async function renameDepot(id: string, input: RenameDepotInput, db: LedgerDb = prisma): Promise<DepotResult> {
  const name = parse(depotNameSchema, input.name);
  if (!name.ok) return name;
  const current = await db.depot.findUnique({ where: { id } });
  if (!current) return { ok: false, reason: "not-found" };
  if (current.archived) return { ok: false, reason: "depot-archived" };
  if (await isNameTaken(db, name.value, id)) return { ok: false, reason: "name-taken" };
  try {
    const depot = await db.depot.update({ where: { id }, data: { name: name.value } });
    return { ok: true, depot: toSummary(depot, await depotRows(db, id), await loadCorporateActions(db)) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "name-taken" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { ok: false, reason: "not-found" };
    }
    throw error;
  }
}

/**
 * Archives a Depot (AD-17): refused with `depot-not-flat` while it has open Positions or non-zero
 * cash (today or after its last row). Archiving an archived Depot is a no-op. One DB transaction.
 */
export async function archiveDepot(id: string, db: LedgerDb = prisma): Promise<ArchiveDepotResult> {
  return inTransaction(db, async (tx): Promise<ArchiveDepotResult> => {
    const current = await tx.depot.findUnique({ where: { id } });
    if (!current) return { ok: false, reason: "not-found" };
    const rows = await depotRows(tx, current.id);
    const actions = await loadCorporateActions(tx);
    if (current.archived) return { ok: true, depot: toSummary(current, rows, actions) };
    if (!canArchive(rows, today(), actions)) return { ok: false, reason: "depot-not-flat" };
    const depot = await tx.depot.update({ where: { id: current.id }, data: { archived: true } });
    return { ok: true, depot: toSummary(depot, rows, actions) };
  });
}

/** Reactivates an archived Depot; idempotent. */
export async function unarchiveDepot(id: string, db: LedgerDb = prisma): Promise<UnarchiveDepotResult> {
  return inTransaction(db, async (tx): Promise<UnarchiveDepotResult> => {
    const current = await tx.depot.findUnique({ where: { id } });
    if (!current) return { ok: false, reason: "not-found" };
    const depot = current.archived
      ? await tx.depot.update({ where: { id: current.id }, data: { archived: false } })
      : current;
    return { ok: true, depot: toSummary(depot, await depotRows(tx, current.id), await loadCorporateActions(tx)) };
  });
}

/**
 * Deletes a Depot (active or archived) and everything scoped to it, in one DB transaction: all its
 * Transactions, then the Depot. Securities, their CorporateActions and Prices, and every other Depot's
 * rows stay untouched. Irreversible. Import staging rows (owned by `import`) cascade with the Depot; the
 * delete action discards them through `import` first so their PDFs go too.
 */
export async function deleteDepot(id: string, db: LedgerDb = prisma): Promise<DeleteDepotResult> {
  return inTransaction(db, async (tx): Promise<DeleteDepotResult> => {
    const current = await tx.depot.findUnique({ where: { id }, select: { id: true } });
    if (!current) return { ok: false, reason: "not-found" };
    const { count } = await tx.transaction.deleteMany({ where: { depotId: current.id } });
    await tx.depot.delete({ where: { id: current.id } });
    return { ok: true, deleted: { transactions: count } };
  });
}

/**
 * Securities held as of `asOf` (open Positions in non-archived Depots, `core/archive`
 * `heldSecurities`), as sorted Security ids. Consumed by prices, news and composition (Epics 3+).
 */
export async function listHeldSecurities(asOf: string, db: LedgerDb = prisma): Promise<string[]> {
  const [depots, trades, actions] = await Promise.all([
    db.depot.findMany({ select: { id: true, archived: true } }),
    db.transaction.findMany({
      where: { type: { in: ["BUY", "SELL"] } },
      select: { depotId: true, securityId: true, type: true, date: true, quantity: true },
    }),
    loadCorporateActions(db),
  ]);
  return heldSecurities({ depots, trades }, asOf, actions);
}

/** All Depots (archived ones included) sorted by name (de-DE collation). */
export async function listDepots(db: LedgerDb = prisma): Promise<DepotSummary[]> {
  const [depots, rows, actions] = await Promise.all([
    db.depot.findMany(),
    db.transaction.findMany({ select: { depotId: true, ...ROW_SELECT } }),
    loadCorporateActions(db),
  ]);
  const byDepot = new Map<string, ArchiveRow[]>();
  for (const row of rows) {
    const list = byDepot.get(row.depotId);
    if (list) list.push(row);
    else byDepot.set(row.depotId, [row]);
  }
  return depots
    .map((depot) => toSummary(depot, byDepot.get(depot.id) ?? [], actions))
    .sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
}

/** One Depot, or null when the id is unknown. */
export async function getDepot(id: string, db: LedgerDb = prisma): Promise<DepotSummary | null> {
  const depot = await db.depot.findUnique({ where: { id } });
  return depot ? toSummary(depot, await depotRows(db, id), await loadCorporateActions(db)) : null;
}
