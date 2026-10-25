import { z } from "zod";
import { prisma } from "@/db";
import { Broker, Prisma } from "@/db/generated/prisma/client";
import { cashBalance, type CashRow } from "@/core/cash";
import { businessDate } from "@/core/dates";

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
};

export type DepotFailureReason = "name-empty" | "name-too-long" | "name-taken" | "broker-invalid" | "not-found";

export type DepotResult = { ok: true; depot: DepotSummary } | { ok: false; reason: DepotFailureReason };

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

const CASH_SELECT = { type: true, date: true, sequence: true, amount: true, fee: true, tax: true } as const;

/** Cash balance as of today's Europe/Berlin business date (future-dated rows excluded). */
function currentBalance(rows: readonly CashRow[]): string {
  return cashBalance(rows, businessDate(new Date()));
}

function toSummary(depot: { id: string; name: string; broker: Broker }, rows: readonly CashRow[]): DepotSummary {
  return { id: depot.id, name: depot.name, broker: depot.broker, cashBalance: currentBalance(rows) };
}

async function cashRows(db: LedgerDb, depotId: string): Promise<CashRow[]> {
  return db.transaction.findMany({ where: { depotId }, select: CASH_SELECT });
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
    return { ok: true, depot: toSummary(depot, []) };
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
  if (await isNameTaken(db, name.value, id)) return { ok: false, reason: "name-taken" };
  try {
    const depot = await db.depot.update({ where: { id }, data: { name: name.value } });
    return { ok: true, depot: toSummary(depot, await cashRows(db, id)) };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "name-taken" };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { ok: false, reason: "not-found" };
    }
    throw error;
  }
}

/** All Depots sorted by name (de-DE collation). */
export async function listDepots(db: LedgerDb = prisma): Promise<DepotSummary[]> {
  const [depots, rows] = await Promise.all([
    db.depot.findMany(),
    db.transaction.findMany({ select: { depotId: true, ...CASH_SELECT } }),
  ]);
  const byDepot = new Map<string, CashRow[]>();
  for (const row of rows) {
    const list = byDepot.get(row.depotId);
    if (list) list.push(row);
    else byDepot.set(row.depotId, [row]);
  }
  return depots
    .map((depot) => toSummary(depot, byDepot.get(depot.id) ?? []))
    .sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
}

/** One Depot, or null when the id is unknown. */
export async function getDepot(id: string, db: LedgerDb = prisma): Promise<DepotSummary | null> {
  const depot = await db.depot.findUnique({ where: { id } });
  return depot ? toSummary(depot, await cashRows(db, id)) : null;
}
