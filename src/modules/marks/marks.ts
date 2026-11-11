import { prisma } from "@/db";
import { Prisma } from "@/db/generated/prisma/client";
import type { CorporateActions } from "@/core/corporate-actions";
import {
  carryPriceMarks,
  checkPriceMarksPatch,
  NO_PRICE_MARK_LINES,
  type PriceMarkLines,
  priceMarkLines,
  type PriceMarks,
  type PriceMarksInvalid,
  type PriceMarksPatch,
  type PriceMarkState,
  priceMarkState,
  type StopMark,
  type TargetMark,
} from "@/core/price-marks";
import { currentSecurityId } from "@/core/security";
import { getSecurity, listHeldSecurities, listSecurities, securityPriceObservations } from "@/modules/ledger";
import { storedPriceHistory } from "@/modules/prices";

/** Prisma client or interactive-transaction client; the service accepts either. */
export type MarksDb = Prisma.TransactionClient;

export type SetPriceMarksResult =
  | { ok: true; marks: PriceMarks | null }
  | { ok: false; reason: "not-found" }
  | PriceMarksInvalid;

/** The marks of a Security as a view shows them, with their state as of today. */
export type PriceMarksViewItem = { marks: PriceMarks | null; state: PriceMarkState };

const ROW_SELECT = {
  id: true,
  securityId: true,
  stopType: true,
  stopValue: true,
  stopSource: true,
  stopSetDate: true,
  targetPrice: true,
  targetSource: true,
  targetSetDate: true,
  updatedAt: true,
} as const;

type Row = Prisma.PriceMarkGetPayload<{ select: typeof ROW_SELECT }>;

/** A stored row as marks; a mark with a missing column counts as absent. */
export function rowToMarks(row: Row): PriceMarks {
  const stop: StopMark | null =
    row.stopType !== null && row.stopValue !== null && row.stopSetDate !== null
      ? { type: row.stopType, value: row.stopValue, source: row.stopSource, setDate: row.stopSetDate }
      : null;
  const target: TargetMark | null =
    row.targetPrice !== null && row.targetSetDate !== null
      ? { price: row.targetPrice, source: row.targetSource, setDate: row.targetSetDate }
      : null;
  return { securityId: row.securityId, stop, target };
}

function marksToColumns(marks: Pick<PriceMarks, "stop" | "target">) {
  return {
    stopType: marks.stop?.type ?? null,
    stopValue: marks.stop?.value ?? null,
    stopSource: marks.stop?.source ?? null,
    stopSetDate: marks.stop?.setDate ?? null,
    targetPrice: marks.target?.price ?? null,
    targetSource: marks.target?.source ?? null,
    targetSetDate: marks.target?.setDate ?? null,
  };
}

/** Runs `write` in one DB transaction: its own, unless `db` already is one. */
async function inTransaction<T>(db: MarksDb, write: (tx: MarksDb) => Promise<T>): Promise<T> {
  const client = db as MarksDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") return client.$transaction((tx) => write(tx));
  return write(db);
}

/** Every recorded corporate action (the ledger's), without observations. */
async function loadActions(today: string, db: MarksDb): Promise<CorporateActions> {
  return (await securityPriceObservations([], today, {}, db)).actions;
}

/**
 * The row whose marks apply to `securityId` as of `today`: among the rows of Securities mapping to the same
 * current Security (`currentSecurityId`, an ISIN change moves marks to the successor) the current Security's
 * own row, else `securityId`'s own, else the most recently written predecessor row; `null` without one.
 */
function applicableRow(rows: readonly Row[], securityId: string, actions: CorporateActions, today: string): Row | null {
  const current = currentSecurityId(securityId, actions, today);
  const candidates = rows.filter((row) => currentSecurityId(row.securityId, actions, today) === current);
  return (
    candidates.find((row) => row.securityId === current) ??
    candidates.find((row) => row.securityId === securityId) ??
    [...candidates].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.id < b.id ? 1 : -1))[0] ??
    null
  );
}

async function rowsFor(securityIds: readonly string[], actions: CorporateActions, today: string, db: MarksDb): Promise<Row[]> {
  // The table holds at most one row per Security; the ISIN-change chain decides which apply.
  const currents = new Set(securityIds.map((id) => currentSecurityId(id, actions, today)));
  const rows = await db.priceMark.findMany({ select: ROW_SELECT });
  return rows.filter((row) => currents.has(currentSecurityId(row.securityId, actions, today)));
}

/**
 * The marks that apply to `securityId` as of `today` (its own or an ISIN-change predecessor's), carried to the
 * Security it maps to today (`carryPriceMarks`); `null` without.
 */
export async function getPriceMarks(securityId: string, today: string, db: MarksDb = prisma): Promise<PriceMarks | null> {
  const actions = await loadActions(today, db);
  const row = applicableRow(await rowsFor([securityId], actions, today, db), securityId, actions, today);
  return row ? carryPriceMarks(rowToMarks(row), currentSecurityId(securityId, actions, today), actions, today) : null;
}

/**
 * Per Security of `securityIds`: the marks that apply (or `null`) and their state as of `today`
 * (`core/price-marks` over stored Prices and Transaction prices). Every id is present. Read-only, no
 * provider call.
 */
export async function priceMarksView(
  securityIds: readonly string[],
  today: string,
  db: MarksDb = prisma,
): Promise<Record<string, PriceMarksViewItem>> {
  if (securityIds.length === 0) return {};
  const actions = await loadActions(today, db);
  const rows = await rowsFor(securityIds, actions, today, db);
  const applied = new Map(securityIds.map((id) => [id, applicableRow(rows, id, actions, today)]));
  const ids = [...new Set([...securityIds, ...rows.map((row) => row.securityId)])];
  const { observations } = await securityPriceObservations(ids, today, { storedPrices: (list, asOf) => storedPriceHistory(list, asOf, db) }, db);
  const view: Record<string, PriceMarksViewItem> = {};
  for (const id of securityIds) {
    const row = applied.get(id) ?? null;
    // In the units of the Security `id` maps to today, so a form prefilled from them saves the same levels.
    const marks = row ? carryPriceMarks(rowToMarks(row), currentSecurityId(id, actions, today), actions, today) : null;
    view[id] = { marks, state: priceMarkState(marks ?? { securityId: id, stop: null, target: null }, observations, actions, today) };
  }
  return view;
}

/** A Security whose marks are breached as of today (story 12.4), as the dashboard and the lists show it. */
export type BreachedPriceMark = {
  securityId: string;
  name: string;
  /** Held in a non-archived Depot as of today (`listHeldSecurities`). */
  held: boolean;
  marks: PriceMarks;
  state: PriceMarkState & { breached: "stop" | "target" };
};

/**
 * Every Security whose marks are breached as of `today`: each PriceMark row's Security mapped to the
 * Security it is today (`currentSecurityId`, ISIN successor), its state from `priceMarksView` (never a
 * comparison of its own), kept when `breached` is not `none`; sorted by name (de-DE), then id. Read-only, no provider
 * call, nothing stored.
 */
export async function breachedPriceMarks(today: string, db: MarksDb = prisma): Promise<BreachedPriceMark[]> {
  const rows = await db.priceMark.findMany({ select: { securityId: true } });
  if (rows.length === 0) return [];
  const actions = await loadActions(today, db);
  const ids = [...new Set(rows.map((row) => currentSecurityId(row.securityId, actions, today)))];
  const [view, securities, held] = await Promise.all([priceMarksView(ids, today, db), listSecurities(db), listHeldSecurities(today, db)]);
  const names = new Map(securities.map((security) => [security.id, security.name]));
  const heldSet = new Set(held);
  const items: BreachedPriceMark[] = [];
  for (const id of ids) {
    const { marks, state } = view[id];
    const name = names.get(id);
    if (marks === null || name === undefined || state.breached === "none") continue;
    items.push({ securityId: id, name, held: heldSet.has(id), marks, state: { ...state, breached: state.breached } });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, "de-DE") || (a.securityId < b.securityId ? -1 : a.securityId > b.securityId ? 1 : 0));
}

/**
 * The marks that apply to `securityId` as of `today` (the applicable row, uncarried) as lines of the price
 * chart for `from..to`, in the units as of `to` (`core/price-marks` `priceMarkLines` over stored Prices and
 * Transaction prices); no marks → no lines. Read-only, no provider call.
 */
export async function priceMarkChartLines(
  securityId: string,
  from: string,
  to: string,
  today: string,
  db: MarksDb = prisma,
): Promise<PriceMarkLines> {
  const actions = await loadActions(today, db);
  const rows = await rowsFor([securityId], actions, today, db);
  const row = applicableRow(rows, securityId, actions, today);
  if (row === null) return NO_PRICE_MARK_LINES;
  // The row's own marks: `priceMarkLines` carries them from their set date to the units as of `to`.
  const marks = rowToMarks(row);
  const ids = [...new Set([securityId, currentSecurityId(securityId, actions, today), ...rows.map((candidate) => candidate.securityId)])];
  const { observations } = await securityPriceObservations(ids, today, { storedPrices: (list, asOf) => storedPriceHistory(list, asOf, db) }, db);
  return priceMarkLines(marks, observations, actions, from, to);
}

/**
 * Sets or clears the stop and target of `securityId` as of `today` (the only write path of marks): a field
 * omitted keeps the mark that applies, `null` clears it, an object sets it (validated by
 * `core/price-marks`). Writes the row of the Security `securityId` maps to today and deletes the
 * predecessor rows mapping to it, in one DB transaction (a kept predecessor mark is carried to the
 * successor's units); with neither mark left the row is deleted. Unknown Security → `not-found`; an
 * invalid patch writes nothing.
 */
export async function setPriceMarks(
  securityId: unknown,
  patch: PriceMarksPatch,
  today: string,
  db: MarksDb = prisma,
  now: () => Date = () => new Date(),
): Promise<SetPriceMarksResult> {
  const checked = checkPriceMarksPatch(patch, today);
  if (!checked.ok) return checked;
  if (typeof securityId !== "string" || securityId === "") return { ok: false, reason: "not-found" };
  return inTransaction(db, async (tx): Promise<SetPriceMarksResult> => {
    if (!(await getSecurity(securityId, tx))) return { ok: false, reason: "not-found" };
    const actions = await loadActions(today, tx);
    const current = currentSecurityId(securityId, actions, today);
    const rows = await rowsFor([securityId], actions, today, tx);
    const existingRow = applicableRow(rows, securityId, actions, today);
    const existing = existingRow ? carryPriceMarks(rowToMarks(existingRow), current, actions, today) : null;
    const merged: PriceMarks = {
      securityId: current,
      stop: checked.patch.stop === undefined ? (existing?.stop ?? null) : checked.patch.stop,
      target: checked.patch.target === undefined ? (existing?.target ?? null) : checked.patch.target,
    };
    const predecessors = rows.filter((row) => row.securityId !== current).map((row) => row.id);
    if (predecessors.length > 0) await tx.priceMark.deleteMany({ where: { id: { in: predecessors } } });
    if (merged.stop === null && merged.target === null) {
      await tx.priceMark.deleteMany({ where: { securityId: current } });
      return { ok: true, marks: null };
    }
    const data = { ...marksToColumns(merged), updatedAt: now().toISOString() };
    const row = await tx.priceMark.upsert({ where: { securityId: current }, create: { securityId: current, ...data }, update: data, select: ROW_SELECT });
    return { ok: true, marks: rowToMarks(row) };
  });
}
