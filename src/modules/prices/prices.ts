// Prices (AD-9): fetching, storing and reading stored Prices. Owned by `prices`; ledger data is read only
// through the ledger's exported services. Provider code writes PROVIDER rows only (never MANUAL).
// Fetch failures are typed per Security, recorded on its mapping row and returned; they never throw,
// never stop other Securities and never touch existing Price rows.
import { prisma } from "@/db";
import type { Split } from "@/core/corporate-actions";
import { addDays, isBusinessDate } from "@/core/dates";
import { ExactDecimal } from "@/core/decimal";
import { parseDecimalInput } from "@/core/decimal-input";
import { isStale, type PriceObservation, type PriceSource, resolvePrice } from "@/core/prices";
import type { PriceProvider } from "@/db/generated/prisma/client";
import {
  firstActivityDates,
  getSecurity,
  latestTradePrices,
  listHeldSecurities,
  listSecurities,
  listSplits,
} from "@/modules/ledger";
import { inTransaction, type MappingDeps, type PricesDb, resolveMissingMappings } from "./mappings";
import { binancePrices } from "./providers/binance";
import { COINGECKO_MAX_DAYS, coingeckoPrices } from "./providers/coingecko";
import { onvistaPrices } from "./providers/onvista";
import { daysBetween, envKey } from "./providers/shared";
import type { DailyClose, PriceAdapter, PriceFetch, PriceFetchContext, PriceFetchFailure } from "./providers/types";
import { type YahooChart, yahooPrices } from "./providers/yahoo";

/** External dependencies of the price services; each defaults to the real thing (tests inject recorded responses). */
export type PriceDeps = MappingDeps & {
  /** Yahoo `chart()`; tests pass a fake serving recorded results. */
  chart?: YahooChart;
};

export type PriceRunFailure = { securityId: string; name: string; provider: PriceProvider; reason: PriceFetchFailure };

/** Outcome of a price run: number of Securities whose Prices were stored, and the failed ones. */
export type PriceRunResult = { updated: number; failed: PriceRunFailure[] };

/** Incremental refreshes re-fetch this many days before the latest stored provider Price. */
export const REFRESH_OVERLAP_DAYS = 7;

/** Providers whose mapped Securities get Prices fetched. */
const FETCHED_PROVIDERS: readonly PriceProvider[] = ["YAHOO", "ONVISTA", "COINGECKO"];

/** One Security to fetch: `full` replaces all its PROVIDER rows and records `historyFrom = from`. */
type Plan = { securityId: string; provider: PriceProvider; symbol: string; from: string; to: string; full: boolean };

const EMPTY_RESULT: PriceRunResult = { updated: 0, failed: [] };

// In-process serialization: a run started while another is running waits for it to finish. The queue
// lives on globalThis so every module copy in the process (instrumentation, server actions) shares it.
const QUEUE = Symbol.for("depotmanagement.priceRunQueue");
type QueueGlobal = typeof globalThis & { [QUEUE]?: Promise<unknown> };

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const global = globalThis as QueueGlobal;
  const result = (global[QUEUE] ?? Promise.resolve()).then(run, run);
  global[QUEUE] = result.catch(() => undefined);
  return result;
}

function nowIso(deps: PriceDeps): string {
  return (deps.now ?? (() => new Date()))().toISOString();
}

/** Securities of `securityIds` mapped to one of `providers` (markers without provider/symbol are skipped). */
async function mappingsOf(securityIds: string[], providers: readonly PriceProvider[], db: PricesDb) {
  if (securityIds.length === 0) return [];
  const rows = await db.providerMapping.findMany({
    where: { securityId: { in: securityIds }, provider: { in: [...providers] }, symbol: { not: null } },
    select: { securityId: true, provider: true, symbol: true, historyFrom: true },
  });
  return rows.map((row) => ({
    securityId: row.securityId,
    provider: row.provider as PriceProvider,
    symbol: row.symbol as string,
    historyFrom: row.historyFrom,
  }));
}

async function loadSplits(db: PricesDb): Promise<Split[]> {
  return (await listSplits(db)).map((split) => ({
    securityId: split.security.id,
    date: split.date,
    ratioOld: split.ratioOld,
    ratioNew: split.ratioNew,
  }));
}

/**
 * Plans for the held Securities mapped to Yahoo, onvista or CoinGecko: a full backfill from the first activity date when
 * `historyFrom` is unset or later than it; otherwise (unless `backfillOnly`) an incremental refresh from
 * `REFRESH_OVERLAP_DAYS` before the latest stored provider Price.
 */
async function heldPlans(today: string, backfillOnly: boolean, deps: PriceDeps, db: PricesDb): Promise<Plan[]> {
  try {
    await resolveMissingMappings(deps, db);
  } catch (error) {
    console.warn(`Prices: mapping resolution failed (${error instanceof Error ? error.name : "unknown"})`);
  }
  const mappings = await mappingsOf(await listHeldSecurities(today, db), FETCHED_PROVIDERS, db);
  if (mappings.length === 0) return [];
  const firstDates = await firstActivityDates(
    mappings.map((mapping) => mapping.securityId),
    db,
  );
  const plans: Plan[] = [];
  for (const { securityId, provider, symbol, historyFrom } of mappings) {
    const first = firstDates.get(securityId);
    if (!first || first > today) continue;
    if (historyFrom === null || historyFrom > first) {
      plans.push({ securityId, provider, symbol, from: first, to: today, full: true });
      continue;
    }
    if (backfillOnly) continue;
    const latest = await db.price.findFirst({
      where: { securityId, source: "PROVIDER", date: { lte: today } },
      orderBy: { date: "desc" },
      select: { date: true },
    });
    const overlap = latest ? addDays(latest.date, -REFRESH_OVERLAP_DAYS) : first;
    plans.push({ securityId, provider, symbol, from: overlap > first ? overlap : first, to: today, full: false });
  }
  return plans;
}

/**
 * Stores a fetched history in one DB transaction; false when the mapping changed meanwhile (nothing
 * written). A full plan records `historyFrom` (default `plan.from`; null keeps the backfill pending).
 */
async function storeHistory(
  plan: Plan,
  closes: DailyClose[],
  fetchedAt: string,
  db: PricesDb,
  historyFrom: string | null = plan.from,
): Promise<boolean> {
  return inTransaction(db, async (tx) => {
    const { count } = await tx.providerMapping.updateMany({
      where: { securityId: plan.securityId, provider: plan.provider, symbol: plan.symbol },
      data: { fetchedAt, fetchError: null, ...(plan.full ? { historyFrom } : {}) },
    });
    if (count === 0) return false;
    await tx.price.deleteMany({
      where: {
        securityId: plan.securityId,
        source: "PROVIDER",
        ...(plan.full ? {} : { date: { gte: plan.from, lte: plan.to } }),
      },
    });
    await tx.price.createMany({
      data: closes.map((close) => ({
        securityId: plan.securityId,
        date: close.date,
        source: "PROVIDER" as const,
        price: close.close,
        fetchedAt,
      })),
    });
    return true;
  });
}

async function recordFailure(plan: Plan, reason: PriceFetchFailure, db: PricesDb): Promise<PriceRunFailure> {
  console.warn(`Prices: ${plan.provider} ${plan.symbol} failed (${reason})`);
  try {
    await db.providerMapping.updateMany({
      where: { securityId: plan.securityId, provider: plan.provider, symbol: plan.symbol },
      // A failed full fetch leaves stale history (e.g. old split un-adjustment): clear `historyFrom` so
      // the next backfill retries it.
      data: { fetchError: reason, ...(plan.full ? { historyFrom: null } : {}) },
    });
  } catch {
    // The failure is still returned; recording it is best effort.
  }
  const security = await getSecurity(plan.securityId, db).catch(() => null);
  return { securityId: plan.securityId, name: security?.name ?? plan.symbol, provider: plan.provider, reason };
}

type Adapters = Record<PriceProvider, PriceAdapter> & { binance: PriceAdapter };

function createAdapters(deps: PriceDeps): Adapters {
  const fetch = deps.fetch ?? globalThis.fetch;
  const env = deps.env ?? process.env;
  const now = deps.now ? { now: deps.now } : {};
  const apiKey = envKey(env.COINGECKO_API_KEY);
  return {
    YAHOO: yahooPrices({ ...(deps.chart ? { chart: deps.chart } : {}), ...now }),
    ONVISTA: onvistaPrices({ fetch, ...now }),
    COINGECKO: coingeckoPrices({ fetch, ...(apiKey ? { apiKey } : {}), ...now }),
    binance: binancePrices({ fetch, ...now }),
  };
}

/** `fetchHistory` that never throws (an adapter bug is an `unexpected` failure). */
async function safeHistory(
  adapter: PriceAdapter,
  symbol: string,
  from: string,
  to: string,
  ctx: PriceFetchContext,
): Promise<PriceFetch<DailyClose[]>> {
  try {
    return await adapter.fetchHistory(symbol, from, to, ctx);
  } catch {
    return { ok: false, reason: "unexpected" };
  }
}

/**
 * The one-time Binance backfill of a full CoinGecko plan reaching back further than CoinGecko's window:
 * the closes to store and the `historyFrom` to record. Binance `not-found` completes the backfill with
 * CoinGecko closes only (older dates fall back to Transaction prices); any other Binance failure stores
 * the CoinGecko closes but keeps `historyFrom` null, so the next run retries.
 */
async function withCryptoBackfill(
  plan: Plan,
  closes: DailyClose[],
  adapters: Adapters,
  ctx: PriceFetchContext,
  db: PricesDb,
): Promise<{ closes: DailyClose[]; historyFrom: string | null }> {
  const complete = { closes, historyFrom: plan.from };
  if (plan.provider !== "COINGECKO" || !plan.full) return complete;
  if (daysBetween(plan.from, plan.to) < COINGECKO_MAX_DAYS || closes.length === 0 || closes[0].date <= plan.from) return complete;
  const security = await getSecurity(plan.securityId, db);
  if (!security?.cryptoSymbol) return complete;
  const pair = `${security.cryptoSymbol.toUpperCase()}EUR`;
  const older = await safeHistory(adapters.binance, pair, plan.from, addDays(closes[0].date, -1), ctx);
  if (older.ok) return { closes: [...older.value.filter((close) => close.date < closes[0].date), ...closes], historyFrom: plan.from };
  if (older.reason === "not-found") return complete;
  console.warn(`Prices: BINANCE ${pair} backfill failed (${older.reason})`);
  return { closes, historyFrom: null };
}

async function runPlans(plans: Plan[], deps: PriceDeps, db: PricesDb): Promise<PriceRunResult> {
  if (plans.length === 0) return { updated: 0, failed: [] };
  const adapters = createAdapters(deps);
  const splits = await loadSplits(db);
  const result: PriceRunResult = { updated: 0, failed: [] };
  for (const plan of plans) {
    // A split dated after `to` has not happened yet, so the provider has not adjusted for it.
    const effective = splits.filter((split) => split.date <= plan.to);
    const ctx: PriceFetchContext = { securityId: plan.securityId, splits: effective };
    const fetched = await safeHistory(adapters[plan.provider], plan.symbol, plan.from, plan.to, ctx);
    if (!fetched.ok) {
      result.failed.push(await recordFailure(plan, fetched.reason, db));
      continue;
    }
    try {
      const { closes, historyFrom } = await withCryptoBackfill(plan, fetched.value, adapters, ctx, db);
      if (await storeHistory(plan, closes, nowIso(deps), db, historyFrom)) result.updated++;
    } catch (error) {
      console.warn(`Prices: storing ${plan.provider} ${plan.symbol} failed (${error instanceof Error ? error.name : "unknown"})`);
      result.failed.push(await recordFailure(plan, "unexpected", db));
    }
  }
  return result;
}

/**
 * Fetches Prices of every held Security mapped to Yahoo, onvista or CoinGecko (after auto-resolving missing mappings): a full
 * backfill from its first activity date where needed, else the days since its latest stored provider
 * Price (with overlap) up to `today`. Never throws for a fetch failure; runs are serialized in-process.
 */
export function refreshPrices(today: string, deps: PriceDeps = {}, db: PricesDb = prisma): Promise<PriceRunResult> {
  return serialized(async () => runPlans(await heldPlans(today, false, deps, db), deps, db));
}

/**
 * Like `refreshPrices`, but only for held Securities that need a full backfill (new held Security, first
 * activity moved earlier, mapping changed); no provider call otherwise. Called after ledger writes.
 */
export function backfillHeldPrices(today: string, deps: PriceDeps = {}, db: PricesDb = prisma): Promise<PriceRunResult> {
  return serialized(async () => runPlans(await heldPlans(today, true, deps, db), deps, db));
}

/**
 * Refetches the full provider history of one Security (after a split was recorded, changed or deleted):
 * only when it is mapped to Yahoo and held or already has provider Prices. On success all its PROVIDER
 * rows are replaced; on failure they are kept and the error recorded.
 */
export function refetchPriceHistory(
  securityId: string,
  today: string,
  deps: PriceDeps = {},
  db: PricesDb = prisma,
): Promise<PriceRunResult> {
  return serialized(async () => {
    // Splits only affect Yahoo's (split-adjusted) history.
    const [mapping] = await mappingsOf([securityId], ["YAHOO"], db);
    if (!mapping) return EMPTY_RESULT;
    const held = (await listHeldSecurities(today, db)).includes(securityId);
    const earliest = await db.price.findFirst({
      where: { securityId, source: "PROVIDER" },
      orderBy: { date: "asc" },
      select: { date: true },
    });
    if (!held && !earliest) return EMPTY_RESULT;
    const from = (await firstActivityDates([securityId], db)).get(securityId) ?? earliest?.date;
    if (!from || from > today) return EMPTY_RESULT;
    return runPlans([{ securityId, provider: "YAHOO", symbol: mapping.symbol, from, to: today, full: true }], deps, db);
  });
}

/**
 * Stored Prices as resolver observations: per Security of `securityIds` its latest MANUAL and its latest
 * PROVIDER Price dated on or before `asOf` (enough for the resolver's precedence and carry-forward), with
 * `fetchedAt` and, for PROVIDER rows, the provider of the Security's current mapping.
 */
export async function latestStoredPrices(
  securityIds: readonly string[],
  asOf: string,
  db: PricesDb = prisma,
): Promise<PriceObservation[]> {
  if (securityIds.length === 0) return [];
  const latest = await db.price.groupBy({
    by: ["securityId", "source"],
    where: { securityId: { in: [...securityIds] }, date: { lte: asOf } },
    _max: { date: true },
  });
  const keys = latest.flatMap((group) =>
    group._max.date ? [{ securityId: group.securityId, source: group.source, date: group._max.date }] : [],
  );
  if (keys.length === 0) return [];
  const [rows, mappings] = await Promise.all([
    db.price.findMany({
      where: { OR: keys },
      select: { id: true, securityId: true, date: true, source: true, price: true, fetchedAt: true },
    }),
    db.providerMapping.findMany({
      where: { securityId: { in: [...new Set(keys.map((key) => key.securityId))] } },
      select: { securityId: true, provider: true },
    }),
  ]);
  const providers = new Map(mappings.map((mapping) => [mapping.securityId, mapping.provider]));
  return rows.map((row) => ({
    id: row.id,
    securityId: row.securityId,
    date: row.date,
    sequence: 0,
    price: row.price,
    source: row.source === "MANUAL" ? "manual" : "provider",
    fetchedAt: row.fetchedAt,
    provider: row.source === "PROVIDER" ? (providers.get(row.securityId) ?? null) : null,
  }));
}

/** Latest price date of a Security with its source (for the date line, stale badge and tooltip). */
export type SecurityPriceInfo = {
  date: string;
  source: PriceSource;
  /** UTC ISO fetch / entry time; null for a Transaction price. */
  fetchedAt: string | null;
  /** Provider of a provider price (current mapping); null otherwise. */
  provider: PriceProvider | null;
  /** `isStale(date, today)`, only ever true for held Securities. */
  stale: boolean;
};

/**
 * Per Security id the price the core resolver picks as of `today` from its latest stored MANUAL /
 * PROVIDER Price and its latest BUY/SELL price; Securities without any price are absent. Read-only,
 * no provider call.
 */
export async function securityPriceInfo(today: string, db: PricesDb = prisma): Promise<Record<string, SecurityPriceInfo>> {
  const securityIds = (await listSecurities(db)).map((security) => security.id);
  if (securityIds.length === 0) return {};
  const [stored, trades, held] = await Promise.all([
    latestStoredPrices(securityIds, today, db),
    latestTradePrices(securityIds, today, db),
    listHeldSecurities(today, db),
  ]);
  const observations = [...stored, ...trades];
  const heldIds = new Set(held);
  const info: Record<string, SecurityPriceInfo> = {};
  for (const securityId of securityIds) {
    const resolved = resolvePrice(observations, securityId, today);
    if (!resolved) continue;
    info[securityId] = {
      date: resolved.date,
      source: resolved.source,
      fetchedAt: resolved.fetchedAt,
      provider: (resolved.provider as PriceProvider | null) ?? null,
      stale: heldIds.has(securityId) && isStale(resolved.date, today),
    };
  }
  return info;
}

export type SaveManualPriceFailureReason = "not-found" | "date-invalid" | "price-invalid";

export type SaveManualPriceResult = { ok: true } | { ok: false; reason: SaveManualPriceFailureReason };

type ManualPriceInput = { date: unknown; price: unknown };

/**
 * Shared validation of a manual Price: a business date on or before `today` and German or plain decimal
 * text > 0, returned as canonical TEXT decimal.
 */
function validateManualPrice(
  input: ManualPriceInput,
  today: string,
): { ok: true; date: string; price: string } | { ok: false; reason: "date-invalid" | "price-invalid" } {
  const date = typeof input.date === "string" ? input.date.trim() : "";
  if (!isBusinessDate(date) || date > today) return { ok: false, reason: "date-invalid" };
  const parsed = typeof input.price === "string" ? parseDecimalInput(input.price) : { ok: false as const };
  if (!parsed.ok || parsed.value === "" || !new ExactDecimal(parsed.value).greaterThan(0)) {
    return { ok: false, reason: "price-invalid" };
  }
  return { ok: true, date, price: parsed.value };
}

/**
 * Stores a manual Price of `securityId` on `input.date` (a business date on or before `today`), replacing
 * an existing MANUAL row of that date. `input.price` is German or plain decimal text, > 0. PROVIDER rows
 * and the mapping are never touched.
 */
export async function saveManualPrice(
  securityId: unknown,
  input: ManualPriceInput,
  today: string,
  db: PricesDb = prisma,
): Promise<SaveManualPriceResult> {
  const security = typeof securityId === "string" && securityId ? await getSecurity(securityId, db) : null;
  if (!security) return { ok: false, reason: "not-found" };
  const valid = validateManualPrice(input, today);
  if (!valid.ok) return valid;
  const { date, price } = valid;
  const fetchedAt = new Date().toISOString();
  await db.price.upsert({
    where: { securityId_date_source: { securityId: security.id, date, source: "MANUAL" } },
    create: { securityId: security.id, date, source: "MANUAL", price, fetchedAt },
    update: { price, fetchedAt },
  });
  return { ok: true };
}

/** One manual Price of a Security as listed on the Securities page. */
export type ManualPriceRow = { id: string; date: string; price: string };

/** Per Security id its MANUAL Prices, newest date first; Securities without any are absent. Read-only. */
export async function listManualPrices(db: PricesDb = prisma): Promise<Record<string, ManualPriceRow[]>> {
  const rows = await db.price.findMany({
    where: { source: "MANUAL" },
    orderBy: [{ securityId: "asc" }, { date: "desc" }],
    select: { id: true, securityId: true, date: true, price: true },
  });
  const result: Record<string, ManualPriceRow[]> = {};
  for (const { securityId, id, date, price } of rows) (result[securityId] ??= []).push({ id, date, price });
  return result;
}

export type UpdateManualPriceFailureReason = "not-found" | "date-invalid" | "price-invalid" | "date-taken";

export type UpdateManualPriceResult = { ok: true } | { ok: false; reason: UpdateManualPriceFailureReason };

/** The MANUAL Price row `priceId`, or null (unknown id, PROVIDER row or not a string). */
async function findManualRow(priceId: unknown, db: PricesDb) {
  if (typeof priceId !== "string" || !priceId) return null;
  return db.price.findFirst({ where: { id: priceId, source: "MANUAL" }, select: { id: true, securityId: true, date: true } });
}

/**
 * Changes date and price of the MANUAL Price `priceId` (validated like `saveManualPrice`). Moving it to a
 * date that already has another MANUAL Price of the same Security is `date-taken` (nothing written).
 * PROVIDER rows and the mapping are never touched.
 */
export async function updateManualPrice(
  priceId: unknown,
  input: ManualPriceInput,
  today: string,
  db: PricesDb = prisma,
): Promise<UpdateManualPriceResult> {
  const row = await findManualRow(priceId, db);
  if (!row) return { ok: false, reason: "not-found" };
  const valid = validateManualPrice(input, today);
  if (!valid.ok) return valid;
  const { date, price } = valid;
  return inTransaction(db, async (tx): Promise<UpdateManualPriceResult> => {
    if (date !== row.date) {
      const taken = await tx.price.findFirst({
        where: { securityId: row.securityId, date, source: "MANUAL", id: { not: row.id } },
        select: { id: true },
      });
      if (taken) return { ok: false, reason: "date-taken" };
    }
    const { count } = await tx.price.updateMany({
      where: { id: row.id, source: "MANUAL" },
      data: { date, price, fetchedAt: new Date().toISOString() },
    });
    return count === 0 ? { ok: false, reason: "not-found" } : { ok: true };
  });
}

export type DeleteManualPriceResult = { ok: true } | { ok: false; reason: "not-found" };

/** Deletes exactly the MANUAL Price `priceId`; a PROVIDER or unknown id is `not-found`. */
export async function deleteManualPrice(priceId: unknown, db: PricesDb = prisma): Promise<DeleteManualPriceResult> {
  if (typeof priceId !== "string" || !priceId) return { ok: false, reason: "not-found" };
  const { count } = await db.price.deleteMany({ where: { id: priceId, source: "MANUAL" } });
  return count === 0 ? { ok: false, reason: "not-found" } : { ok: true };
}
