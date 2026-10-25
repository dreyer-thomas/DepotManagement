import { z } from "zod";
import { prisma } from "@/db";
import { AssetType, Prisma } from "@/db/generated/prisma/client";
import type { LedgerDb } from "./depots";

export type { AssetType } from "@/db/generated/prisma/client";

/** All asset types in declaration order. */
export const ASSET_TYPES = Object.values(AssetType) as [AssetType, ...AssetType[]];

/** Asset types that are identified by an ISIN. */
export const ISIN_ASSET_TYPES: readonly AssetType[] = ["STOCK", "ETF", "FUND", "CERTIFICATE"];

export const SECURITY_NAME_MAX_LENGTH = 100;

export type SecuritySummary = {
  id: string;
  name: string;
  isin: string | null;
  cryptoSymbol: string | null;
  assetType: AssetType;
};

export type SecurityFailureReason =
  | "isin-invalid"
  | "crypto-symbol-invalid"
  | "security-name-invalid"
  | "asset-type-invalid";

export type SecurityResult = { ok: true; security: SecuritySummary } | { ok: false; reason: SecurityFailureReason };

/** `{ isin }` or `{ cryptoSymbol }`; values are validated and normalised by the ledger. */
export type SecurityIdentifierInput = { isin: unknown } | { cryptoSymbol: unknown };
export type SecurityDetailsInput = { name: unknown; assetType: unknown };

const ISIN_SHAPE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/** ISIN check digit (ISO 6166): letters become 10..35, then Luhn over all digits. */
export function hasValidIsinCheckDigit(isin: string): boolean {
  const digits = isin.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export const isinSchema = z
  .string({ error: "isin-invalid" })
  .trim()
  .toUpperCase()
  .regex(ISIN_SHAPE, { error: "isin-invalid" })
  .refine(hasValidIsinCheckDigit, { error: "isin-invalid" });

export const cryptoSymbolSchema = z
  .string({ error: "crypto-symbol-invalid" })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{1,10}$/, { error: "crypto-symbol-invalid" });

export const securityNameSchema = z
  .string({ error: "security-name-invalid" })
  .normalize("NFC")
  .trim()
  .min(1, { error: "security-name-invalid" })
  .max(SECURITY_NAME_MAX_LENGTH, { error: "security-name-invalid" });

export const assetTypeSchema = z.enum(ASSET_TYPES, { error: "asset-type-invalid" });

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: SecurityFailureReason };

function parse<T>(schema: z.ZodType<T>, value: unknown): Parsed<T> {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, reason: result.error.issues[0].message as SecurityFailureReason };
}

export type ValidSecurityIdentity =
  | { key: { isin: string }; name: string; assetType: AssetType }
  | { key: { cryptoSymbol: string }; name: string; assetType: AssetType };

/**
 * Validates identifier and details without touching the DB: ISIN (with check digit) or crypto
 * symbol, name, and an asset type matching the identifier (CRYPTO ⇔ crypto symbol).
 */
export function validateSecurity(
  identifier: SecurityIdentifierInput,
  details: SecurityDetailsInput,
): { ok: true; value: ValidSecurityIdentity } | { ok: false; reason: SecurityFailureReason } {
  const byIsin = identifier !== null && typeof identifier === "object" && "isin" in identifier;
  const key = byIsin
    ? parse(isinSchema, (identifier as { isin: unknown }).isin)
    : parse(cryptoSymbolSchema, (identifier as { cryptoSymbol?: unknown } | null)?.cryptoSymbol);
  if (!key.ok) return key;
  const name = parse(securityNameSchema, details.name);
  if (!name.ok) return name;
  const assetType = parse(assetTypeSchema, details.assetType);
  if (!assetType.ok) return assetType;
  const matches = byIsin ? ISIN_ASSET_TYPES.includes(assetType.value) : assetType.value === "CRYPTO";
  if (!matches) return { ok: false, reason: "asset-type-invalid" };
  return {
    ok: true,
    value: {
      key: byIsin ? { isin: key.value } : { cryptoSymbol: key.value },
      name: name.value,
      assetType: assetType.value,
    } as ValidSecurityIdentity,
  };
}

const SECURITY_SELECT = { id: true, name: true, isin: true, cryptoSymbol: true, assetType: true } as const;

/** The Security with this (normalised) ISIN or crypto symbol, or null. */
export async function findSecurityByKey(
  key: ValidSecurityIdentity["key"],
  db: LedgerDb = prisma,
): Promise<SecuritySummary | null> {
  return db.security.findUnique({ where: key, select: SECURITY_SELECT });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Idempotent: returns the existing Security for the ISIN / upper-cased crypto symbol unchanged,
 * otherwise creates it. The only place that creates Securities.
 */
export async function ensureSecurity(
  identifier: SecurityIdentifierInput,
  details: SecurityDetailsInput,
  db: LedgerDb = prisma,
): Promise<SecurityResult> {
  const valid = validateSecurity(identifier, details);
  if (!valid.ok) return valid;
  const { key, name, assetType } = valid.value;
  const existing = await findSecurityByKey(key, db);
  if (existing) return { ok: true, security: existing };
  try {
    const security = await db.security.create({ data: { ...key, name, assetType }, select: SECURITY_SELECT });
    return { ok: true, security };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findSecurityByKey(key, db);
    if (!raced) throw error;
    return { ok: true, security: raced };
  }
}

/** The Security with this id, or null. */
export async function getSecurity(securityId: string, db: LedgerDb = prisma): Promise<SecuritySummary | null> {
  return db.security.findUnique({ where: { id: securityId }, select: SECURITY_SELECT });
}

/** All Securities sorted by name (de-DE collation). */
export async function listSecurities(db: LedgerDb = prisma): Promise<SecuritySummary[]> {
  const securities = await db.security.findMany({ select: SECURITY_SELECT });
  return securities.sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
}

/**
 * Asset types a Security may be changed to: STOCK/ETF/FUND/CERTIFICATE for an ISIN Security, CRYPTO
 * for a crypto Security (CRYPTO ⇔ crypto symbol). Never `UNCLASSIFIED`.
 */
export function allowedAssetTypes(security: Pick<SecuritySummary, "isin" | "cryptoSymbol">): AssetType[] {
  return security.isin !== null ? [...ISIN_ASSET_TYPES] : ["CRYPTO"];
}

export type ChangeSecurityTypeResult =
  | { ok: true; security: SecuritySummary }
  | { ok: false; reason: "not-found" | "asset-type-invalid" };

/**
 * Changes a Security's asset type (AD-16: only the ledger writes it). The target must match the
 * identifier (see `allowedAssetTypes`); provider mappings are left untouched.
 */
export async function changeSecurityType(
  securityId: unknown,
  assetType: unknown,
  db: LedgerDb = prisma,
): Promise<ChangeSecurityTypeResult> {
  if (typeof securityId !== "string" || securityId === "") return { ok: false, reason: "not-found" };
  const parsed = assetTypeSchema.safeParse(assetType);
  const security = await getSecurity(securityId, db);
  if (!security) return { ok: false, reason: "not-found" };
  if (!parsed.success || !allowedAssetTypes(security).includes(parsed.data)) {
    return { ok: false, reason: "asset-type-invalid" };
  }
  if (security.assetType === parsed.data) return { ok: true, security };
  const updated = await db.security.update({
    where: { id: securityId },
    data: { assetType: parsed.data },
    select: SECURITY_SELECT,
  });
  return { ok: true, security: updated };
}

/**
 * Per Security of `securityIds`: its first activity date — the earliest date of any of its Transactions
 * (any Depot) or of an ISIN change whose new Security it is. Securities without activity are absent.
 */
export async function firstActivityDates(securityIds: readonly string[], db: LedgerDb = prisma): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (securityIds.length === 0) return result;
  const ids = [...securityIds];
  const [transactions, isinChanges] = await Promise.all([
    db.transaction.groupBy({ by: ["securityId"], where: { securityId: { in: ids } }, _min: { date: true } }),
    db.corporateAction.groupBy({
      by: ["newSecurityId"],
      where: { type: "ISIN_CHANGE", newSecurityId: { in: ids } },
      _min: { date: true },
    }),
  ]);
  const keep = (securityId: string | null, date: string | null) => {
    if (!securityId || !date) return;
    const current = result.get(securityId);
    if (!current || date < current) result.set(securityId, date);
  };
  for (const row of transactions) keep(row.securityId, row._min.date);
  for (const row of isinChanges) keep(row.newSecurityId, row._min.date);
  return result;
}
