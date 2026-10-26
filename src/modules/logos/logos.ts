// Security logos (AD-19): fetched once per Security in the background, stored as files under
// `<DATA_DIR>/logos`, served by the app's own route. Owned by `logos`; Securities and mappings are read
// only through the ledger's and prices' exported services. A MANUAL (uploaded) logo always wins: it is
// never a fetch candidate, and a fetch that finds one at write time discards its own file.
import { prisma } from "@/db";
import type { LogoProvider, Prisma } from "@/db/generated/prisma/client";
import { getSecurity } from "@/modules/ledger";
import { listSecuritiesWithMappings, type SecurityWithMapping } from "@/modules/prices";
import { type LogoImage, LOGO_CONTENT_TYPES, sniffImage, UPLOAD_MAX_BYTES } from "./image";
import { issuerIsin } from "./issuers";
import { coingeckoImage } from "./providers/coingecko";
import { elbstream } from "./providers/elbstream";
import { logoDev } from "./providers/logo-dev";
import { envKey, type FetchLike, type LogoLookup } from "./providers/shared";
import { deleteLogoFile, logosDir, readLogoFile, writeLogoFile } from "./storage";

export type { LogoProvider, LogoSource } from "@/db/generated/prisma/client";

/** Prisma client or interactive-transaction client; writing services accept either. */
export type LogosDb = Prisma.TransactionClient;

/** External dependencies of the logo services; each defaults to the real thing (tests inject fakes). */
export type LogoDeps = {
  fetch?: FetchLike;
  env?: { LOGO_DEV_API_KEY?: string; COINGECKO_API_KEY?: string; DATA_DIR?: string };
  /** Current time for `fetchedAt` and file names. */
  now?: () => Date;
};

/** A "nothing found" marker older than this many days makes its Security a fetch candidate again. */
export const MARKER_RETRY_DAYS = 30;

const DAY_MS = 86_400_000;

/** Outcome of a fetch run: Securities with a stored logo, with a new marker, and with a transient failure. */
export type LogoRunResult = { stored: number; notFound: number; failed: number };

// In-process serialization: a run started while another is running waits for it to finish. The queue
// lives on globalThis so every module copy in the process (instrumentation, server actions) shares it.
const QUEUE = Symbol.for("depotmanagement.logoRunQueue");
type QueueGlobal = typeof globalThis & { [QUEUE]?: Promise<unknown> };

function serialized<T>(run: () => Promise<T>): Promise<T> {
  const global = globalThis as QueueGlobal;
  const result = (global[QUEUE] ?? Promise.resolve()).then(run, run);
  global[QUEUE] = result.catch(() => undefined);
  return result;
}

async function inTransaction<T>(db: LogosDb, write: (tx: LogosDb) => Promise<T>): Promise<T> {
  const client = db as LogosDb & Partial<Pick<typeof prisma, "$transaction">>;
  if (typeof client.$transaction === "function") return client.$transaction((tx) => write(tx));
  return write(db);
}

function nowOf(deps: LogoDeps): Date {
  return (deps.now ?? (() => new Date()))();
}

function envOf(deps: LogoDeps): Record<string, string | undefined> {
  return deps.env ?? process.env;
}

type ChainResult = { status: "found"; provider: LogoProvider; image: LogoImage } | { status: "not-found" } | { status: "error" };

type Step = { provider: LogoProvider; run: () => Promise<LogoLookup> };

/** Runs `steps` in order; the first image wins. All misses → not-found; a failure and no image → error. */
async function firstImage(steps: Step[]): Promise<ChainResult> {
  let failed = false;
  for (const step of steps) {
    const lookup = await step.run();
    if (lookup.status === "found") return { status: "found", provider: step.provider, image: lookup.image };
    if (lookup.status === "error") failed = true;
  }
  return failed ? { status: "error" } : { status: "not-found" };
}

/** The provider chain of one Security (no request is made here). */
function stepsFor(security: SecurityWithMapping, deps: LogoDeps): Step[] {
  const env = envOf(deps);
  const fetch = deps.fetch ?? globalThis.fetch;
  const logo = logoDev({ fetch, apiKey: envKey(env.LOGO_DEV_API_KEY) });
  const elb = elbstream({ fetch });
  const mapping = security.mapping;

  if (security.cryptoSymbol !== null) {
    const symbol = security.cryptoSymbol.toUpperCase();
    const steps: Step[] = [
      { provider: "LOGO_DEV", run: () => logo("crypto", symbol) },
      { provider: "ELBSTREAM", run: () => elb("crypto", symbol) },
    ];
    if (mapping?.provider === "COINGECKO" && mapping.symbol) {
      const coinId = mapping.symbol;
      const image = coingeckoImage({ fetch, apiKey: envKey(env.COINGECKO_API_KEY) });
      steps.push({ provider: "COINGECKO", run: () => image(coinId) });
    }
    return steps;
  }
  if (security.isin === null) return [];

  if (security.assetType === "CERTIFICATE") {
    const issuer = issuerIsin(security.name);
    if (!issuer) return [];
    return [
      { provider: "LOGO_DEV", run: () => logo("isin", issuer) },
      { provider: "ELBSTREAM", run: () => elb("isin", issuer) },
    ];
  }

  const isin = security.isin;
  const steps: Step[] = [{ provider: "LOGO_DEV", run: () => logo("isin", isin) }];
  if (mapping?.provider === "YAHOO" && mapping.symbol) {
    const ticker = mapping.symbol;
    steps.push({ provider: "LOGO_DEV", run: () => logo("ticker", ticker) });
  }
  steps.push({ provider: "ELBSTREAM", run: () => elb("isin", isin) });
  return steps;
}

/** Securities that need a fetch: no row yet, or a FETCHED marker older than `MARKER_RETRY_DAYS`. */
async function candidates(db: LogosDb, now: Date): Promise<SecurityWithMapping[]> {
  const [securities, rows] = await Promise.all([
    listSecuritiesWithMappings(db),
    db.securityLogo.findMany({ select: { securityId: true, source: true, fileName: true, fetchedAt: true } }),
  ]);
  const bySecurity = new Map(rows.map((row) => [row.securityId, row]));
  const cutoff = now.getTime() - MARKER_RETRY_DAYS * DAY_MS;
  return securities.filter((security) => {
    const row = bySecurity.get(security.id);
    if (!row) return true;
    if (row.source !== "FETCHED" || row.fileName !== null) return false;
    const fetchedAt = Date.parse(row.fetchedAt);
    return !Number.isFinite(fetchedAt) || fetchedAt < cutoff;
  });
}

/**
 * Writes a FETCHED row (with `image`, or the marker without) unless the Security has a MANUAL row by
 * then. The file is written before the row; a discarded fetch removes its file, a replaced row's file is
 * removed after the update. Returns whether the row was written.
 */
async function storeFetched(
  securityId: string,
  found: { provider: LogoProvider; image: LogoImage } | null,
  deps: LogoDeps,
  db: LogosDb,
): Promise<boolean> {
  const dir = logosDir(envOf(deps));
  const now = nowOf(deps);
  const fileName = found ? writeLogoFile(dir, securityId, found.image, now.getTime()) : null;
  const data = {
    source: "FETCHED" as const,
    provider: found?.provider ?? null,
    fileName,
    contentType: found?.image.contentType ?? null,
    fetchedAt: now.toISOString(),
  };
  let outcome: { written: boolean; previous: string | null };
  try {
    outcome = await inTransaction(db, async (tx) => {
      const existing = await tx.securityLogo.findUnique({ where: { securityId }, select: { source: true, fileName: true } });
      if (existing?.source === "MANUAL") return { written: false, previous: null };
      await tx.securityLogo.upsert({ where: { securityId }, create: { securityId, ...data }, update: data });
      return { written: true, previous: existing?.fileName ?? null };
    });
  } catch (error) {
    deleteLogoFile(dir, fileName);
    throw error;
  }
  if (!outcome.written) deleteLogoFile(dir, fileName);
  else if (outcome.previous && outcome.previous !== fileName) deleteLogoFile(dir, outcome.previous);
  return outcome.written;
}

/** Fetches and stores one Security's logo; "skipped" when a MANUAL logo appeared meanwhile. */
async function fetchOne(
  security: SecurityWithMapping,
  deps: LogoDeps,
  db: LogosDb,
): Promise<"stored" | "not-found" | "failed" | "skipped"> {
  const result = await firstImage(stepsFor(security, deps));
  if (result.status === "error") return "failed";
  const found = result.status === "found" ? { provider: result.provider, image: result.image } : null;
  if (!(await storeFetched(security.id, found, deps, db))) return "skipped";
  return found ? "stored" : "not-found";
}

/**
 * Fetches logos of every candidate Security (serialized with other runs in this process). Per Security:
 * the first image of its provider chain is stored; all misses store the "nothing found" marker; a
 * transient failure writes nothing (retried by the next run). Never throws for a single Security.
 */
export function fetchMissingLogos(deps: LogoDeps = {}, db: LogosDb = prisma): Promise<LogoRunResult> {
  return serialized(async () => {
    const result: LogoRunResult = { stored: 0, notFound: 0, failed: 0 };
    for (const security of await candidates(db, nowOf(deps))) {
      try {
        const outcome = await fetchOne(security, deps, db);
        if (outcome === "stored") result.stored += 1;
        else if (outcome === "not-found") result.notFound += 1;
        else if (outcome === "failed") result.failed += 1;
      } catch (error) {
        console.error(`Logos: storing a logo failed (${error instanceof Error ? error.name : "unknown"})`);
        result.failed += 1;
      }
    }
    if (result.failed > 0) console.warn(`Logos: fetch finished with ${result.failed} failed Securities`);
    return result;
  });
}

export type SaveManualLogoFailureReason = "not-found" | "file-missing" | "file-too-large" | "file-type";
export type SaveManualLogoResult = { ok: true } | { ok: false; reason: SaveManualLogoFailureReason };

/**
 * Stores an uploaded logo as the Security's MANUAL logo, replacing any row (fetched, marker or manual).
 * Accepts PNG, JPEG or WebP (by magic bytes) up to 1 MiB; nothing is written on a failure.
 */
export async function saveManualLogo(
  securityId: string,
  bytes: Uint8Array,
  deps: LogoDeps = {},
  db: LogosDb = prisma,
): Promise<SaveManualLogoResult> {
  if (!securityId || !(await getSecurity(securityId, db))) return { ok: false, reason: "not-found" };
  if (bytes.byteLength === 0) return { ok: false, reason: "file-missing" };
  if (bytes.byteLength > UPLOAD_MAX_BYTES) return { ok: false, reason: "file-too-large" };
  const format = sniffImage(bytes);
  if (!format) return { ok: false, reason: "file-type" };

  const dir = logosDir(envOf(deps));
  const now = nowOf(deps);
  const fileName = writeLogoFile(dir, securityId, { ...format, bytes }, now.getTime());
  const data = { source: "MANUAL" as const, provider: null, fileName, contentType: format.contentType, fetchedAt: now.toISOString() };
  let previous: string | null;
  try {
    previous = await inTransaction(db, async (tx) => {
      const existing = await tx.securityLogo.findUnique({ where: { securityId }, select: { fileName: true } });
      await tx.securityLogo.upsert({ where: { securityId }, create: { securityId, ...data }, update: data });
      return existing?.fileName ?? null;
    });
  } catch (error) {
    deleteLogoFile(dir, fileName);
    throw error;
  }
  if (previous && previous !== fileName) deleteLogoFile(dir, previous);
  return { ok: true };
}

/** Cache-busting version per Security id with a stored logo file (Securities without one are absent). */
export async function listLogoVersions(db: LogosDb = prisma): Promise<Record<string, string>> {
  const rows = await db.securityLogo.findMany({
    where: { fileName: { not: null } },
    select: { securityId: true, fileName: true },
  });
  const versions: Record<string, string> = {};
  for (const row of rows) {
    const stem = (row.fileName as string).replace(/\.[a-z]+$/, "");
    versions[row.securityId] = stem.slice(stem.lastIndexOf("-") + 1);
  }
  return versions;
}

/** A stored logo file: its bytes and content type, or `null` (unknown Security, marker, missing file). */
export async function readLogo(
  securityId: string,
  deps: Pick<LogoDeps, "env"> = {},
  db: LogosDb = prisma,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!securityId) return null;
  const row = await db.securityLogo.findUnique({ where: { securityId }, select: { fileName: true, contentType: true } });
  if (!row?.fileName || !row.contentType || !LOGO_CONTENT_TYPES.includes(row.contentType)) return null;
  const bytes = readLogoFile(logosDir(envOf(deps)), row.fileName);
  return bytes ? { bytes: new Uint8Array(bytes), contentType: row.contentType } : null;
}
