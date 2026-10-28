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
  type ProviderProfile,
  providerValues,
  REGIONS,
  ruleValues,
  sameLayer,
} from "@/core/classification";
import {
  deserializeRegionSplit,
  effectiveRegionSplit,
  type EffectiveRegionSplit,
  parseRegionSplit,
  type RegionWeights,
  regionSplitRule,
  type RuleRegionSplit,
  serializeRegionSplit,
  type SplitRegion,
} from "@/core/region-split";
import { businessDate } from "@/core/dates";
import {
  emptyKeyFigures,
  hasProviderKeyFigures,
  isKeyFiguresStale,
  PROVIDER_KEY_FIGURE_FIELDS,
  type ProviderKeyFigures,
} from "@/core/key-figures";
import { prisma } from "@/db";
import type { Prisma } from "@/db/generated/prisma/client";
import { getSecurity, listHeldSecurities } from "@/modules/ledger";
import { listSecuritiesWithMappings, type SecurityWithMapping } from "@/modules/prices";
import {
  fetchQuoteSummary,
  KEY_FIGURE_MODULES,
  keyFiguresOf,
  type Lookup,
  PROFILE_MODULES,
  profileOf,
  type QuoteSummaryModule,
  type YahooQuoteSummary,
} from "./providers/yahoo";

export type { Classification, Dimension, DimensionValue, EffectiveSource } from "@/core/classification";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type ClassificationDb = Prisma.TransactionClient;

/** External dependencies of the refresh; each defaults to the real thing (tests inject fakes). */
export type ClassificationDeps = {
  quoteSummary?: YahooQuoteSummary;
  /** Current time for `updatedAt` / `providerFetchedAt` / the key figures' `fetchedAt` (and "today"). */
  now?: () => Date;
  /**
   * Ids of the watched Securities (story 9.6): with the held ones the set whose key figures are kept.
   * `classification` never imports `watchlist`, so the app layer passes the loader in; absent = none.
   */
  watched?: (db: ClassificationDb) => Promise<readonly string[]>;
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

type KeyFiguresOutcome =
  | { kind: "none" }
  | { kind: "fetched"; figures: ProviderKeyFigures; symbol: string; figureKind: "stock" | "fund" }
  | { kind: "failed" };

type KeyFiguresRow = Prisma.SecurityKeyFiguresGetPayload<object>;

/** The Yahoo symbol of a Security's mapping; `null` without a Yahoo mapping. */
function yahooSymbolOf(security: SecurityWithMapping): string | null {
  return security.mapping?.provider === "YAHOO" && security.mapping.symbol ? security.mapping.symbol : null;
}

/** A STOCK with a Yahoo mapping whose symbol differs from the last answered one needs its profile. */
function needsProfile(security: SecurityWithMapping, row: Row | undefined): boolean {
  const symbol = yahooSymbolOf(security);
  return security.assetType === "STOCK" && symbol !== null && row?.providerSymbol !== symbol;
}

/**
 * True when the snapshot was fetched today for `symbol` and the kind of `assetType` (at most one request
 * per Security and Berlin day; a mapping or "Typ ändern" change makes it not fresh).
 */
function fetchedToday(snapshot: KeyFiguresRow | undefined, symbol: string | null, assetType: string, today: string): boolean {
  return (
    snapshot !== undefined &&
    symbol !== null &&
    snapshot.symbol === symbol &&
    snapshot.kind === kindOf(assetType) &&
    businessDate(new Date(snapshot.fetchedAt)) === today
  );
}

/**
 * A held or watched STOCK/ETF/FUND with a Yahoo mapping needs key figures unless its snapshot was fetched
 * today for the same symbol.
 */
function needsKeyFigures(security: SecurityWithMapping, snapshot: KeyFiguresRow | undefined, tracked: boolean, today: string): boolean {
  const symbol = yahooSymbolOf(security);
  return tracked && hasProviderKeyFigures(security.assetType) && symbol !== null && !fetchedToday(snapshot, symbol, security.assetType, today);
}

function kindOf(assetType: string): "stock" | "fund" {
  return assetType === "STOCK" ? "stock" : "fund";
}

/**
 * The provider requests of one Security: the classification profile and/or the key figures, sharing ONE
 * `quoteSummary` request when both are due. A profile-only request keeps its exact modules
 * (`assetProfile, price`).
 */
async function providerFor(
  security: SecurityWithMapping,
  wants: { profile: boolean; keyFigures: boolean },
  today: string,
  deps: ClassificationDeps,
): Promise<{ provider: ProviderOutcome; keyFigures: KeyFiguresOutcome }> {
  const symbol = yahooSymbolOf(security);
  if (symbol === null || (!wants.profile && !wants.keyFigures)) return { provider: { kind: "none" }, keyFigures: { kind: "none" } };
  const modules: QuoteSummaryModule[] = [...(wants.profile ? PROFILE_MODULES : []), ...(wants.keyFigures ? KEY_FIGURE_MODULES : [])];
  const lookup = await fetchQuoteSummary(symbol, modules, { quoteSummary: deps.quoteSummary });
  const profile: Lookup<ProviderProfile> | null = wants.profile ? (lookup.status === "found" ? profileOf(lookup.value) : lookup) : null;
  const figures: Lookup<ProviderKeyFigures> | null = wants.keyFigures
    ? lookup.status === "found"
      ? keyFiguresOf(lookup.value, kindOf(security.assetType), today)
      : lookup
    : null;
  return {
    provider:
      profile === null
        ? { kind: "none" }
        : profile.status === "error"
          ? { kind: "failed" }
          : {
              kind: "fetched",
              symbol,
              layer: profile.status === "found" ? providerValues(profile.value) : null,
            },
    keyFigures:
      figures === null
        ? { kind: "none" }
        : figures.status === "error"
          ? { kind: "failed" }
          : {
              kind: "fetched",
              symbol,
              figureKind: kindOf(security.assetType),
              figures: figures.status === "found" ? figures.value : emptyKeyFigures(),
            },
  };
}

/** Stores a fetched key-figures snapshot (replacing the previous one). */
async function storeKeyFigures(
  securityId: string,
  fetched: { symbol: string; figureKind: "stock" | "fund"; figures: ProviderKeyFigures },
  now: Date,
  db: ClassificationDb,
): Promise<void> {
  const data = { symbol: fetched.symbol, kind: fetched.figureKind, figures: JSON.stringify(fetched.figures), fetchedAt: now.toISOString() };
  await db.securityKeyFigures.upsert({ where: { securityId }, create: { securityId, ...data }, update: data });
}

/** Held ∪ watched Security ids as of `today`: the set whose key figures are kept. */
async function trackedSecurityIds(today: string, deps: ClassificationDeps, db: ClassificationDb): Promise<Set<string>> {
  const [held, watched] = await Promise.all([listHeldSecurities(today, db), deps.watched ? deps.watched(db) : Promise.resolve([])]);
  return new Set([...held, ...watched]);
}

/** The rule-split cache columns of a split (all null without one). */
function ruleSplitColumns(split: RuleRegionSplit | null) {
  return {
    regionSplit: split ? serializeRegionSplit(split.weights) : null,
    regionSplitSource: split ? ("RULE" as const) : null,
    regionSplitAsOf: split?.asOf ?? null,
    regionSplitIndex: split?.index ?? null,
  };
}

/** The stored rule split of a row (null when absent or unreadable). */
function ruleSplitOf(row: Row): RuleRegionSplit | null {
  const weights = deserializeRegionSplit(row.regionSplit);
  if (!weights || row.regionSplitSource !== "RULE" || row.regionSplitIndex === null || row.regionSplitAsOf === null) return null;
  return { weights, index: row.regionSplitIndex, asOf: row.regionSplitAsOf };
}

function sameRuleSplit(row: Row, split: RuleRegionSplit | null): boolean {
  const columns = ruleSplitColumns(split);
  return (
    row.regionSplit === columns.regionSplit &&
    row.regionSplitSource === columns.regionSplitSource &&
    row.regionSplitAsOf === columns.regionSplitAsOf &&
    row.regionSplitIndex === columns.regionSplitIndex
  );
}

/** Writes the automatic layer, the rule split (and provider markers) of one Security when anything changed. */
async function storeAutomatic(
  securityId: string,
  row: Row | undefined,
  layer: AutomaticLayer,
  split: RuleRegionSplit | null,
  provider: ProviderOutcome,
  isStock: boolean,
  now: Date,
  db: ClassificationDb,
): Promise<Row | null> {
  const fetched = provider.kind === "fetched";
  // A non-stock has no provider values: forget the answered symbol so a return to STOCK refetches.
  const clearProvider = !isStock && (row?.providerSymbol != null || row?.providerFetchedAt != null);
  if (row && !fetched && !clearProvider && sameLayer(automaticOf(row), layer) && sameRuleSplit(row, split)) return null;
  const data = {
    ...automaticColumns(layer),
    ...ruleSplitColumns(split),
    ...(fetched ? { providerSymbol: provider.symbol, providerFetchedAt: now.toISOString() } : {}),
    ...(clearProvider ? { providerSymbol: null, providerFetchedAt: null } : {}),
    updatedAt: now.toISOString(),
  };
  return db.securityClassification.upsert({ where: { securityId }, create: { securityId, ...data }, update: data });
}

/**
 * Refreshes the automatic layer of every Security (serialized with other runs in this process):
 * non-certificates first (rules; stocks with a Yahoo mapping also fetch the provider profile once per
 * symbol), then certificates against the effective values of the others; ETFs/funds also get their rule
 * region split (story 8.4). Only changed rows are written; manual columns (incl. the manual split) are never touched. A failed provider fetch keeps the rule values and leaves the provider
 * pending (retried by the next run). Never throws for a single Security.
 */
export function refreshClassifications(deps: ClassificationDeps = {}, db: ClassificationDb = prisma): Promise<ClassificationRunResult> {
  return serialized(async () => {
    const result: ClassificationRunResult = { updated: 0, unchanged: 0, failed: 0 };
    const today = businessDate(nowOf(deps));
    const tracked = await trackedSecurityIds(today, deps, db);
    // Key figures are kept only for held ∪ watched Securities (a disposable cache, like the news).
    await db.securityKeyFigures.deleteMany({ where: { securityId: { notIn: [...tracked] } } });
    const [securities, rows, snapshots] = await Promise.all([
      listSecuritiesWithMappings(db),
      db.securityClassification.findMany(),
      db.securityKeyFigures.findMany(),
    ]);
    const byId = new Map(rows.map((row) => [row.securityId, row]));
    const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.securityId, snapshot]));
    const effectiveById = new Map<string, Classification>();

    const refreshOne = async (security: SecurityWithMapping, underlying?: Classification | null) => {
      const row = byId.get(security.id);
      const snapshot = snapshotById.get(security.id);
      try {
        const { provider, keyFigures } = await providerFor(
          security,
          { profile: needsProfile(security, row), keyFigures: needsKeyFigures(security, snapshot, tracked.has(security.id), today) },
          today,
          deps,
        );
        if (provider.kind === "failed" || keyFigures.kind === "failed") result.failed += 1;
        const assetType = security.assetType as ClassifiedAssetType;
        const rules = ruleValues({ name: security.name, assetType }, underlying);
        // A fetched "no data" answer is an empty provider result: rule values replace old provider values.
        const fresh = provider.kind === "fetched" ? (provider.layer ?? emptyLayer()) : null;
        const layer = mergeAutomatic(row ? automaticOf(row) : null, rules, fresh, assetType);
        // Only ETFs and funds get a rule split; every other type clears a stale one.
        const split = assetType === "ETF" || assetType === "FUND" ? regionSplitRule(security.name) : null;
        const written = await storeAutomatic(security.id, row, layer, split, provider, assetType === "STOCK", nowOf(deps), db);
        if (written) result.updated += 1;
        else result.unchanged += 1;
        const current = written ?? row;
        effectiveById.set(security.id, effective(current ? { automatic: automaticOf(current), manual: manualOf(current) } : null, assetType));
        if (keyFigures.kind === "fetched") await storeKeyFigures(security.id, keyFigures, nowOf(deps), db);
        // A type without provider key figures (e.g. after "Typ ändern") or a removed Yahoo mapping forgets its snapshot.
        else if (snapshot && (!hasProviderKeyFigures(assetType) || yahooSymbolOf(security) === null)) {
          await db.securityKeyFigures.deleteMany({ where: { securityId: security.id } });
        }
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

// ---- Key figures (story 9.6) ----

/** Outcome of "Kennzahlen aktualisieren" for one Security. */
export type RefreshKeyFiguresResult = { status: "updated" | "fresh" | "unavailable" | "failed" | "not-found" };

/**
 * Refreshes the key figures of one Security now (serialized with the classification runs): `not-found`
 * for an unknown id; `unavailable` unless it is a held or watched STOCK/ETF/FUND with a Yahoo mapping;
 * `fresh` when its snapshot was fetched today for the same symbol (no request); `failed` on a transient
 * error (nothing written); `updated` otherwise (Yahoo's "no data" stores an all-null snapshot).
 */
export function refreshKeyFigures(
  securityId: string,
  deps: ClassificationDeps = {},
  db: ClassificationDb = prisma,
): Promise<RefreshKeyFiguresResult> {
  return serialized(async (): Promise<RefreshKeyFiguresResult> => {
    const security = (await listSecuritiesWithMappings(db)).find((candidate) => candidate.id === securityId);
    if (!security) return { status: "not-found" };
    const now = nowOf(deps);
    const today = businessDate(now);
    const tracked = await trackedSecurityIds(today, deps, db);
    if (!tracked.has(security.id) || !isRefreshable(security)) return { status: "unavailable" };
    const snapshot = (await db.securityKeyFigures.findUnique({ where: { securityId } })) ?? undefined;
    if (!needsKeyFigures(security, snapshot, true, today)) return { status: "fresh" };
    const { keyFigures } = await providerFor(security, { profile: false, keyFigures: true }, today, deps);
    if (keyFigures.kind !== "fetched") return { status: "failed" };
    await storeKeyFigures(security.id, keyFigures, now, db);
    return { status: "updated" };
  });
}

/** A STOCK/ETF/FUND with a Yahoo mapping can have provider key figures. */
function isRefreshable(security: SecurityWithMapping): boolean {
  return hasProviderKeyFigures(security.assetType) && yahooSymbolOf(security) !== null;
}

/** A stored snapshot as the surfaces read it. */
export type KeyFiguresSnapshot = {
  /** Yahoo symbol it was fetched for. */
  symbol: string;
  figures: ProviderKeyFigures;
  /** UTC ISO instant of the fetch. */
  fetchedAt: string;
  /** Business date (Europe/Berlin) of the fetch: "Stand". */
  asOf: string;
  /** Older than `KEY_FIGURES_STALE_AFTER_DAYS` on today. */
  stale: boolean;
  /** Fetched today: "Kennzahlen aktualisieren" sends no request. */
  fetchedToday: boolean;
};

/** Key figures of one Security: its snapshot (if any) and whether it can have provider key figures at all. */
export type KeyFiguresInfo = { snapshot: KeyFiguresSnapshot | null; refreshable: boolean };

/** The stored figures, every unknown or non-string value read as `null`. */
function parseFigures(json: string): ProviderKeyFigures {
  const figures = emptyKeyFigures();
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return figures;
  }
  if (raw === null || typeof raw !== "object") return figures;
  for (const field of PROVIDER_KEY_FIGURE_FIELDS) {
    const value = (raw as Record<string, unknown>)[field];
    if (typeof value === "string") figures[field] = value;
  }
  return figures;
}

/**
 * Key figures per requested Security id (unknown ids are left out) as of `today`: the stored snapshot
 * with its date and stale flag, and `refreshable` (STOCK/ETF/FUND with a Yahoo mapping). Read-only.
 */
export async function listKeyFigures(
  securityIds: readonly string[],
  today: string,
  db: ClassificationDb = prisma,
): Promise<Record<string, KeyFiguresInfo>> {
  if (securityIds.length === 0) return {};
  const wanted = new Set(securityIds);
  const [securities, snapshots] = await Promise.all([
    listSecuritiesWithMappings(db),
    db.securityKeyFigures.findMany({ where: { securityId: { in: [...wanted] } } }),
  ]);
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.securityId, snapshot]));
  const result: Record<string, KeyFiguresInfo> = {};
  for (const security of securities) {
    if (!wanted.has(security.id)) continue;
    const row = snapshotById.get(security.id);
    const refreshable = isRefreshable(security);
    // A snapshot of the other kind (after "Typ ändern" STOCK ↔ ETF/FUND) is not shown.
    if (!row || !hasProviderKeyFigures(security.assetType) || row.kind !== kindOf(security.assetType)) {
      result[security.id] = { snapshot: null, refreshable };
      continue;
    }
    const asOf = businessDate(new Date(row.fetchedAt));
    result[security.id] = {
      refreshable,
      snapshot: {
        symbol: row.symbol,
        figures: parseFigures(row.figures),
        fetchedAt: row.fetchedAt,
        asOf,
        stale: isKeyFiguresStale(asOf, today),
        fetchedToday: fetchedToday(row, yahooSymbolOf(security), security.assetType, today),
      },
    };
  }
  return result;
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


// ---- Region split of funds (story 8.4) ----

/** The region split of one Security: effective (manual ?? rule, see core), plus both layers for editing. */
export type RegionSplitInfo = {
  effective: EffectiveRegionSplit | null;
  manual: RegionWeights | null;
  rule: RuleRegionSplit | null;
};

/** Region split per Security id (every Security; non-funds and Securities without a row have none). */
export async function listRegionSplits(db: ClassificationDb = prisma): Promise<Record<string, RegionSplitInfo>> {
  const [securities, rows] = await Promise.all([listSecuritiesWithMappings(db), db.securityClassification.findMany()]);
  const byId = new Map(rows.map((row) => [row.securityId, row]));
  const result: Record<string, RegionSplitInfo> = {};
  for (const security of securities) {
    const row = byId.get(security.id);
    const manual = row ? deserializeRegionSplit(row.regionSplitManual) : null;
    const rule = row ? ruleSplitOf(row) : null;
    result[security.id] = {
      effective: effectiveRegionSplit({ assetType: security.assetType, manual, manualRegion: row?.regionManual ?? null, rule }),
      manual,
      rule,
    };
  }
  return result;
}

export type RegionSplitFailureReason = "not-found" | "not-a-fund" | "split-invalid" | "split-sum";

export type SetManualRegionSplitResult = { ok: true; manual: RegionWeights | null } | { ok: false; reason: RegionSplitFailureReason };

/**
 * Sets (or, with every region empty, clears) the manual region split of an ETF/fund. Validated before
 * anything is written; the rule split and every other column are left untouched.
 */
export async function setManualRegionSplit(
  securityId: string,
  input: Partial<Record<SplitRegion, unknown>>,
  db: ClassificationDb = prisma,
  now: () => Date = () => new Date(),
): Promise<SetManualRegionSplitResult> {
  const security = securityId ? await getSecurity(securityId, db) : null;
  if (!security) return { ok: false, reason: "not-found" };
  if (security.assetType !== "ETF" && security.assetType !== "FUND") return { ok: false, reason: "not-a-fund" };
  const parsed = parseRegionSplit(input);
  if (!parsed.ok) return parsed;
  const regionSplitManual = parsed.weights ? serializeRegionSplit(parsed.weights) : null;
  const updatedAt = now().toISOString();
  await db.securityClassification.upsert({
    where: { securityId },
    create: { securityId, regionSplitManual, updatedAt },
    update: { regionSplitManual, updatedAt },
  });
  return { ok: true, manual: parsed.weights };
}
