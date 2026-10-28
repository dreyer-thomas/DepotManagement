import type { Classification, Dimension, DimensionValue, EffectiveSource } from "@/core/classification";
import { formatDate, formatQuantity } from "@/core/format";
import type { EffectiveRegionSplit } from "@/core/region-split";
import type { ClassificationFailureReason, RegionSplitFailureReason } from "@/modules/classification";
import type { AssetType } from "@/modules/ledger";
import type { PriceProvider, ProviderMappingSummary, SetMappingFailureReason } from "@/modules/prices";
import { securityTypeLabel } from "@/app/_components/migration/labels";

/** German display names of the price providers, in selection order. */
export const PROVIDER_LABELS: Record<PriceProvider, string> = {
  YAHOO: "Yahoo Finance",
  ONVISTA: "onvista",
  COINGECKO: "CoinGecko",
};

export const PROVIDER_OPTIONS = Object.entries(PROVIDER_LABELS).map(([value, label]) => ({
  value: value as PriceProvider,
  label,
}));

export const MAPPING_PENDING_TEXT = "Kursquelle noch nicht ermittelt";
export const MAPPING_NOT_FOUND_TEXT = "Keine Kursquelle gefunden";

/** "Yahoo Finance · SAP.DE", "Keine Kursquelle gefunden" (marker) or "Kursquelle noch nicht ermittelt" (no row yet). */
export function mappingLabel(mapping: ProviderMappingSummary | null): string {
  if (!mapping) return MAPPING_PENDING_TEXT;
  if (!mapping.provider || !mapping.symbol) return MAPPING_NOT_FOUND_TEXT;
  return `${PROVIDER_LABELS[mapping.provider]} · ${mapping.symbol}`;
}

/** Type options for "Typ ändern" with German labels; `UNCLASSIFIED` is never offered. */
export function typeOptions(types: readonly AssetType[]): { value: AssetType; label: string }[] {
  return types.filter((type) => type !== "UNCLASSIFIED").map((value) => ({ value, label: securityTypeLabel(value) }));
}

export type SecurityErrorReason =
  | SetMappingFailureReason
  | "asset-type-invalid"
  | "unauthorized"
  | "already-mapped"
  | "provider-failed";

const ERROR_MESSAGES: Record<SecurityErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "provider-invalid": "Bitte eine Kursquelle wählen.",
  "symbol-invalid": "Bitte ein Symbol eingeben (höchstens 40 Zeichen: Buchstaben, Ziffern, . ^ = _ -).",
  "asset-type-invalid": "Bitte einen passenden Typ wählen.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "already-mapped": "Für dieses Wertpapier ist bereits eine Kursquelle eingetragen.",
  "provider-failed": "Kursquelle konnte gerade nicht ermittelt werden. Bitte später erneut versuchen.",
};

/** German message for a failed Securities-page write. */
export function securityErrorMessage(reason: SecurityErrorReason): string {
  return ERROR_MESSAGES[reason];
}

/** Shown when a server action was rejected (network, timeout). */
export const ACTION_FAILED_MESSAGE = "Verbindung fehlgeschlagen. Bitte erneut versuchen.";

/** Alert text after an auto-resolver run with failures, naming the Securities. */
export function resolveFailedMessage(names: readonly string[]): string {
  const list = names.join(", ");
  return names.length === 1
    ? `Für ${list} konnte die Kursquelle gerade nicht ermittelt werden.`
    : `Für ${names.length} Wertpapiere konnte die Kursquelle gerade nicht ermittelt werden: ${list}.`;
}

export type LogoErrorReason = "not-found" | "file-missing" | "file-too-large" | "file-type" | "unauthorized";

const LOGO_ERROR_MESSAGES: Record<LogoErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "file-missing": "Bitte eine Bilddatei wählen.",
  "file-too-large": "Die Datei ist größer als 1 MB.",
  "file-type": "Bitte eine PNG-, JPEG- oder WebP-Datei wählen.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a failed logo upload. */
export function logoErrorMessage(reason: LogoErrorReason): string {
  return LOGO_ERROR_MESSAGES[reason];
}

/** Shown for a classification dimension without a value. */
export const CLASSIFICATION_UNKNOWN = "Unbekannt";

/** German labels of the classification dimensions (dialog fields). */
export const CLASSIFICATION_FIELD_LABELS: Record<Dimension, string> = {
  assetClass: "Anlageklasse",
  sector: "Sektor",
  industry: "Branche",
  region: "Region",
  country: "Land",
  companySize: "Unternehmensgröße",
  currency: "Währung",
};

const CLASSIFICATION_SOURCE_LABELS: Record<Exclude<EffectiveSource, "manual">, string> = { provider: "Yahoo", rule: "Regel" };

/** "Automatisch: Technologie (Yahoo)" / "Automatisch: Unbekannt". */
export function automaticLabel(value: DimensionValue): string {
  const { value: automatic, source } = value.automatic;
  if (automatic === null || source === null) return `Automatisch: ${CLASSIFICATION_UNKNOWN}`;
  return `Automatisch: ${automatic} (${CLASSIFICATION_SOURCE_LABELS[source]})`;
}

const SUMMARY_DIMENSIONS: readonly Dimension[] = ["assetClass", "sector", "region", "country", "companySize", "currency"];

/** "Aktien · Technologie · Europa · Deutschland · Large Cap · EUR"; unknown values as "Unbekannt". */
export function classificationSummary(classification: Classification | undefined): string {
  return SUMMARY_DIMENSIONS.map((dimension) => classification?.[dimension].value ?? CLASSIFICATION_UNKNOWN).join(" · ");
}

export type ClassificationErrorReason = ClassificationFailureReason | "unauthorized";

const CLASSIFICATION_ERROR_MESSAGES: Record<ClassificationErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "asset-class-invalid": "Bitte eine Anlageklasse aus der Liste wählen.",
  "sector-invalid": "Bitte einen Sektor mit höchstens 80 Zeichen angeben.",
  "industry-invalid": "Bitte eine Branche mit höchstens 80 Zeichen angeben.",
  "region-invalid": "Bitte eine Region aus der Liste wählen.",
  "country-invalid": "Bitte ein Land mit höchstens 80 Zeichen angeben.",
  "company-size-invalid": "Bitte eine Unternehmensgröße aus der Liste wählen.",
  "currency-invalid": "Bitte einen Währungscode aus drei Buchstaben eingeben (z. B. EUR).",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
};

/** German message for a failed classification save. */
export function classificationErrorMessage(reason: ClassificationErrorReason): string {
  return CLASSIFICATION_ERROR_MESSAGES[reason];
}

/** The dimension a failure reason belongs to (field error), or null (Alert). */
export function classificationErrorField(reason: ClassificationErrorReason): Dimension | null {
  const fields: Partial<Record<ClassificationErrorReason, Dimension>> = {
    "asset-class-invalid": "assetClass",
    "sector-invalid": "sector",
    "industry-invalid": "industry",
    "region-invalid": "region",
    "country-invalid": "country",
    "company-size-invalid": "companySize",
    "currency-invalid": "currency",
  };
  return fields[reason] ?? null;
}

// ---- Region split of funds (story 8.4) ----

/** A percent weight as German text: `"72"` → `"72 %"`, `"2.5"` → `"2,5 %"`. */
export function weightPercent(weight: string): string {
  return `${formatQuantity(weight)} %`;
}

/**
 * Card line of a fund's effective region split: "Regionen: USA 72 % · Europa 15 % · … (Regel MSCI World,
 * Stand 30.09.2026)" or "… (manuell)"; null without a split.
 */
export function regionSplitSummary(split: EffectiveRegionSplit | null | undefined): string | null {
  if (!split) return null;
  const parts = split.weights.map((weight) => `${weight.region} ${weightPercent(weight.weight)}`).join(" · ");
  const origin = split.source === "manual" ? "manuell" : `Regel ${split.index}, Stand ${split.asOf ? formatDate(split.asOf) : "–"}`;
  return `Regionen: ${parts} (${origin})`;
}

export type RegionSplitErrorReason = RegionSplitFailureReason | "unauthorized" | "action-failed";

const REGION_SPLIT_ERROR_MESSAGES: Record<RegionSplitErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "not-a-fund": "Eine Regionen-Aufteilung gibt es nur für ETFs und Fonds.",
  "split-invalid": "Bitte je Region einen Anteil von 0 bis 100 % mit höchstens zwei Nachkommastellen eingeben.",
  "split-sum": "Die Anteile müssen zusammen 100 % ergeben.",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "action-failed": ACTION_FAILED_MESSAGE,
};

/** German message for a failed region split save. */
export function regionSplitErrorMessage(reason: string): string {
  return REGION_SPLIT_ERROR_MESSAGES[reason as RegionSplitErrorReason] ?? ACTION_FAILED_MESSAGE;
}

export type AnalystSymbolErrorReason = "not-found" | "not-a-stock" | "symbol-invalid" | "unauthorized" | "action-failed";

const ANALYST_SYMBOL_ERROR_MESSAGES: Record<AnalystSymbolErrorReason, string> = {
  "not-found": "Wertpapier nicht gefunden.",
  "not-a-stock": "Ein Analysten-Symbol gibt es nur für Aktien.",
  "symbol-invalid": "Ungültiges Symbol",
  unauthorized: "Sitzung abgelaufen. Bitte erneut anmelden.",
  "action-failed": ACTION_FAILED_MESSAGE,
};

/** German message for a failed Analysten-Symbol save (story 9.7). */
export function analystSymbolErrorMessage(reason: string): string {
  return ANALYST_SYMBOL_ERROR_MESSAGES[reason as AnalystSymbolErrorReason] ?? ACTION_FAILED_MESSAGE;
}

/** Card line of a stock's Analysten-Symbol: "Analysten-Symbol: AAPL" or "Analysten-Symbol: automatisch". */
export function analystSymbolSummary(symbol: string | null): string {
  return `Analysten-Symbol: ${symbol ?? "automatisch"}`;
}
