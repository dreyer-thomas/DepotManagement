// The export file contract (story 6.1, AD-12): one versioned JSON document with every stored ledger,
// price and manual-logo row and the manual classification overrides (version 2, story 7.1). Decimals and dates are the stored strings; nothing derived is included.
// Restore (story 6.2) parses files with this schema; older versions are upgraded before parsing.
import { z } from "zod";
import { ASSET_CLASSES, COMPANY_SIZES, CURRENCY_PATTERN, REGIONS } from "@/core/classification";
import { isBusinessDate } from "@/core/dates";
import { isDecimalString } from "@/core/decimal";

export const EXPORT_SCHEMA_VERSION = 2;

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
});

export type ExportFile = z.infer<typeof exportFileSchema>;
