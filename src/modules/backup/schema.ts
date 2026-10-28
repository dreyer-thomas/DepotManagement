// The export file contract (story 6.1, AD-12): one versioned JSON document with every stored ledger,
// price and manual-logo row, the manual classification overrides (version 2, story 7.1) and the tax settings
// (version 3, story 8.3), the manual region splits (version 4, story 8.4), the target allocations
// (version 5, story 8.5) and the watchlists with their entries (version 6, story 9.3; OAuth data is never
// exported). Decimals and dates are the stored strings; nothing derived is included.
// Restore (story 6.2) parses files with this schema; older versions are upgraded before parsing.
import { z } from "zod";
import { ASSET_CLASSES, COMPANY_SIZES, CURRENCY_PATTERN, REGIONS } from "@/core/classification";
import { isBusinessDate } from "@/core/dates";
import { isDecimalString } from "@/core/decimal";
import { SEGMENTS, type Segment } from "@/core/rebalancing";
import { regionSplitFromRecord, SPLIT_REGIONS, type SplitRegion } from "@/core/region-split";
import { WATCHLIST_NAME_MAX_LENGTH, WATCHLIST_NOTE_MAX_LENGTH } from "@/core/watchlist";

export const EXPORT_SCHEMA_VERSION = 6;

const id = z.string().min(1);
const decimal = z.string().refine(isDecimalString, "decimal string expected");
const businessDate = z.string().refine(isBusinessDate, "YYYY-MM-DD expected");
/** UTC ISO timestamp as stored (e.g. `fetchedAt`); kept verbatim. */
const timestamp = z.string().min(1);

export const depotRecordSchema = z.strictObject({
  id,
  name: z.string().min(1),
  broker: z.enum(["COMDIRECT", "DEUTSCHE_BANK", "FINANZEN_ZERO"]),
  archived: z.boolean(),
});

export const securityRecordSchema = z.strictObject({
  id,
  isin: z.string().min(1).nullable(),
  cryptoSymbol: z.string().min(1).nullable(),
  name: z.string().min(1),
  assetType: z.enum(["STOCK", "ETF", "FUND", "CERTIFICATE", "CRYPTO", "UNCLASSIFIED"]),
});

export const providerMappingRecordSchema = z.strictObject({
  id,
  securityId: id,
  provider: z.enum(["YAHOO", "ONVISTA", "COINGECKO"]).nullable(),
  symbol: z.string().min(1).nullable(),
  origin: z.enum(["AUTO", "MANUAL"]),
  updatedAt: timestamp,
  historyFrom: businessDate.nullable(),
  fetchedAt: timestamp.nullable(),
  fetchError: z.string().min(1).nullable(),
});

export const transactionRecordSchema = z.strictObject({
  id,
  depotId: id,
  securityId: id.nullable(),
  type: z.enum(["BUY", "SELL", "DIVIDEND", "FEE", "TAX", "DEPOSIT", "WITHDRAWAL", "ADJUSTMENT"]),
  date: businessDate,
  sequence: z.number().int(),
  quantity: decimal.nullable(),
  price: decimal.nullable(),
  amount: decimal,
  fee: decimal,
  tax: decimal,
  note: z.string().nullable(),
});

export const corporateActionRecordSchema = z.strictObject({
  id,
  securityId: id,
  newSecurityId: id.nullable(),
  type: z.enum(["SPLIT", "ISIN_CHANGE"]),
  date: businessDate,
  ratioOld: decimal,
  ratioNew: decimal,
});

export const reconciliationRowRecordSchema = z.strictObject({
  id,
  runId: id,
  securityId: id.nullable(),
  statementValue: decimal.nullable(),
  checked: z.boolean(),
});

export const reconciliationRunRecordSchema = z.strictObject({
  id,
  depotId: id,
  statementDate: businessDate,
  status: z.enum(["OPEN", "FINISHED"]),
  createdAt: timestamp,
  finishedAt: timestamp.nullable(),
  rows: z.array(reconciliationRowRecordSchema),
});

export const priceRecordSchema = z.strictObject({
  id,
  securityId: id,
  date: businessDate,
  source: z.enum(["MANUAL", "PROVIDER"]),
  price: decimal,
  fetchedAt: timestamp,
});

export const logoRecordSchema = z.strictObject({
  id,
  securityId: id,
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  fetchedAt: timestamp,
  /** The logo file bytes, base64-encoded. */
  data: z.base64().min(1),
});

/**
 * Manual region split of a fund: percent per split region (canonical decimal, > 0, ≤ 100, at most two
 * decimals; zero regions omitted), summing to exactly 100.
 */
const regionSplitSchema = z
  .strictObject(Object.fromEntries(SPLIT_REGIONS.map((region) => [region, decimal.optional()])) as Record<SplitRegion, z.ZodOptional<typeof decimal>>)
  .refine((split) => regionSplitFromRecord(split) !== null, "region split must be canonical percentages summing to 100");

/** Manual classification overrides of one Security (`null` = automatic); the automatic layer is not exported. */
const classificationText = z.string().min(1).max(80).nullable();
export const classificationRecordSchema = z.strictObject({
  id,
  securityId: id,
  assetClass: z.enum(ASSET_CLASSES).nullable(),
  sector: classificationText,
  industry: classificationText,
  region: z.enum(REGIONS).nullable(),
  country: classificationText,
  companySize: z.enum(COMPANY_SIZES).nullable(),
  currency: z.string().regex(CURRENCY_PATTERN).nullable(),
  regionSplit: regionSplitSchema.nullable(),
});

/** One Freistellungsauftrag (tax module): EUR amount > 0 per broker and year. */
export const taxAllowanceRecordSchema = z.strictObject({
  id,
  broker: z.enum(["COMDIRECT", "DEUTSCHE_BANK", "FINANZEN_ZERO"]),
  year: z.number().int().min(2000).max(2100),
  amount: decimal.refine((value) => !value.startsWith("-"), "non-negative amount expected"),
});

/** One manual Teilfreistellung of a Security (tax module); the consistency check enforces the rate list. */
export const teilfreistellungOverrideRecordSchema = z.strictObject({
  id,
  securityId: id,
  rate: decimal,
});

/**
 * Target allocation of one scope (rebalancing module): `scope` is "portfolio" or a Depot id; weights are
 * percent per segment (non-zero only); the consistency check enforces valid weights summing to 100 and the threshold.
 */
export const targetAllocationRecordSchema = z.strictObject({
  id,
  scope: id,
  weights: z.strictObject(Object.fromEntries(SEGMENTS.map((segment) => [segment, decimal.optional()])) as Record<Segment, z.ZodOptional<typeof decimal>>),
  threshold: decimal,
});

/** One Security on a watchlist (watchlist module); the parent list is implied by nesting. */
export const watchlistEntryRecordSchema = z.strictObject({
  id,
  securityId: id,
  note: z.string().max(WATCHLIST_NOTE_MAX_LENGTH),
  dateAdded: businessDate,
  position: z.number().int(),
  source: z.enum(["APP", "MCP"]),
  clientName: z.string().min(1).nullable(),
  createdAt: timestamp,
});

/** One named watchlist with its entries; the consistency check enforces unique names, positions and entries. */
export const watchlistRecordSchema = z.strictObject({
  id,
  name: z.string().min(1).max(WATCHLIST_NAME_MAX_LENGTH),
  position: z.number().int(),
  createdAt: timestamp,
  entries: z.array(watchlistEntryRecordSchema),
});

/** The whole export file; keys appear in this order in the serialized JSON. */
export const exportFileSchema = z.strictObject({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  depots: z.array(depotRecordSchema),
  securities: z.array(securityRecordSchema),
  providerMappings: z.array(providerMappingRecordSchema),
  transactions: z.array(transactionRecordSchema),
  corporateActions: z.array(corporateActionRecordSchema),
  reconciliationRuns: z.array(reconciliationRunRecordSchema),
  prices: z.array(priceRecordSchema),
  logos: z.array(logoRecordSchema),
  classifications: z.array(classificationRecordSchema),
  taxAllowances: z.array(taxAllowanceRecordSchema),
  teilfreistellungOverrides: z.array(teilfreistellungOverrideRecordSchema),
  targetAllocations: z.array(targetAllocationRecordSchema),
  watchlists: z.array(watchlistRecordSchema),
});

export type ExportFile = z.infer<typeof exportFileSchema>;
