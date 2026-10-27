// Security classification (AD-20, story 7.1): one SecurityClassification row per Security with an
// automatic layer (refreshed in the background from Yahoo for stocks and from core rules for everything
// else) and a manual layer (user overrides) that always wins. Owned by `classification`; Securities and
// mappings are read only through the ledger's and prices' exported services. The refresh writes only
// automatic columns, the user only manual columns.
import { z } from "zod";
import {
  ASSET_CLASSES,
  type AutomaticLayer,
  type AutomaticSource,
  type Classification,
  type ClassifiedAssetType,
  COMPANY_SIZES,
  CURRENCY_PATTERN,
  type Dimension,
  DIMENSIONS,
  effective,
  emptyLayer,
  findUnderlying,
  type ManualLayer,
  mergeAutomatic,
  providerValues,
  REGIONS,
  ruleValues,
  sameLayer,
} from "@/core/classification";
import { prisma } from "@/db";
import type { Prisma } from "@/db/generated/prisma/client";
import { getSecurity } from "@/modules/ledger";
import { listSecuritiesWithMappings, type SecurityWithMapping } from "@/modules/prices";
import { fetchProfile, type YahooQuoteSummary } from "./providers/yahoo";

export type { Classification, Dimension, DimensionValue, EffectiveSource } from "@/core/classification";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type ClassificationDb = Prisma.TransactionClient;

/** External dependencies of the refresh; each defaults to the real thing (tests inject fakes). */
export type ClassificationDeps = {
  quoteSummary?: YahooQuoteSummary;
  /** Current time for `updatedAt` / `providerFetchedAt`. */
  now?: () => Date;
};

/**
 * Outcome of a refresh: rows written, rows already up to date, and Securities whose provider fetch or
 * refresh failed (a failed provider fetch still counts its rule-value write in `updated`/`unchanged`).
 */
export type ClassificationRunResult = { updated: number; unchanged: number; failed: number };

/** Maximum length of a free-text manual value (sector, industry, country). */
export const CLASSIFICATION_TEXT_MAX_LENGTH = 80;

type Row = Prisma.SecurityClassificationGetPayload<object>;

// In-process serialization: a run started while another is running waits for it to finish. The queue
// lives on globalThis so every module copy in the process (instrumentation, server actions) shares it.
const QUEUE = Symbol.for("depotmanagement.classificationRunQueue");
type QueueGlobal = typeof globalThis & { [QUEUE]?: Promise<unknown> };

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const global = globalThis as QueueGlobal;
  const result = (global[QUEUE] ?? Promise.resolve()).then(run, run);
  global[QUEUE] = result.catch(() => undefined);
  return result;
}

function nowOf(deps: ClassificationDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

const SOURCE_COLUMN = {
  assetClass: "assetClassSource",
  sector: "sectorSource",
  industry: "industrySource",
  region: "regionSource",
  country: "countrySource",
  companySize: "companySizeSource",
  currency: "currencySource",
} as const satisfies Record<Dimension, keyof Row>;

/** Manual column per dimension (export/restore read and write only these). */
export const MANUAL_COLUMN = {
  assetClass: "assetClassManual",
  sector: "sectorManual",
  industry: "industryManual",
  region: "regionManual",
  country: "countryManual",
  companySize: "companySizeManual",
  currency: "currencyManual",
} as const satisfies Record<Dimension, keyof Row>;

function automaticOf(row: Row): AutomaticLayer {
  const layer = emptyLayer();
  for (const dimension of DIMENSIONS) {
    const value = row[dimension];
    const source = row[SOURCE_COLUMN[dimension]] as AutomaticSource | null;
    layer[dimension] = value !== null && source !== null ? { value, source } : { value: null, source: null };
  }
  return layer;
}

function manualOf(row: Row): ManualLayer {
  return Object.fromEntries(DIMENSIONS.map((dimension) => [dimension, row[MANUAL_COLUMN[dimension]]])) as ManualLayer;
}

/** The automatic columns of a layer (never a manual column). */
function automaticColumns(layer: AutomaticLayer) {
  const data: Record<string, string | null> = {};
  for (const dimension of DIMENSIONS) {
    data[dimension] = layer[dimension].value;
    data[SOURCE_COLUMN[dimension]] = layer[dimension].source;
  }
  return data as Pick<Prisma.SecurityClassificationUncheckedCreateInput, Dimension | (typeof SOURCE_COLUMN)[Dimension]>;
}

type ProviderOutcome =
  | { kind: "none" }
  | { kind: "fetched"; layer: AutomaticLayer | null; symbol: string }
  | { kind: "failed" };

/** Provider fetch of a STOCK with a Yahoo mapping whose symbol differs from the last answered one. */
async function providerFor(security: SecurityWithMapping, row: Row | undefined, deps: ClassificationDeps): Promise<ProviderOutcome> {
  const mapping = security.mapping;
  if (security.assetType !== "STOCK" || mapping?.provider !== "YAHOO" || !mapping.symbol) return { kind: "none" };
  if (row?.providerSymbol === mapping.symbol) return { kind: "none" };
  const lookup = await fetchProfile(mapping.symbol, { quoteSummary: deps.quoteSummary });
  if (lookup.status === "error") return { kind: "failed" };
  return { kind: "fetched", symbol: mapping.symbol, layer: lookup.status === "found" ? providerValues(lookup.value) : null };
}

/** Writes the automatic layer (and provider markers) of one Security when anything changed. */
async function storeAutomatic(
  securityId: string,
  row: Row | undefined,
  layer: AutomaticLayer,
  provider: ProviderOutcome,
  isStock: boolean,
  now: Date,
  db: ClassificationDb,
): Promise<Row | null> {
  const fetched = provider.kind === "fetched";
  // A non-stock has no provider values: forget the answered symbol so a return to STOCK refetches.
  const clearProvider = !isStock && (row?.providerSymbol != null || row?.providerFetchedAt != null);
  if (row && !fetched && !clearProvider && sameLayer(automaticOf(row), layer)) return null;
  const data = {
    ...automaticColumns(layer),
    ...(fetched ? { providerSymbol: provider.symbol, providerFetchedAt: now.toISOString() } : {}),
    ...(clearProvider ? { providerSymbol: null, providerFetchedAt: null } : {}),
    updatedAt: now.toISOString(),
  };
  return db.securityClassification.upsert({ where: { securityId }, create: { securityId, ...data }, update: data });
}

/**
 * Refreshes the automatic layer of every Security (serialized with other runs in this process):
 * non-certificates first (rules; stocks with a Yahoo mapping also fetch the provider profile once per
 * symbol), then certificates against the effective values of the others. Only changed rows are written;
 * manual columns are never touched. A failed provider fetch keeps the rule values and leaves the provider
 * pending (retried by the next run). Never throws for a single Security.
 */
export function refreshClassifications(deps: ClassificationDeps = {}, db: ClassificationDb = prisma): Promise<ClassificationRunResult> {
  return serialized(async () => {
    const result: ClassificationRunResult = { updated: 0, unchanged: 0, failed: 0 };
    const [securities, rows] = await Promise.all([listSecuritiesWithMappings(db), db.securityClassification.findMany()]);
    const byId = new Map(rows.map((row) => [row.securityId, row]));
    const effectiveById = new Map<string, Classification>();

    const refreshOne = async (security: SecurityWithMapping, underlying?: Classification | null) => {
      const row = byId.get(security.id);
      try {
        const provider = await providerFor(security, row, deps);
        if (provider.kind === "failed") result.failed += 1;
        const assetType = security.assetType as ClassifiedAssetType;
        const rules = ruleValues({ name: security.name, assetType }, underlying);
        // A fetched "no data" answer is an empty provider result: rule values replace old provider values.
        const fresh = provider.kind === "fetched" ? (provider.layer ?? emptyLayer()) : null;
        const layer = mergeAutomatic(row ? automaticOf(row) : null, rules, fresh, assetType);
        const written = await storeAutomatic(security.id, row, layer, provider, assetType === "STOCK", nowOf(deps), db);
        if (written) result.updated += 1;
        else result.unchanged += 1;
        const current = written ?? row;
        effectiveById.set(security.id, effective(current ? { automatic: automaticOf(current), manual: manualOf(current) } : null, assetType));
      } catch (error) {
        console.error(`Classification: refreshing a Security failed (${error instanceof Error ? error.name : "unknown"})`);
        result.failed += 1;
      }
    };

    const certificates = securities.filter((security) => security.assetType === "CERTIFICATE");
    const others = securities.filter((security) => security.assetType !== "CERTIFICATE");
    for (const security of others) await refreshOne(security);
    const known = others.filter((security) => effectiveById.has(security.id)).map(({ id, name }) => ({ id, name }));
    for (const certificate of certificates) {
      const underlyingId = findUnderlying(certificate.name, known);
      await refreshOne(certificate, underlyingId ? effectiveById.get(underlyingId) : null);
    }
    if (result.failed > 0) console.warn(`Classification: refresh finished with ${result.failed} failed Securities`);
    return result;
  });
}

/** Effective classification per Security id (every Security; a missing row is all unknown). */
export async function listClassifications(db: ClassificationDb = prisma): Promise<Record<string, Classification>> {
  const [securities, rows] = await Promise.all([listSecuritiesWithMappings(db), db.securityClassification.findMany()]);
  const byId = new Map(rows.map((row) => [row.securityId, row]));
  const result: Record<string, Classification> = {};
  for (const security of securities) {
    const row = byId.get(security.id);
    result[security.id] = effective(
      row ? { automatic: automaticOf(row), manual: manualOf(row) } : null,
      security.assetType as ClassifiedAssetType,
    );
  }
  return result;
}

export type ClassificationFailureReason =
  | "not-found"
  | "asset-class-invalid"
  | "sector-invalid"
  | "industry-invalid"
  | "region-invalid"
  | "country-invalid"
  | "company-size-invalid"
  | "currency-invalid";

export type SetManualClassificationResult = { ok: true; classification: Classification } | { ok: false; reason: ClassificationFailureReason };

/** Manual input per dimension: `""` (or null) = automatic; an absent key leaves the override unchanged. */
export type ManualClassificationInput = Partial<Record<Dimension, unknown>>;

const REASON: Record<Dimension, ClassificationFailureReason> = {
  assetClass: "asset-class-invalid",
  sector: "sector-invalid",
  industry: "industry-invalid",
  region: "region-invalid",
  country: "country-invalid",
  companySize: "company-size-invalid",
  currency: "currency-invalid",
};

const freeText = z.string().normalize("NFC").trim().min(1).max(CLASSIFICATION_TEXT_MAX_LENGTH);

/** Validation of a non-empty manual value per dimension (German labels; currency upper-cased ISO code). */
export const MANUAL_VALUE_SCHEMAS: Record<Dimension, z.ZodType<string>> = {
  assetClass: z.enum(ASSET_CLASSES),
  sector: freeText,
  industry: freeText,
  region: z.enum(REGIONS),
  country: freeText,
  companySize: z.enum(COMPANY_SIZES),
  currency: z.string().trim().toUpperCase().regex(CURRENCY_PATTERN),
};

/**
 * Sets (or clears) manual overrides of a Security. All given dimensions are validated before anything
 * is written; the first invalid one is the typed reason. Automatic columns are left untouched.
 */
export async function setManualClassification(
  securityId: string,
  input: ManualClassificationInput,
  db: ClassificationDb = prisma,
): Promise<SetManualClassificationResult> {
  const security = securityId ? await getSecurity(securityId, db) : null;
  if (!security) return { ok: false, reason: "not-found" };
  const data: Partial<Record<(typeof MANUAL_COLUMN)[Dimension], string | null>> = {};
  for (const dimension of DIMENSIONS) {
    if (!Object.hasOwn(input, dimension) || input[dimension] === undefined) continue;
    const raw = input[dimension];
    if (raw === null || (typeof raw === "string" && raw.trim() === "")) {
      data[MANUAL_COLUMN[dimension]] = null;
      continue;
    }
    const parsed = MANUAL_VALUE_SCHEMAS[dimension].safeParse(raw);
    if (!parsed.success) return { ok: false, reason: REASON[dimension] };
    data[MANUAL_COLUMN[dimension]] = parsed.data;
  }
  const updatedAt = new Date().toISOString();
  const row = await db.securityClassification.upsert({
    where: { securityId },
    create: { securityId, ...data, updatedAt },
    update: { ...data, updatedAt },
  });
  return {
    ok: true,
    classification: effective({ automatic: automaticOf(row), manual: manualOf(row) }, security.assetType as ClassifiedAssetType),
  };
}

