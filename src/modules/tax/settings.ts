import { prisma } from "@/db";
import type { Prisma } from "@/db/generated/prisma/client";
import { canonicalDecimal, ExactDecimal } from "@/core/decimal";
import { parseDecimalInput } from "@/core/decimal-input";
import { TEILFREISTELLUNG_RATES } from "@/core/tax";
import { BROKERS, type Broker, getSecurity } from "@/modules/ledger";

/** Prisma client or interactive-transaction client. */
export type TaxDb = Prisma.TransactionClient;

export const TAX_YEAR_MIN = 2000;
export const TAX_YEAR_MAX = 2100;

/** One stored Freistellungsauftrag; `amount` is a canonical decimal string > 0. */
export type TaxAllowanceRecord = { broker: Broker; year: number; amount: string };

export type TaxAllowanceFailureReason = "year-invalid" | "amount-invalid";

export type SetTaxAllowancesResult = { ok: true } | { ok: false; reason: TaxAllowanceFailureReason; broker?: Broker };

export type TeilfreistellungFailureReason = "security-not-found" | "rate-invalid";

export type SetTeilfreistellungResult = { ok: true } | { ok: false; reason: TeilfreistellungFailureReason };

/** Every stored Freistellungsauftrag, newest year first, brokers in enum order. */
export async function listTaxAllowances(db: TaxDb = prisma): Promise<TaxAllowanceRecord[]> {
  const rows = await db.taxAllowance.findMany({ select: { broker: true, year: true, amount: true } });
  return rows.sort((a, b) => b.year - a.year || BROKERS.indexOf(a.broker) - BROKERS.indexOf(b.broker));
}

function parseYear(year: unknown): number | null {
  const value = typeof year === "number" ? year : typeof year === "string" && /^\d{4}$/.test(year.trim()) ? Number(year.trim()) : NaN;
  return Number.isInteger(value) && value >= TAX_YEAR_MIN && value <= TAX_YEAR_MAX ? value : null;
}

/** German or plain decimal text ≥ 0 with at most two decimals; `""` and 0 give `null` (= no row). */
function parseAmount(amount: unknown): { ok: true; value: string | null } | { ok: false } {
  if (typeof amount !== "string") return { ok: false };
  const parsed = parseDecimalInput(amount);
  if (!parsed.ok) return { ok: false };
  if (parsed.value === "") return { ok: true, value: null };
  const value = new ExactDecimal(parsed.value);
  if (value.isNegative() || value.decimalPlaces() > 2) return { ok: false };
  return { ok: true, value: value.isZero() ? null : canonicalDecimal(value) };
}

/**
 * Stores the Freistellungsaufträge of `year` for the brokers present in `amounts` (German or plain decimal
 * text, ≥ 0, ≤ 2 decimals). Every field is validated before anything is written; `""` or 0 removes the
 * broker's row (counts as 0). Brokers missing from `amounts` are left unchanged.
 */
export async function setTaxAllowances(
  year: unknown,
  amounts: Partial<Record<Broker, unknown>>,
  db: TaxDb = prisma,
  now: () => Date = () => new Date(),
): Promise<SetTaxAllowancesResult> {
  const parsedYear = parseYear(year);
  if (parsedYear === null) return { ok: false, reason: "year-invalid" };
  const values: { broker: Broker; amount: string | null }[] = [];
  for (const broker of BROKERS) {
    if (!Object.hasOwn(amounts, broker) || amounts[broker] === undefined) continue;
    const parsed = parseAmount(amounts[broker]);
    if (!parsed.ok) return { ok: false, reason: "amount-invalid", broker };
    values.push({ broker, amount: parsed.value });
  }
  const updatedAt = now().toISOString();
  for (const { broker, amount } of values) {
    const where = { broker_year: { broker, year: parsedYear } };
    if (amount === null) await db.taxAllowance.deleteMany({ where: { broker, year: parsedYear } });
    else await db.taxAllowance.upsert({ where, create: { broker, year: parsedYear, amount, updatedAt }, update: { amount, updatedAt } });
  }
  return { ok: true };
}

/** Security id → manual Teilfreistellung rate (decimal string). */
export async function listTeilfreistellungOverrides(db: TaxDb = prisma): Promise<Record<string, string>> {
  const rows = await db.teilfreistellungOverride.findMany({ select: { securityId: true, rate: true } });
  return Object.fromEntries(rows.map((row) => [row.securityId, row.rate]));
}

/**
 * Sets the manual Teilfreistellung of a Security to one of `TEILFREISTELLUNG_RATES`; `""` removes the
 * override (automatic again).
 */
export async function setTeilfreistellungOverride(
  securityId: unknown,
  rate: unknown,
  db: TaxDb = prisma,
  now: () => Date = () => new Date(),
): Promise<SetTeilfreistellungResult> {
  const security = typeof securityId === "string" && securityId ? await getSecurity(securityId, db) : null;
  if (!security) return { ok: false, reason: "security-not-found" };
  if (rate === "") {
    await db.teilfreistellungOverride.deleteMany({ where: { securityId: security.id } });
    return { ok: true };
  }
  if (typeof rate !== "string" || !(TEILFREISTELLUNG_RATES as readonly string[]).includes(rate)) return { ok: false, reason: "rate-invalid" };
  const updatedAt = now().toISOString();
  await db.teilfreistellungOverride.upsert({
    where: { securityId: security.id },
    create: { securityId: security.id, rate, updatedAt },
    update: { rate, updatedAt },
  });
  return { ok: true };
}
