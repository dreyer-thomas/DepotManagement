// Provider mappings (AD-9): which provider + symbol a Security's Prices come from. Owned by `prices`;
// Securities are read only through the ledger's exported services.
import { z } from "zod";
import { prisma } from "@/db";
import { MappingOrigin, Prisma, PriceProvider } from "@/db/generated/prisma/client";
import { getSecurity, listSecurities, type SecuritySummary } from "@/modules/ledger";
import { findCoinId } from "./providers/coingecko";
import { lookupXetraTickers, type XetraLookup } from "./providers/openfigi";
import { envKey, ERROR, type FetchLike, type Lookup, NOT_FOUND } from "./providers/shared";
import { findGermanListing, type YahooSearch } from "./providers/yahoo";

export type { MappingOrigin, PriceProvider } from "@/db/generated/prisma/client";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type PricesDb = Prisma.TransactionClient;

/** All price providers in declaration order. */
export const PRICE_PROVIDERS = Object.values(PriceProvider) as [PriceProvider, ...PriceProvider[]];

export const MAPPING_SYMBOL_MAX_LENGTH = 40;

/** A stored mapping: mapped (provider + symbol) or the "not found" marker (both null). */
export type ProviderMappingSummary = {
  provider: PriceProvider | null;
  symbol: string | null;
  origin: MappingOrigin;
  /** Reason of the last failed price fetch (`PriceFetchFailure`); null after a success or before any fetch. */
  fetchError: string | null;
};

/** A Security with its mapping; `mapping` is null while auto-resolution has not run for it. */
export type SecurityWithMapping = SecuritySummary & { mapping: ProviderMappingSummary | null };

/** Outcome of resolving one Security: a mapping, a definitive miss, or a transient failure. */
export type MappingResolution =
  | { status: "mapped"; provider: PriceProvider; symbol: string }
  | { status: "not-found" }
  | { status: "error" };

/** Provider lookups the resolver decides over (injected; tests serve recorded responses). */
export type MappingProviders = {
  /** Xetra ticker by ISIN (OpenFIGI). */
  xetraTicker: (isin: string) => Promise<XetraLookup>;
  /** German (.DE / .F) Yahoo symbol by ISIN. */
  germanListing: (isin: string) => Promise<Lookup<string>>;
  /** CoinGecko coin id by crypto symbol. */
  coinId: (symbol: string) => Promise<Lookup<string>>;
};

/** External dependencies of the resolution services; each defaults to the real thing. */
export type MappingDeps = {
  fetch?: FetchLike;
  search?: YahooSearch;
  env?: { OPENFIGI_API_KEY?: string; COINGECKO_API_KEY?: string };
  /** Current time for `updatedAt` (UTC ISO). */
  now?: () => Date;
};

const mapped = (provider: PriceProvider, symbol: string): MappingResolution => ({ status: "mapped", provider, symbol });

/**
 * Decides a Security's mapping from provider lookups (no DB access):
 * certificates → onvista by ISIN (no lookup); crypto → CoinGecko id by symbol; other ISIN Securities →
 * OpenFIGI Xetra ticker as `<T>.DE`, else Yahoo search `.DE`/`.F`. A miss after a failed lookup is a failure.
 */
export async function resolveMapping(
  security: Pick<SecuritySummary, "isin" | "cryptoSymbol" | "assetType">,
  providers: MappingProviders,
): Promise<MappingResolution> {
  if (security.cryptoSymbol !== null) {
    const coin = await providers.coinId(security.cryptoSymbol);
    return coin.status === "found" ? mapped("COINGECKO", coin.value) : coin;
  }
  if (security.isin === null) return NOT_FOUND;
  if (security.assetType === "CERTIFICATE") return mapped("ONVISTA", security.isin);
  const xetra = await providers.xetraTicker(security.isin);
  if (xetra.status === "found") return mapped("YAHOO", `${xetra.value}.DE`);
  const german = await providers.germanListing(security.isin);
  if (german.status === "found") return mapped("YAHOO", german.value);
  if (german.status === "error" || xetra.status === "error") return ERROR;
  return NOT_FOUND;
}

function needsXetraLookup(security: SecuritySummary): security is SecuritySummary & { isin: string } {
  return security.cryptoSymbol === null && security.isin !== null && security.assetType !== "CERTIFICATE";
}

/** Real providers, with OpenFIGI answered from one batched lookup of `isins`. */
async function createProviders(deps: MappingDeps, isins: string[]): Promise<MappingProviders> {
  const fetch = deps.fetch ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const xetra = isins.length
    ? await lookupXetraTickers(isins, { fetch, apiKey: envKey(env.OPENFIGI_API_KEY) })
    : new Map<string, XetraLookup>();
  return {
    xetraTicker: async (isin) => xetra.get(isin) ?? ERROR,
    germanListing: (isin) => findGermanListing(isin, deps.search ? { search: deps.search } : {}),
    coinId: (symbol) => findCoinId(symbol, { fetch, apiKey: envKey(env.COINGECKO_API_KEY) }),
  };
}

function rowData(resolution: Exclude<MappingResolution, { status: "error" }>) {
  return resolution.status === "mapped"
    ? { provider: resolution.provider, symbol: resolution.symbol }
    : { provider: null, symbol: null };
}

/** Runs `write` in a DB transaction, or directly inside the caller's transaction client. */
export async function inTransaction<T>(db: PricesDb, write: (tx: PricesDb) => Promise<T>): Promise<T> {
  const client = db as PricesDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") return client.$transaction((tx) => write(tx));
  return write(db);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function nowIso(deps: MappingDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

export type ResolveMissingResult = {
  mapped: number;
  notFound: number;
  /** Securities whose lookup failed transiently; they keep no row and are retried on the next run. */
  failed: { securityId: string; name: string }[];
};

/**
 * Auto-resolves every Security without a mapping row (once): a mapping or a definitive miss is stored
 * (origin AUTO); a transient failure stores nothing. Existing rows are never touched; a row created
 * concurrently wins.
 */
export async function resolveMissingMappings(deps: MappingDeps = {}, db: PricesDb = prisma): Promise<ResolveMissingResult> {
  const [securities, rows] = await Promise.all([
    listSecurities(db),
    db.providerMapping.findMany({ select: { securityId: true } }),
  ]);
  const withRow = new Set(rows.map((row) => row.securityId));
  const pending = securities.filter((security) => !withRow.has(security.id));
  const result: ResolveMissingResult = { mapped: 0, notFound: 0, failed: [] };
  if (pending.length === 0) return result;

  const providers = await createProviders(deps, pending.filter(needsXetraLookup).map((security) => security.isin));
  for (const security of pending) {
    const resolution = await resolveMapping(security, providers);
    if (resolution.status === "error") {
      result.failed.push({ securityId: security.id, name: security.name });
      continue;
    }
    try {
      await db.providerMapping.create({
        data: { securityId: security.id, ...rowData(resolution), origin: "AUTO", updatedAt: nowIso(deps) },
      });
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
    if (resolution.status === "mapped") result.mapped++;
    else result.notFound++;
  }
  return result;
}

export type ResolveMappingForResult =
  | { ok: true; status: "mapped" | "not-found" }
  | { ok: false; reason: "not-found" | "already-mapped" | "provider-failed" };

/**
 * Resolves one Security again ("Automatisch suchen"): only while it has no row or the "not found"
 * marker. A transient failure writes nothing; a mapped row (AUTO or MANUAL) is never overwritten.
 */
export async function resolveMappingFor(
  securityId: string,
  deps: MappingDeps = {},
  db: PricesDb = prisma,
): Promise<ResolveMappingForResult> {
  const security = securityId ? await getSecurity(securityId, db) : null;
  if (!security) return { ok: false, reason: "not-found" };
  const existing = await db.providerMapping.findUnique({ where: { securityId }, select: { provider: true } });
  if (existing?.provider) return { ok: false, reason: "already-mapped" };

  const providers = await createProviders(deps, needsXetraLookup(security) ? [security.isin] : []);
  const resolution = await resolveMapping(security, providers);
  if (resolution.status === "error") return { ok: false, reason: "provider-failed" };

  const data = { ...rowData(resolution), origin: "AUTO" as const, updatedAt: nowIso(deps) };
  if (existing) {
    // Only replace the marker: a mapping saved meanwhile wins.
    const { count } = await db.providerMapping.updateMany({ where: { securityId, provider: null }, data });
    if (count === 0) return { ok: false, reason: "already-mapped" };
  } else {
    try {
      await db.providerMapping.create({ data: { securityId, ...data } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return { ok: false, reason: "already-mapped" };
    }
  }
  return { ok: true, status: resolution.status };
}

export type SetMappingFailureReason = "not-found" | "provider-invalid" | "symbol-invalid";

export type SetMappingResult =
  | { ok: true; mapping: ProviderMappingSummary }
  | { ok: false; reason: SetMappingFailureReason };

const providerSchema = z.enum(PRICE_PROVIDERS, { error: "provider-invalid" });
const symbolSchema = z
  .string({ error: "symbol-invalid" })
  .trim()
  .min(1, { error: "symbol-invalid" })
  .max(MAPPING_SYMBOL_MAX_LENGTH, { error: "symbol-invalid" })
  .regex(/^[A-Za-z0-9.^=_-]+$/, { error: "symbol-invalid" });

/**
 * Saves a manual mapping (origin MANUAL), replacing any existing row of the Security. In the same DB
 * transaction the Security's PROVIDER Prices are deleted and its fetch state is reset.
 */
export async function setMapping(
  securityId: unknown,
  input: { provider: unknown; symbol: unknown },
  db: PricesDb = prisma,
): Promise<SetMappingResult> {
  const provider = providerSchema.safeParse(input.provider);
  if (!provider.success) return { ok: false, reason: "provider-invalid" };
  const symbol = symbolSchema.safeParse(input.symbol);
  if (!symbol.success) return { ok: false, reason: "symbol-invalid" };
  const security = typeof securityId === "string" && securityId ? await getSecurity(securityId, db) : null;
  if (!security) return { ok: false, reason: "not-found" };
  // The fetch state is reset: the next backfill fetches the new symbol's full history.
  const data = {
    provider: provider.data,
    symbol: symbol.data,
    origin: "MANUAL" as const,
    updatedAt: new Date().toISOString(),
    historyFrom: null,
    fetchedAt: null,
    fetchError: null,
  };
  const mapping = await inTransaction(db, async (tx) => {
    // Provider Prices of the old symbol go with it; MANUAL Prices stay.
    await tx.price.deleteMany({ where: { securityId: security.id, source: "PROVIDER" } });
    return tx.providerMapping.upsert({
      where: { securityId: security.id },
      create: { securityId: security.id, ...data },
      update: data,
      select: { provider: true, symbol: true, origin: true, fetchError: true },
    });
  });
  return { ok: true, mapping };
}

/** All Securities (sorted by name, de-DE) with their mapping row, if any. */
export async function listSecuritiesWithMappings(db: PricesDb = prisma): Promise<SecurityWithMapping[]> {
  const [securities, rows] = await Promise.all([
    listSecurities(db),
    db.providerMapping.findMany({ select: { securityId: true, provider: true, symbol: true, origin: true, fetchError: true } }),
  ]);
  const bySecurity = new Map(rows.map(({ securityId, ...mapping }) => [securityId, mapping]));
  return securities.map((security) => ({ ...security, mapping: bySecurity.get(security.id) ?? null }));
}
